import type { NextFunction, Request, RequestHandler, Response } from "express";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { rename } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { appRoot, distDir, maxFileBytes, maxTextBytes, tempRoot, ttlMs, uploadRoot } from "./config.js";
import { deleteItem, insertItem, selectItem, selectItemForDelete } from "./database.js";
import { broadcast, channelFor, channels, sendEvent } from "./events.js";
import { hashBuffer, hashFile, removeStoredFile, safeFileName } from "./files.js";
import { payloadFor } from "./rooms.js";
import { parseChunkRequest, receiveUploadChunk } from "./chunk-uploads.js";
import type { AsyncHandler, ExpiredItemRow, HttpError, RoomItemRow } from "./types.js";

const upload = multer({
  dest: tempRoot,
  limits: {
    fileSize: maxFileBytes,
    files: 1,
  },
});

function normalizeRoom(value: unknown) {
  const room = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(room)) {
    const error: HttpError = new Error(
      "Room names can only contain letters, numbers, hyphens, and underscores.",
    );
    error.status = 400;
    throw error;
  }
  return room;
}

function asyncRoute(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export const app = express();
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
    "x-accel-buffering": "no",
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
        null,
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
      textEncoding || null,
    );

    broadcast(room, "items");
    res.status(201).json(payloadFor(room));
  }),
);

app.post(
  "/api/rooms/:room/uploads/:uploadId/chunks",
  upload.single("chunk"),
  asyncRoute(async (req, res) => {
    const room = normalizeRoom(req.params.room);
    if (!req.file) {
      res.status(400).json({ error: "Upload chunk is missing." });
      return;
    }
    const metadata = parseChunkRequest(String(req.params.uploadId), req.body as Record<string, unknown>);
    const result = await receiveUploadChunk({ room, tempPath: req.file.path, ...metadata });
    if (!result.complete) {
      res.status(202).json(result);
      return;
    }
    broadcast(room, "items");
    res.status(201).json(payloadFor(room));
  }),
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
      error: error.type === "entity.too.large" ? "Text content is too large." : "Invalid request body.",
    });
    return;
  }

  res.status(error.status || 500).json({ error: error.message || "Server error" });
});
