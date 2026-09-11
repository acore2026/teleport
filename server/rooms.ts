import { maxFileBytes, maxTextBytes, ttlMs } from "./config.js";
import { deleteExpiredForRoom, selectItems } from "./database.js";
import type { RoomItemRow, RoomPayload } from "./types.js";

function serializeItem(row: RoomItemRow): Record<string, unknown> {
  const base = {
    id: row.id,
    room: row.room,
    type: row.type,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    hash: row.hash,
    pinned: Boolean(row.pinned),
    encrypted: Boolean(row.encrypted),
    cryptoMeta: row.cryptoMeta ? JSON.parse(row.cryptoMeta) : null,
  };

  if (row.type === "file") {
    return {
      ...base,
      encrypted: false,
      cryptoMeta: null,
      fileName: row.fileName,
      mimeType: row.mimeType || "application/octet-stream",
      fileSize: row.fileSize || 0,
      downloadUrl: `/api/rooms/${encodeURIComponent(row.room)}/items/${encodeURIComponent(row.id)}/download`,
    };
  }

  return {
    ...base,
    textContent: row.textContent || "",
    textEncoding: row.textEncoding || null,
    bytes: Buffer.byteLength(row.textContent || ""),
  };
}

function listItems(room: string) {
  deleteExpiredForRoom.run(room, Date.now());
  return (selectItems.all(room, Date.now()) as RoomItemRow[]).map(serializeItem);
}

export function payloadFor(room: string): RoomPayload {
  return { room, items: listItems(room), ttlMs, maxTextBytes, maxFileBytes };
}
