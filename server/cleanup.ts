import { deleteExpired, selectExpiredItems } from "./database.js";
import { broadcast } from "./events.js";
import { removeStoredFile } from "./files.js";
import type { ExpiredItemRow } from "./types.js";
import { chunkUploadRoot } from "./config.js";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

function removeStaleChunkUploads(now: number) {
  if (!existsSync(chunkUploadRoot)) return;
  for (const room of readdirSync(chunkUploadRoot)) {
    const roomDir = join(chunkUploadRoot, room);
    for (const uploadId of readdirSync(roomDir)) {
      const uploadDir = join(roomDir, uploadId);
      if (now - statSync(uploadDir).mtimeMs > 60 * 60 * 1000) {
        rmSync(uploadDir, { recursive: true, force: true });
      }
    }
  }
}

export function pruneExpired() {
  const now = Date.now();
  removeStaleChunkUploads(now);
  const expired = selectExpiredItems.all(now) as ExpiredItemRow[];
  if (!expired.length) return;

  const rooms = new Set(expired.map((item) => item.room));
  for (const item of expired) removeStoredFile(item.filePath);
  deleteExpired.run(now);
  for (const room of rooms) broadcast(room, "items");
}
