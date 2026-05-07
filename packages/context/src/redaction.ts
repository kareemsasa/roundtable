/**
 * Scans content for leaked secrets and replaces them with [REDACTED].
 */
export function redactSecrets(content: string): string {
  let result = content;

  // 1. Private key blocks: -----BEGIN ... PRIVATE KEY-----...-----END ... PRIVATE KEY-----
  result = result.replace(
    /-----BEGIN\s+[\w\s]*PRIVATE KEY-----[\s\S]*?-----END\s+[\w\s]*PRIVATE KEY-----/g,
    "[REDACTED]",
  );

  // 2. Assignment patterns — must come before token patterns since tokens
  //    may appear in assignment values
  //    Match: KEY="value", KEY='value', KEY=value (to end of line)
  const secretAssignmentKeys = [
    "API_KEY",
    "SECRET",
    "SECRET_KEY",
    "PRIVATE_KEY",
    "ACCESS_TOKEN",
    "AUTH_TOKEN",
    "DATABASE_URL",
    "DB_PASSWORD",
    "AWS_SECRET_ACCESS_KEY",
  ];

  for (const key of secretAssignmentKeys) {
    // Escape the key for regex (most are plain alphanumeric but be safe)
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match KEY=<value> where value can be quoted or unquoted, to end of line
    const pattern = new RegExp(`(${escapedKey})=(?:"[^"]*"|'[^']*'|[^\\s]*)`, "g");
    result = result.replace(pattern, `$1=[REDACTED]`);
  }

  // 3. Bearer tokens: Bearer <token>
  result = result.replace(/Bearer\s+\S+/g, "Bearer [REDACTED]");

  // 4. API key patterns: sk-proj-..., ghp_..., ghu_...
  result = result.replace(/sk-proj-[A-Za-z0-9_-]+/g, "[REDACTED]");
  result = result.replace(/ghp_[A-Za-z0-9]+/g, "[REDACTED]");
  result = result.replace(/ghu_[A-Za-z0-9]+/g, "[REDACTED]");

  return result;
}
