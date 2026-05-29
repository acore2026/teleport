import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { rename } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";

type HttpError = Error & { status?: number; type?: string };

type RoomItemRow = {
  id: string;
  room: string;
  type: "text" | "file";
  textContent: string | null;
  textEncoding: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  filePath: string | null;
  createdAt: number;
  expiresAt: number;
  hash: string;
  encrypted: 0 | 1;
  cryptoMeta: string | null;
};

type ExpiredItemRow = {
  id: string;
  room: string;
  filePath: string | null;
};

type RoomPayload = {
  room: string;
  items: Array<Record<string, unknown>>;
  ttlMs: number;
  maxTextBytes: number;
  maxFileBytes: number;
};

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

const appRoot = process.cwd();
const distDir = join(appRoot, "dist");
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(appRoot, "data");
const uploadRoot = join(dataDir, "uploads");
const tempRoot = join(dataDir, "tmp");
const dbPath = join(dataDir, "pasteroom.sqlite");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 7777);
const ttlMs = 24 * 60 * 60 * 1000;
const maxTextBytes = Number(process.env.MAX_TEXT_BYTES || 10 * 1024 * 1024);
const maxFileBytes = 200 * 1024 * 1024;
const cleanupIntervalMs = 60 * 1000;

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
  (db.prepare("PRAGMA table_info(room_items)").all() as Array<{ name: string }>).map((column) => column.name)
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

const insertItem = db.prepare(`
  INSERT INTO room_items (
    id, room, type, text_content, file_name, mime_type, file_size, file_path,
    created_at, expires_at, hash, encrypted, crypto_meta, text_encoding
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectItems = db.prepare(`
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
const selectItem = db.prepare(`
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
const selectExpiredItems = db.prepare(`
  SELECT id, room, file_path AS filePath
  FROM room_items
  WHERE expires_at <= ?
`);
const deleteExpired = db.prepare("DELETE FROM room_items WHERE expires_at <= ?");
const deleteItem = db.prepare("DELETE FROM room_items WHERE room = ? AND id = ?");
const selectItemForDelete = db.prepare(`
  SELECT id, room, file_path AS filePath
  FROM room_items
  WHERE room = ? AND id = ?
`);
const deleteExpiredForRoom = db.prepare("DELETE FROM room_items WHERE room = ? AND expires_at <= ?");

const upload = multer({
  dest: tempRoot,
  limits: {
    fileSize: maxFileBytes,
    files: 1
  }
});

const channels = new Map<string, Set<Response>>();

function normalizeRoom(value: unknown) {
  const room = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(room)) {
    const error: HttpError = new Error("Room names can only contain letters, numbers, hyphens, and underscores.");
    error.status = 400;
    throw error;
  }
  return room;
}

function safeFileName(value: unknown) {
  const name = String(value || "file").replace(/[/\\]/g, "_").trim();
  return name.slice(0, 180) || "file";
}

function hashBuffer(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function hashFile(path: string) {
  return new Promise<string>((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex").slice(0, 16)));
  });
}

function removeStoredFile(filePath: string | null) {
  if (!filePath) return;
  const absolutePath = resolve(appRoot, filePath);
  if (!absolutePath.startsWith(resolve(uploadRoot))) return;
  rmSync(dirname(absolutePath), { recursive: true, force: true });
}

function serializeItem(row: RoomItemRow): Record<string, unknown> {
  const base = {
    id: row.id,
    room: row.room,
    type: row.type,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    hash: row.hash,
    encrypted: Boolean(row.encrypted),
    cryptoMeta: row.cryptoMeta ? JSON.parse(row.cryptoMeta) : null
  };

  if (row.type === "file") {
    return {
      ...base,
      encrypted: false,
      cryptoMeta: null,
      fileName: row.fileName,
      mimeType: row.mimeType || "application/octet-stream",
      fileSize: row.fileSize || 0,
      downloadUrl: `/api/rooms/${encodeURIComponent(row.room)}/items/${encodeURIComponent(row.id)}/download`
    };
  }

  return {
    ...base,
    textContent: row.textContent || "",
    textEncoding: row.textEncoding || null,
    bytes: Buffer.byteLength(row.textContent || "")
  };
}

function listItems(room: string) {
  deleteExpiredForRoom.run(room, Date.now());
  return (selectItems.all(room, Date.now()) as RoomItemRow[]).map(serializeItem);
}

function payloadFor(room: string): RoomPayload {
  return { room, items: listItems(room), ttlMs, maxTextBytes, maxFileBytes };
}

function sendEvent(res: Response, event: string, payload: RoomPayload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function channelFor(room: string) {
  let clients = channels.get(room);
  if (!clients) {
    clients = new Set();
    channels.set(room, clients);
  }
  return clients;
}

function broadcast(room: string, event = "items") {
  const clients = channels.get(room);
  if (!clients?.size) return;

  const payload = payloadFor(room);
  for (const client of clients) {
    sendEvent(client, event, payload);
  }
}

function pruneExpired() {
  const now = Date.now();
  const expired = selectExpiredItems.all(now) as ExpiredItemRow[];
  if (!expired.length) return;

  const rooms = new Set(expired.map((item) => item.room));
  for (const item of expired) removeStoredFile(item.filePath);
  deleteExpired.run(now);
  for (const room of rooms) broadcast(room, "items");
}

function asyncRoute(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const app = express();
app.disable("x-powered-by");
app.use("/api", (req, res, next) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: maxTextBytes * 4 }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, name: "teleport", ttlMs, maxTextBytes, maxFileBytes });
});

app.get("/api/rooms/:room/items", (req, res) => {
  const room = normalizeRoom(req.params.room);
  res.json(payloadFor(room));
});

app.get("/api/rooms/:room/events", (req, res) => {
  const room = normalizeRoom(req.params.room);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  sendEvent(res, "items", payloadFor(room));

  const clients = channelFor(room);
  clients.add(res);
  const heartbeat = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (!clients.size) channels.delete(room);
  });
});

app.post(
  "/api/rooms/:room/items",
  upload.single("file"),
  asyncRoute(async (req, res) => {
    const room = normalizeRoom(req.params.room);
    const now = Date.now();
    const id = randomUUID();

    if (req.file) {
      const roomDir = join(uploadRoot, room, id);
      mkdirSync(roomDir, { recursive: true });
      const fileName = safeFileName(req.file.originalname);
      const storedPath = join(roomDir, fileName);
      await rename(req.file.path, storedPath);

      const relativePath = relative(appRoot, storedPath);
      const hash = await hashFile(storedPath);
      insertItem.run(
        id,
        room,
        "file",
        null,
        fileName,
        req.file.mimetype || "application/octet-stream",
        req.file.size,
        relativePath,
        now,
        now + ttlMs,
        hash,
        0,
        null,
        null
      );

      broadcast(room, "items");
      res.status(201).json(payloadFor(room));
      return;
    }

    const encrypted = req.body.encrypted === true;
    const cryptoMeta = encrypted ? JSON.stringify(req.body.cryptoMeta || null) : null;
    const textEncoding = encrypted ? null : String(req.body.textEncoding || "");
    const textContent = encrypted ? String(req.body.content || "") : String(req.body.content || "").trimEnd();
    if (textEncoding && textEncoding !== "gzip-base64") {
      res.status(400).json({ error: "Unsupported text encoding." });
      return;
    }
    if (!textContent.trim() || (encrypted && !cryptoMeta)) {
      res.status(400).json({ error: "Text content is empty." });
      return;
    }

    if (Buffer.byteLength(textContent) > (encrypted ? maxTextBytes * 3 : maxTextBytes)) {
      res.status(413).json({ error: "Text content is too large." });
      return;
    }

    insertItem.run(
      id,
      room,
      "text",
      textContent,
      null,
      null,
      null,
      null,
      now,
      now + ttlMs,
      hashBuffer(textContent),
      encrypted ? 1 : 0,
      cryptoMeta,
      textEncoding || null
    );

    broadcast(room, "items");
    res.status(201).json(payloadFor(room));
  })
);

app.get("/api/rooms/:room/items/:id/download", (req, res, next) => {
  try {
    const room = normalizeRoom(req.params.room);
    const row = selectItem.get(room, req.params.id, Date.now()) as RoomItemRow | undefined;

    if (!row || row.type !== "file" || !row.filePath) {
      res.status(404).json({ error: "File not found." });
      return;
    }

    const filePath = resolve(appRoot, row.filePath);
    if (!filePath.startsWith(resolve(uploadRoot)) || !existsSync(filePath)) {
      res.status(404).json({ error: "File not found." });
      return;
    }

    res.download(filePath, row.fileName || "download");
  } catch (error) {
    next(error);
  }
});

app.delete("/api/rooms/:room/items/:id", (req, res) => {
  const room = normalizeRoom(req.params.room);
  const item = selectItemForDelete.get(room, req.params.id) as ExpiredItemRow | undefined;
  if (item) removeStoredFile(item.filePath);
  deleteItem.run(room, req.params.id);
  broadcast(room, "items");
  res.json(payloadFor(room));
});

if (existsSync(distDir)) {
  app.use(express.static(distDir, { etag: false, maxAge: 0 }));
  app.get(/.*/, (req, res) => {
    res.sendFile(join(distDir, "index.html"));
  });
}

app.use((error: HttpError, req: Request, res: Response, next: NextFunction) => {
  if (req.file?.path) {
    try {
      unlinkSync(req.file.path);
    } catch {
      // Ignore cleanup failures for temp files.
    }
  }

  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "File is too large. Maximum size is 200 MB." });
    return;
  }

  if (error.type === "entity.too.large" || error.type === "entity.parse.failed") {
    res.status(error.status || 400).json({
      error: error.type === "entity.too.large" ? "Text content is too large." : "Invalid request body."
    });
    return;
  }

  res.status(error.status || 500).json({ error: error.message || "Server error" });
});

pruneExpired();
setInterval(pruneExpired, cleanupIntervalMs).unref();

app.listen(port, host, () => {
  console.log(`teleport listening on http://${host}:${port}`);
});
