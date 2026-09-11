import type { NextFunction, Request, Response } from "express";

export type HttpError = Error & { status?: number; type?: string };

export type RoomItemRow = {
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
  pinned: 0 | 1;
};

export type PinnableItemRow = {
  id: string;
  expiresAt: number;
  pinned: 0 | 1;
};

export type ExpiredItemRow = {
  id: string;
  room: string;
  filePath: string | null;
};

export type RoomPayload = {
  room: string;
  items: Array<Record<string, unknown>>;
  ttlMs: number;
  maxTextBytes: number;
  maxFileBytes: number;
};

export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;
