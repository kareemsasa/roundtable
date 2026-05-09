import type { WardroomConfig } from "@wardroom/core";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_ADAPTER_LIMITS = {
  invocationTimeoutMs: 120_000,
  maxOutputBytes: 512_000,
  gracefulShutdownMs: 5_000,
};

export function getDefaultDataDir(): string {
  return join(homedir(), ".local", "share", "wardroom");
}

export const DEFAULT_CONFIG: WardroomConfig = {
  dataDir: getDefaultDataDir(),
  context: {
    budgetBytes: 140_000,
    maxFiles: 75,
    maxFileBytes: 10_000,
    maxTreeDepth: 5,
  },
  deliberation: {
    maxRounds: 2,
    participantTimeoutMs: 120_000,
    deliberationTimeoutMs: 600_000,
    maxTranscriptBytes: 131_072,
  },
  adapters: {
    claude: { command: "claude", mode: "read_only", limits: DEFAULT_ADAPTER_LIMITS },
    codex: { command: "codex", mode: "read_only", limits: DEFAULT_ADAPTER_LIMITS },
    steward: { command: "claude", mode: "read_only", limits: DEFAULT_ADAPTER_LIMITS },
  },
};
