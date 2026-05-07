import { appendFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function appendJsonl(filePath: string, record: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const line = JSON.stringify(record) + "\n";
  await appendFile(filePath, line, "utf-8");
}

export async function readJsonl<T = unknown>(filePath: string): Promise<T[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return content
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}
