import { z } from "zod";

export const ContextConfigSchema = z.object({
  budgetBytes: z.number().positive(),
  maxFiles: z.number().positive().int(),
  maxFileBytes: z.number().positive(),
  maxTreeDepth: z.number().positive().int(),
  includes: z.array(z.string()).optional(),
  excludes: z.array(z.string()).optional(),
});

export const AdapterLimitsSchema = z.object({
  invocationTimeoutMs: z.number().positive(),
  maxOutputBytes: z.number().positive(),
  gracefulShutdownMs: z.number().positive(),
});

export const AdapterConfigSchema = z.object({
  command: z.string(),
  mode: z.enum(["read_only", "mock"]),
  limits: AdapterLimitsSchema,
});

export const DeliberationLimitsSchema = z.object({
  maxRounds: z.number().positive().int(),
  participantTimeoutMs: z.number().positive(),
  deliberationTimeoutMs: z.number().positive(),
  maxTranscriptBytes: z.number().positive().optional(),
});

export const RoundtableConfigSchema = z.object({
  dataDir: z.string(),
  context: ContextConfigSchema,
  deliberation: DeliberationLimitsSchema,
  adapters: z.object({
    claude: AdapterConfigSchema,
    codex: AdapterConfigSchema,
    steward: AdapterConfigSchema,
  }),
});

/** Partial config shape used for YAML files and CLI overrides */
export const PartialConfigSchema = RoundtableConfigSchema.deepPartial();

export type PartialConfig = z.infer<typeof PartialConfigSchema>;
