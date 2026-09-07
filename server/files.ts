import { createHash } from "node:crypto";
import { createReadStream, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appRoot, uploadRoot } from "./config.js";

export function safeFileName(value: unknown) {
  const name = String(value || "file")
    .replace(/[/\\]/g, "_")
    .trim();
  return name.slice(0, 180) || "file";
}

export function hashBuffer(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function hashFile(path: string) {
  return new Promise<string>((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex").slice(0, 16)));
  });
}

export function removeStoredFile(filePath: string | null) {
  if (!filePath) return;
  const absolutePath = resolve(appRoot, filePath);
  if (!absolutePath.startsWith(resolve(uploadRoot))) return;
  rmSync(dirname(absolutePath), { recursive: true, force: true });
}
