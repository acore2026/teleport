import { join, resolve } from "node:path";

export const appRoot = process.cwd();
export const distDir = join(appRoot, "dist");
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(appRoot, "data");
export const uploadRoot = join(dataDir, "uploads");
export const tempRoot = join(dataDir, "tmp");
export const dbPath = join(dataDir, "pasteroom.sqlite");
export const host = process.env.HOST || "0.0.0.0";
export const port = Number(process.env.PORT || 7777);
export const ttlMs = 24 * 60 * 60 * 1000;
export const maxTextBytes = Number(process.env.MAX_TEXT_BYTES || 10 * 1024 * 1024);
export const maxFileBytes = 200 * 1024 * 1024;
export const cleanupIntervalMs = 60 * 1000;
