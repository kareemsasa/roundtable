import { describe, it, expect } from "vitest";
import { redactSecrets } from "../redaction.js";

describe("redactSecrets", () => {
  it("redacts private key blocks", () => {
    const input = `some text
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA2Z3qX2BTLS4e...
-----END RSA PRIVATE KEY-----
more text`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("MIIEpAIBAAKCAQEA2Z3qX2BTLS4e");
    expect(result).toContain("some text");
    expect(result).toContain("more text");
  });

  it("redacts EC private key blocks", () => {
    const input = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIBkg...
-----END EC PRIVATE KEY-----`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("MHQCAQEEIBkg");
  });

  it("redacts bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123";
    const result = redactSecrets(input);
    expect(result).toContain("Bearer [REDACTED]");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("redacts sk-proj- API keys", () => {
    const input = 'const key = "sk-proj-abc123def456"';
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("sk-proj-abc123def456");
  });

  it("redacts ghp_ tokens", () => {
    const input = "GITHUB_TOKEN=ghp_abcdefghijklmnop1234567890";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("ghp_abcdefghijklmnop1234567890");
  });

  it("redacts ghu_ tokens", () => {
    const input = 'token: "ghu_xxxxxxxxxxxxxxxxxxxx"';
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("ghu_xxxxxxxxxxxxxxxxxxxx");
  });

  it("redacts API_KEY assignments", () => {
    const input = 'API_KEY="my-secret-api-key-123"';
    const result = redactSecrets(input);
    expect(result).toContain("API_KEY=[REDACTED]");
    expect(result).not.toContain("my-secret-api-key-123");
  });

  it("redacts SECRET= assignments", () => {
    const input = "SECRET=mysecretvalue";
    const result = redactSecrets(input);
    expect(result).toContain("SECRET=[REDACTED]");
    expect(result).not.toContain("mysecretvalue");
  });

  it("redacts SECRET_KEY= assignments", () => {
    const input = "SECRET_KEY=supersecret123";
    const result = redactSecrets(input);
    expect(result).toContain("SECRET_KEY=[REDACTED]");
    expect(result).not.toContain("supersecret123");
  });

  it("redacts PRIVATE_KEY= assignments", () => {
    const input = 'PRIVATE_KEY="pk_live_abc123"';
    const result = redactSecrets(input);
    expect(result).toContain("PRIVATE_KEY=[REDACTED]");
    expect(result).not.toContain("pk_live_abc123");
  });

  it("redacts ACCESS_TOKEN= assignments", () => {
    const input = "ACCESS_TOKEN=token123abc";
    const result = redactSecrets(input);
    expect(result).toContain("ACCESS_TOKEN=[REDACTED]");
    expect(result).not.toContain("token123abc");
  });

  it("redacts AUTH_TOKEN= assignments", () => {
    const input = "AUTH_TOKEN=auth_secret_xyz";
    const result = redactSecrets(input);
    expect(result).toContain("AUTH_TOKEN=[REDACTED]");
    expect(result).not.toContain("auth_secret_xyz");
  });

  it("redacts DATABASE_URL= assignments", () => {
    const input = "DATABASE_URL=postgres://user:pass@host:5432/db";
    const result = redactSecrets(input);
    expect(result).toContain("DATABASE_URL=[REDACTED]");
    expect(result).not.toContain("postgres://user:pass@host:5432/db");
  });

  it("redacts DB_PASSWORD= assignments", () => {
    const input = 'DB_PASSWORD="hunter2"';
    const result = redactSecrets(input);
    expect(result).toContain("DB_PASSWORD=[REDACTED]");
    expect(result).not.toContain("hunter2");
  });

  it("redacts AWS_SECRET_ACCESS_KEY= assignments", () => {
    const input = "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const result = redactSecrets(input);
    expect(result).toContain("AWS_SECRET_ACCESS_KEY=[REDACTED]");
    expect(result).not.toContain("wJalrXUtnFEMI");
  });

  it("leaves normal code untouched", () => {
    const input = `const x = 42;
function hello() {
  return "world";
}
const SECRET_PATTERN = /^[A-Z]+$/;`;
    const result = redactSecrets(input);
    expect(result).toBe(input);
  });

  it("leaves comments and non-secret strings alone", () => {
    const input = `// This is a comment about API keys
const config = { timeout: 5000 };
const message = "Hello, world!";`;
    const result = redactSecrets(input);
    expect(result).toBe(input);
  });

  it("handles multiple secrets in one string", () => {
    const input = `API_KEY="secret1"
SECRET=secret2
Bearer token123abc`;
    const result = redactSecrets(input);
    expect(result).toContain("API_KEY=[REDACTED]");
    expect(result).toContain("SECRET=[REDACTED]");
    expect(result).toContain("Bearer [REDACTED]");
    expect(result).not.toContain("secret1");
    expect(result).not.toContain("secret2");
    expect(result).not.toContain("token123abc");
  });
});
