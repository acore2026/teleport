import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dbPath, tempRoot, uploadRoot } from "./config.js";

mkdirSync(uploadRoot, { recursive: true });
mkdirSync(tempRoot, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  DROP TABLE IF EXISTS pastes;
  CREATE TABLE IF NOT EXISTS room_items (
    id TEXT PRIMARY KEY,
    room TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('text', 'file')),
    text_content TEXT,
    file_name TEXT,
    mime_type TEXT,
    file_size INTEGER,
    file_path TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    hash TEXT NOT NULL,
    encrypted INTEGER NOT NULL DEFAULT 0,
    crypto_meta TEXT,
    text_encoding TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_room_items_room_expires ON room_items(room, expires_at);
`);

const columns = new Set(
  (db.prepare("PRAGMA table_info(room_items)").all() as Array<{ name: string }>).map((column) => column.name),
);
if (!columns.has("encrypted")) {
  db.exec("ALTER TABLE room_items ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0");
}
if (!columns.has("crypto_meta")) {
  db.exec("ALTER TABLE room_items ADD COLUMN crypto_meta TEXT");
}
if (!columns.has("text_encoding")) {
  db.exec("ALTER TABLE room_items ADD COLUMN text_encoding TEXT");
}

export const insertItem = db.prepare(`
  INSERT INTO room_items (
    id, room, type, text_content, file_name, mime_type, file_size, file_path,
    created_at, expires_at, hash, encrypted, crypto_meta, text_encoding
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
export const selectItems = db.prepare(`
  SELECT
    id,
    room,
    type,
    text_content AS textContent,
    text_encoding AS textEncoding,
    file_name AS fileName,
    mime_type AS mimeType,
    file_size AS fileSize,
    file_path AS filePath,
    created_at AS createdAt,
    expires_at AS expiresAt,
    hash,
    encrypted,
    crypto_meta AS cryptoMeta
  FROM room_items
  WHERE room = ? AND expires_at > ?
  ORDER BY created_at DESC
`);
export const selectItem = db.prepare(`
  SELECT
    id,
    room,
    type,
    text_content AS textContent,
    text_encoding AS textEncoding,
    file_name AS fileName,
    mime_type AS mimeType,
    file_size AS fileSize,
    file_path AS filePath,
    created_at AS createdAt,
    expires_at AS expiresAt,
    hash,
    encrypted,
    crypto_meta AS cryptoMeta
  FROM room_items
  WHERE room = ? AND id = ? AND expires_at > ?
`);
export const selectExpiredItems = db.prepare(`
  SELECT id, room, file_path AS filePath
  FROM room_items
  WHERE expires_at <= ?
`);
export const deleteExpired = db.prepare("DELETE FROM room_items WHERE expires_at <= ?");
export const deleteItem = db.prepare("DELETE FROM room_items WHERE room = ? AND id = ?");
export const selectItemForDelete = db.prepare(`
  SELECT id, room, file_path AS filePath
  FROM room_items
  WHERE room = ? AND id = ?
`);
export const deleteExpiredForRoom = db.prepare("DELETE FROM room_items WHERE room = ? AND expires_at <= ?");
