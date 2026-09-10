import { existsSync, mkdirSync, rmSync } from "node:fs";
import { appendFile, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  appRoot,
  chunkUploadRoot,
  maxFileBytes,
  maxUploadChunkBytes,
  minUploadChunkBytes,
  ttlMs,
  uploadRoot,
} from "./config.js";
import { insertItem, selectItem } from "./database.js";
import { hashFile, safeFileName } from "./files.js";
import type { HttpError, RoomItemRow } from "./types.js";

type ChunkMetadata = {
  fileName: string;
  mimeType: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
};

type ReceiveChunkOptions = ChunkMetadata & {
  room: string;
  uploadId: string;
  chunkIndex: number;
  tempPath?: string;
  chunkData?: Buffer;
};

function invalidChunk(message: string) {
  const error: HttpError = new Error(message);
  error.status = 400;
  return error;
}

export function parseChunkRequest(uploadId: string, body: Record<string, unknown>) {
  if (!/^[a-f0-9-]{36}$/i.test(uploadId)) throw invalidChunk("Invalid upload ID.");
  const fileSize = Number(body.fileSize);
  const chunkIndex = Number(body.chunkIndex);
  const totalChunks = Number(body.totalChunks);
  const chunkSize = Number(body.chunkSize);
  if (!Number.isSafeInteger(fileSize) || fileSize < 0 || fileSize > maxFileBytes) {
    throw invalidChunk("Invalid file size.");
  }
  if (
    !Number.isSafeInteger(chunkSize) ||
    chunkSize < minUploadChunkBytes ||
    chunkSize > maxUploadChunkBytes
  ) {
    throw invalidChunk("Invalid chunk size.");
  }
  if (!Number.isSafeInteger(totalChunks) || totalChunks !== Math.max(1, Math.ceil(fileSize / chunkSize))) {
    throw invalidChunk("Invalid chunk count.");
  }
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks) {
    throw invalidChunk("Invalid chunk index.");
  }
  return {
    uploadId,
    fileName: safeFileName(body.fileName),
    mimeType: String(body.mimeType || "application/octet-stream").slice(0, 180),
    fileSize,
    chunkSize,
    chunkIndex,
    totalChunks,
  };
}

export function parseBase64Chunk(value: unknown) {
  if (typeof value !== "string") throw invalidChunk("Upload chunk is missing.");
  const maximumEncodedLength = Math.ceil(maxUploadChunkBytes / 3) * 4;
  if (value.length > maximumEncodedLength || value.length % 4 !== 0) {
    throw invalidChunk("Upload chunk encoding is invalid.");
  }
  if (value && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw invalidChunk("Upload chunk encoding is invalid.");
  }
  return Buffer.from(value, "base64");
}

export async function receiveUploadChunk(options: ReceiveChunkOptions) {
  const existing = selectItem.get(options.room, options.uploadId, Date.now()) as RoomItemRow | undefined;
  if (existing) {
    if (existing.type !== "file") throw invalidChunk("Upload ID is already in use.");
    if (options.tempPath) await unlink(options.tempPath).catch(() => undefined);
    return { complete: true, uploadedChunks: options.totalChunks };
  }

  const uploadDir = join(chunkUploadRoot, options.room, options.uploadId);
  const manifestPath = join(uploadDir, "manifest.json");
  const metadata: ChunkMetadata = {
    fileName: options.fileName,
    mimeType: options.mimeType,
    fileSize: options.fileSize,
    chunkSize: options.chunkSize,
    totalChunks: options.totalChunks,
  };
  mkdirSync(uploadDir, { recursive: true });

  if (existsSync(manifestPath)) {
    const stored = JSON.parse(await readFile(manifestPath, "utf8")) as ChunkMetadata;
    if (JSON.stringify(stored) !== JSON.stringify(metadata)) {
      throw invalidChunk("Chunk metadata does not match this upload.");
    }
  } else {
    await writeFile(manifestPath, JSON.stringify(metadata), { flag: "wx" }).catch(async (caught) => {
      if ((caught as NodeJS.ErrnoException).code !== "EEXIST") throw caught;
    });
  }

  const partPath = join(uploadDir, `${options.chunkIndex}.part`);
  if (options.tempPath) {
    await rename(options.tempPath, partPath);
  } else if (options.chunkData) {
    await writeFile(partPath, options.chunkData);
  } else {
    throw invalidChunk("Upload chunk is missing.");
  }
  const expectedPartSize = Math.min(
    options.chunkSize,
    Math.max(0, options.fileSize - options.chunkIndex * options.chunkSize),
  );
  if ((await stat(partPath)).size !== expectedPartSize) {
    rmSync(uploadDir, { recursive: true, force: true });
    throw invalidChunk("Upload chunk has the wrong size.");
  }
  const partPaths = Array.from({ length: options.totalChunks }, (_, index) =>
    join(uploadDir, `${index}.part`),
  );
  const available = partPaths.filter(existsSync).length;
  if (available !== options.totalChunks) return { complete: false, uploadedChunks: available };

  const sizes = await Promise.all(partPaths.map((path) => stat(path).then((value) => value.size)));
  if (sizes.reduce((sum, size) => sum + size, 0) !== options.fileSize) {
    rmSync(uploadDir, { recursive: true, force: true });
    throw invalidChunk("Uploaded chunks do not match the file size.");
  }

  const storedDir = join(uploadRoot, options.room, options.uploadId);
  const storedPath = join(storedDir, options.fileName);
  mkdirSync(storedDir, { recursive: true });
  await rename(partPaths[0], storedPath);
  for (const partPath of partPaths.slice(1)) {
    await appendFile(storedPath, await readFile(partPath));
    await unlink(partPath);
  }

  const now = Date.now();
  insertItem.run(
    options.uploadId,
    options.room,
    "file",
    null,
    options.fileName,
    options.mimeType,
    options.fileSize,
    relative(appRoot, storedPath),
    now,
    now + ttlMs,
    await hashFile(storedPath),
    0,
    null,
    null,
  );
  rmSync(uploadDir, { recursive: true, force: true });
  return { complete: true, uploadedChunks: options.totalChunks };
}
