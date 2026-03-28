import * as fs from "node:fs";
import * as path from "node:path";
import { executeWithProvider } from "@skillshub/providers";
import type { ProviderConfig, ProviderResult, TranscriptEntry } from "@skillshub/providers";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

export type RunMode = "with_skill" | "without_skill" | "old_skill";

export type RunConfig = {
  runId: string;
  iterationId: string;
  evalCaseId: string;
  mode: RunMode;
  providerConfig: ProviderConfig;
  prompt: string;
  skillBundleUri?: string;
  inputFilesManifest?: Array<{ key: string; s3Key: string }>;
};

export type RunResult = {
  runId: string;
  exitCode: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number | null;
  outputText: string;
  artifactKeys: string[];
  transcriptKey: string;
  timingKey: string;
};

function getS3Client(): S3Client {
  return new S3Client({
    endpoint: process.env["S3_ENDPOINT"] ?? "http://localhost:9000",
    region: "us-east-1",
    credentials: {
      accessKeyId: process.env["S3_ACCESS_KEY"] ?? "minioadmin",
      secretAccessKey: process.env["S3_SECRET_KEY"] ?? "minioadmin",
    },
    forcePathStyle: true,
  });
}

function getBucket(): string {
  return process.env["S3_BUCKET"] ?? "skillshub-artifacts";
}

function getWorkdirBase(): string {
  return process.env["RUNNER_WORKDIR_BASE"] ?? "/tmp/skillshub-runs";
}

async function downloadFromS3(s3: S3Client, bucket: string, key: string, dest: string): Promise<void> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = response.Body;
  if (!body) throw new Error(`Empty response for S3 key: ${key}`);

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  fs.writeFileSync(dest, Buffer.concat(chunks));
}

async function uploadToS3(s3: S3Client, bucket: string, key: string, filePath: string): Promise<void> {
  const body = fs.readFileSync(filePath);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
}

async function uploadBufferToS3(s3: S3Client, bucket: string, key: string, data: Buffer | string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data }));
}

function buildTranscriptNdjson(transcript: TranscriptEntry[]): string {
  return transcript.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

function buildTimingJson(runId: string, result: ProviderResult): string {
  return JSON.stringify(
    {
      runId,
      totalTokens: result.totalTokens,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      capturedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

/**
 * Execute a single run against the configured provider backend.
 *
 * Steps:
 * 1. Prepare workdir with inputs/, outputs/, skill/ subdirectories
 * 2. Download skill bundle from S3 if applicable
 * 3. Download input files from eval snapshot
 * 4. Build the prompt (prepend SKILL.md for with_skill mode)
 * 5. Invoke the provider (Claude Code or Codex)
 * 6. Collect output artifacts
 * 7. Upload artifacts, transcript, and timing to S3
 * 8. Return the run result
 */
export async function executeRun(config: RunConfig): Promise<RunResult> {
  const s3 = getS3Client();
  const bucket = getBucket();
  const workdirBase = getWorkdirBase();

  // 1. Prepare workdir
  const workdir = path.join(workdirBase, config.runId);
  const inputsDir = path.join(workdir, "inputs");
  const outputsDir = path.join(workdir, "outputs");
  const skillDir = path.join(workdir, "skill");

  fs.mkdirSync(inputsDir, { recursive: true });
  fs.mkdirSync(outputsDir, { recursive: true });
  fs.mkdirSync(skillDir, { recursive: true });

  // 2. Mount skill bundle
  if (config.skillBundleUri && (config.mode === "with_skill" || config.mode === "old_skill")) {
    const bundlePath = path.join(workdir, "skill-bundle.tar.gz");
    await downloadFromS3(s3, bucket, config.skillBundleUri, bundlePath);
    // Extract the bundle — using execFileSync to avoid shell injection
    const { execFileSync } = await import("node:child_process");
    execFileSync("tar", ["-xzf", bundlePath, "-C", skillDir], { stdio: "pipe" });
  }

  // 3. Mount input files
  if (config.inputFilesManifest) {
    for (const file of config.inputFilesManifest) {
      const dest = path.join(inputsDir, file.key);
      // Prevent path traversal: ensure dest is still within inputsDir
      if (!dest.startsWith(inputsDir + path.sep) && dest !== inputsDir) {
        throw new Error(`Path traversal detected in input file key: ${file.key}`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await downloadFromS3(s3, bucket, file.s3Key, dest);
    }
  }

  // 4. Build prompt
  let fullPrompt = config.prompt;

  if (config.mode === "with_skill" || config.mode === "old_skill") {
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (fs.existsSync(skillMdPath)) {
      const skillContent = fs.readFileSync(skillMdPath, "utf-8");
      fullPrompt = `# Skill Context\n\n${skillContent}\n\n# Task\n\n${config.prompt}`;
    }
  }

  // Inform the agent about directory structure
  fullPrompt += `\n\nWorking directory layout:\n- ./inputs/ — input files for this task\n- ./outputs/ — place your output files here\n- ./skill/ — skill reference files (if applicable)`;

  // 5. Invoke provider
  const result = await executeWithProvider(config.providerConfig, workdir, fullPrompt);

  // 6. Collect outputs
  const artifactKeys: string[] = [];
  const s3Prefix = `runs/${config.iterationId}/${config.runId}`;

  if (fs.existsSync(outputsDir)) {
    const outputFiles = collectFiles(outputsDir);
    for (const filePath of outputFiles) {
      const relPath = path.relative(outputsDir, filePath);
      const s3Key = `${s3Prefix}/outputs/${relPath}`;
      await uploadToS3(s3, bucket, s3Key, filePath);
      artifactKeys.push(s3Key);
    }
  }

  // 7. Upload transcript and timing
  const transcriptNdjson = buildTranscriptNdjson(result.transcript);
  const transcriptKey = `${s3Prefix}/transcript.ndjson`;
  await uploadBufferToS3(s3, bucket, transcriptKey, transcriptNdjson);

  const timingJson = buildTimingJson(config.runId, result);
  const timingKey = `${s3Prefix}/timing.json`;
  await uploadBufferToS3(s3, bucket, timingKey, timingJson);

  // Also write timing.json locally for reference
  fs.writeFileSync(path.join(workdir, "timing.json"), timingJson);

  // 8. Cleanup workdir (optional — keep for debugging in dev)
  // fs.rmSync(workdir, { recursive: true, force: true });

  return {
    runId: config.runId,
    exitCode: result.exitCode,
    totalTokens: result.totalTokens,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    outputText: result.outputText,
    artifactKeys,
    transcriptKey,
    timingKey,
  };
}

/**
 * Recursively collect all file paths in a directory.
 */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }

  return results;
}
