import { z } from "zod";

export const BackendSchema = z.enum(["claude-code", "codex"]);

export const ProviderSchema = z.enum(["anthropic", "openai"]);

export const ModelConfigSchema = z.object({
  backend: BackendSchema,
  provider: ProviderSchema,
  modelId: z.string(),
  maxTurns: z.number().optional(),
  allowedTools: z.array(z.string()).optional(),
  additionalFlags: z.record(z.string()).optional(),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ToolConfigSchema = z.object({
  allowFileIO: z.boolean(),
  allowNetwork: z.boolean(),
  allowShell: z.boolean().optional(),
});

export type ToolConfig = z.infer<typeof ToolConfigSchema>;

export const IterationStartPayloadSchema = z.object({
  skillVersionId: z.string(),
  evalSetId: z.string(),
  baselineMode: z.enum(["without_skill", "old_skill"]),
  modelConfig: ModelConfigSchema,
  toolConfig: ToolConfigSchema,
});

export type IterationStartPayload = z.infer<typeof IterationStartPayloadSchema>;

/**
 * Maps a backend type to its underlying API provider.
 */
export function providerForBackend(backend: z.infer<typeof BackendSchema>): z.infer<typeof ProviderSchema> {
  switch (backend) {
    case "claude-code":
      return "anthropic";
    case "codex":
      return "openai";
  }
}
