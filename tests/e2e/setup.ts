import { execSync } from "node:child_process";
import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { Client as PgClient } from "pg";

/**
 * E2E test environment setup.
 * Verifies all external dependencies are available and configured.
 */

function checkCliInstalled(name: string, command: string): boolean {
  try {
    execSync(`${command} --version`, { stdio: "pipe" });
    console.log(`  [OK] ${name} is installed`);
    return true;
  } catch {
    console.error(`  [FAIL] ${name} is NOT installed. Install with: npm install -g ${name}`);
    return false;
  }
}

function checkEnvVar(name: string): boolean {
  if (process.env[name]) {
    console.log(`  [OK] ${name} is set`);
    return true;
  }
  console.error(`  [FAIL] ${name} is not set`);
  return false;
}

async function checkPostgres(): Promise<boolean> {
  const url = process.env["DATABASE_URL"] ?? "postgresql://skillshub:skillshub@localhost:5432/skillshub";
  const client = new PgClient({ connectionString: url });
  try {
    await client.connect();
    await client.query("SELECT 1");
    console.log("  [OK] PostgreSQL is reachable");
    return true;
  } catch (err) {
    console.error(`  [FAIL] PostgreSQL is not reachable: ${(err as Error).message}`);
    return false;
  } finally {
    await client.end();
  }
}

async function checkAndCreateS3Bucket(): Promise<boolean> {
  const s3 = new S3Client({
    endpoint: process.env["S3_ENDPOINT"] ?? "http://localhost:9000",
    region: "us-east-1",
    credentials: {
      accessKeyId: process.env["S3_ACCESS_KEY"] ?? "minioadmin",
      secretAccessKey: process.env["S3_SECRET_KEY"] ?? "minioadmin",
    },
    forcePathStyle: true,
  });

  const bucket = process.env["S3_BUCKET"] ?? "skillshub-artifacts";

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`  [OK] S3 bucket '${bucket}' exists`);
    return true;
  } catch {
    console.log(`  [INFO] S3 bucket '${bucket}' does not exist, creating...`);
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`  [OK] S3 bucket '${bucket}' created`);
      return true;
    } catch (err) {
      console.error(`  [FAIL] Could not create S3 bucket: ${(err as Error).message}`);
      return false;
    }
  }
}

function runMigrations(): boolean {
  try {
    execSync("pnpm db:migrate", { stdio: "pipe", cwd: process.cwd() });
    console.log("  [OK] Database migrations applied");
    return true;
  } catch (err) {
    console.error(`  [WARN] Database migrations failed: ${(err as Error).message}`);
    // Non-fatal for now — migrations may not be wired up yet
    return true;
  }
}

export async function setupE2E(): Promise<{ ready: boolean; skippedBackends: string[] }> {
  console.log("\n=== SkillsHub E2E Setup ===\n");
  const issues: string[] = [];
  const skippedBackends: string[] = [];

  // 1. Check CLIs
  console.log("Checking CLI tools:");
  if (!checkCliInstalled("Claude Code CLI", "claude")) {
    skippedBackends.push("claude-code");
  }
  if (!checkCliInstalled("Codex CLI", "codex")) {
    skippedBackends.push("codex");
  }

  // 2. Check API keys
  console.log("\nChecking API keys:");
  if (!checkEnvVar("ANTHROPIC_API_KEY")) {
    if (!skippedBackends.includes("claude-code")) skippedBackends.push("claude-code");
  }
  if (!checkEnvVar("OPENAI_API_KEY")) {
    if (!skippedBackends.includes("codex")) skippedBackends.push("codex");
  }

  // 3. Check Postgres
  console.log("\nChecking PostgreSQL:");
  if (!(await checkPostgres())) {
    issues.push("PostgreSQL not available");
  }

  // 4. Check S3 / MinIO
  console.log("\nChecking S3 (MinIO):");
  if (!(await checkAndCreateS3Bucket())) {
    issues.push("S3/MinIO not available");
  }

  // 5. Run migrations
  console.log("\nRunning migrations:");
  runMigrations();

  // Summary
  console.log("\n=== Setup Summary ===");
  if (issues.length > 0) {
    console.error("Critical issues:", issues);
  }
  if (skippedBackends.length > 0) {
    console.log("Backends that will be skipped:", skippedBackends);
  }

  const ready = issues.length === 0;
  console.log(`\nReady to run E2E tests: ${ready ? "YES" : "NO"}\n`);

  return { ready, skippedBackends };
}
