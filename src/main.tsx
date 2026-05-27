import React from "react";
import { createRoot } from "react-dom/client";
import CryptoJS from "crypto-js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Image } from "@tauri-apps/api/image";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  clear as clearClipboard,
  readImage as readClipboardImage,
  readText as readClipboardText,
  writeImage as writeClipboardImage,
  writeText as writeClipboardText,
} from "@tauri-apps/plugin-clipboard-manager";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { isPermissionGranted, onAction, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { Store } from "@tauri-apps/plugin-store";
import {
  ArrowLeft,
  ChevronDown,
  Check,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderUp,
  HardDriveUpload,
  Keyboard,
  Link2,
  LockKeyhole,
  Maximize2,
  Plus,
  Send,
  Settings,
  Trash2,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import "./styles.css";

type RoomItem =
  | {
      id: string;
      room: string;
      type: "text";
      textContent: string;
      bytes: number;
      createdAt: number;
      expiresAt: number;
      hash: string;
      encrypted?: boolean;
      cryptoMeta?: CryptoEnvelope | null;
    }
  | {
      id: string;
      room: string;
      type: "file";
      fileName: string;
      mimeType: string;
      fileSize: number;
      downloadUrl: string;
      createdAt: number;
      expiresAt: number;
      hash: string;
      encrypted?: boolean;
      cryptoMeta?: CryptoEnvelope | null;
    };

type RoomPayload = {
  room: string;
  items: RoomItem[];
  ttlMs: number;
  maxFileBytes: number;
};

type UploadProgress = {
  fileName: string;
  index: number;
  totalFiles: number;
  percent: number;
  loaded: number;
  total: number;
  processing: boolean;
};

type ClipboardSnapshot =
  | { type: "text"; text: string; signature: string }
  | { type: "image"; image: Image; signature: string }
  | { type: "empty" };

type RecentRoom = {
  room: string;
  at: number;
};

type NewItemNotice = {
  id: string;
  title: string;
  detail: string;
};

type DesktopShortcuts = {
  openPanel: string;
  copy: string;
  paste: string;
};

type DesktopStateSync = {
  room?: string;
  serverUrl?: string;
  roomPassword?: string;
};

type CryptoEnvelope = {
  v: 1 | 2;
  cipher: "AES-CBC-HMAC-SHA256";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  mac: string;
  data?: string;
};

const roomKey = "teleport-active-room";
const recentRoomsKey = "teleport-recent-rooms";
const roomPasswordsKey = "teleport-room-passwords";
const serverUrlKey = "teleport-server-url";
const minifiedModeKey = "teleport-minified-mode";
const openPanelShortcutKey = "teleport-shortcut-toggle-mini";
const copyShortcutKey = "teleport-shortcut-copy";
const pasteShortcutKey = "teleport-shortcut-paste";
const autoCaptureClipboardKey = "teleport-auto-capture-clipboard";
const autoCopyIncomingKey = "teleport-auto-copy-incoming";
const notificationsEnabledKey = "teleport-notifications-enabled";
const clipboardLeaseKey = "teleport-clipboard-capture-lease";
const clipboardWriteSignatureKey = "teleport-clipboard-write-signature";
const notificationLeaseKey = "teleport-notification-lease";
const defaultDesktopServerUrl = "http://101.245.78.174:7777";
const textCacheKeyPrefix = "teleport-text-cache";
const maxFileBytes = 200 * 1024 * 1024;
const cryptoIterations = 1000;
const keyCache = new Map<string, { encKey: CryptoJS.lib.WordArray; macKey: CryptoJS.lib.WordArray }>();
const desktopSettingsFile = "settings.json";

function isDesktopRuntime() {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

function initialServerUrl() {
  if (!isDesktopRuntime()) return "";
  try {
    return localStorage.getItem(serverUrlKey) || defaultDesktopServerUrl;
  } catch {
    return defaultDesktopServerUrl;
  }
}

function initialMinifiedMode() {
  if (!isDesktopRuntime()) return false;
  try {
    const stored = localStorage.getItem(minifiedModeKey);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function platformShortcutModifier() {
  if (typeof navigator === "undefined") return "Control";
  const platform = navigator.platform || "";
  const userAgent = navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS|macOS/i.test(userAgent) ? "Command" : "Control";
}

function desktopShortcutDefaults(): DesktopShortcuts {
  const modifier = platformShortcutModifier();
  return {
    openPanel: `${modifier}+Alt+P`,
    copy: `${modifier}+Shift+C`,
    paste: `${modifier}+Shift+V`,
  };
}

const legacyOpenPanelShortcuts = ["Control+Shift+P", "Command+Shift+P"];

function initialBooleanSetting(key: string, fallback: boolean) {
  if (!isDesktopRuntime()) return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

function normalizeStoredShortcut(value: string, fallback: string, legacyValues: string[] = []) {
  return legacyValues.includes(value) ? fallback : value || fallback;
}

function initialShortcut(key: string, fallback: string, legacyValues: string[] = []) {
  if (!isDesktopRuntime()) return fallback;
  try {
    return normalizeStoredShortcut(localStorage.getItem(key) || "", fallback, legacyValues);
  } catch {
    return fallback;
  }
}

function normalizeServerUrl(value: string) {
  const url = value.trim().replace(/\/+$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Server must start with http:// or https://.");
  }
  return url;
}

function normalizeShortcut(value: string, fallback: string) {
  const shortcut = value.trim();
  if (!shortcut) return fallback;
  if (!shortcut.includes("+")) {
    throw new Error(`Shortcut must include at least one modifier, for example ${fallback}.`);
  }
  return shortcut;
}

function displayShortcut(value: string) {
  return value
    .split("+")
    .map((part) => {
      const normalized = part.trim().toLowerCase();
      if (["control", "ctrl"].includes(normalized)) return "Ctrl";
      if (["command", "cmd", "meta", "super"].includes(normalized)) return platformShortcutModifier() === "Command" ? "⌘" : "Ctrl";
      if (normalized === "shift") return "Shift";
      if (normalized === "alt" || normalized === "option") return platformShortcutModifier() === "Command" ? "Option" : "Alt";
      if (normalized === "space") return "Space";
      return part.trim();
    })
    .filter(Boolean)
    .join(" + ");
}

function shortcutFromKeyboardEvent(event: React.KeyboardEvent<HTMLInputElement>) {
  const key = shortcutKeyFromEvent(event);
  if (!key) return "";

  const modifier = platformShortcutModifier();
  const parts: string[] = [];
  if (modifier === "Command" ? event.metaKey : event.ctrlKey) parts.push(modifier);
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (modifier === "Command" && event.ctrlKey) parts.push("Control");
  if (modifier === "Control" && event.metaKey) parts.push("Command");
  if (!parts.length) return "";
  parts.push(key);
  return parts.join("+");
}

function shortcutKeyFromEvent(event: React.KeyboardEvent<HTMLInputElement>) {
  if (["Control", "Shift", "Alt", "Meta", "OS"].includes(event.key)) return "";
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(6);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) return event.key;
  if (event.code === "Space") return "Space";
  if (event.key.startsWith("Arrow")) return event.key;
  if (event.key === "Escape") return "Escape";
  if (event.key === "Tab") return "Tab";
  if (event.key === "Backspace") return "Backspace";
  if (event.key === "Delete") return "Delete";
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key;
}

function shortcutFingerprint(value: string) {
  const platformModifier = platformShortcutModifier().toLowerCase();
  return value
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => {
      if (["ctrl", "control"].includes(part)) return "control";
      if (["cmd", "command", "meta", "super"].includes(part)) return "command";
      if (["cmdorctrl", "commandorcontrol", "commandorctrl"].includes(part)) return platformModifier.toLowerCase();
      if (part === "esc") return "escape";
      if (/^key[a-z]$/.test(part)) return part.slice(3);
      return part;
    })
    .sort()
    .join("+");
}

function shortcutsMatch(left: string, right: string) {
  return shortcutFingerprint(left) === shortcutFingerprint(right);
}

function apiUrl(path: string, serverUrl: string) {
  return serverUrl ? `${serverUrl}${path}` : path;
}

function absoluteItemUrl(downloadUrl: string, serverUrl: string) {
  if (/^https?:\/\//i.test(downloadUrl)) return downloadUrl;
  return serverUrl ? `${serverUrl}${downloadUrl}` : new URL(downloadUrl, window.location.href).href;
}

async function loadDesktopStore() {
  if (!isDesktopRuntime()) return null;
  return Store.load(desktopSettingsFile, { defaults: {}, autoSave: true });
}

async function keychainGet(room: string) {
  if (!isDesktopRuntime()) return passwordForRoom(room);
  try {
    return (await invoke<string | null>("keychain_get", { room })) || "";
  } catch {
    return "";
  }
}

async function keychainSet(room: string, password: string) {
  if (!isDesktopRuntime()) {
    rememberRoomPassword(room, password);
    return;
  }
  try {
    if (password) await invoke("keychain_set", { room, password });
    else await invoke("keychain_delete", { room });
  } catch {
    // The room can still be used; the password just will not persist.
  }
}

function normalizeRoom(value: string) {
  const room = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(room)) {
    throw new Error("Use letters, numbers, hyphens, or underscores.");
  }
  return room;
}

function initialRoom() {
  try {
    const stored = localStorage.getItem(roomKey) || "";
    if (stored === "my-room") return "";
    return stored ? normalizeRoom(stored) : "";
  } catch {
    return "";
  }
}

function readRecentRooms(): RecentRoom[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentRoomsKey) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function rememberRoom(room: string) {
  const rooms = readRecentRooms().filter((entry) => entry.room !== room);
  rooms.unshift({ room, at: Date.now() });
  localStorage.setItem(recentRoomsKey, JSON.stringify(rooms.slice(0, 6)));
}

function readRoomPasswords(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(roomPasswordsKey) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function passwordForRoom(room: string) {
  return readRoomPasswords()[room] || "";
}

function rememberRoomPassword(room: string, password: string) {
  const passwords = readRoomPasswords();
  if (password) passwords[room] = password;
  else delete passwords[room];
  localStorage.setItem(roomPasswordsKey, JSON.stringify(passwords));
}

function textCacheKey(room: string, item: Extract<RoomItem, { type: "text" }>) {
  return `${textCacheKeyPrefix}:${room}:${item.id}:${item.hash}`;
}

function readCachedText(room: string, item: Extract<RoomItem, { type: "text" }>) {
  try {
    return localStorage.getItem(textCacheKey(room, item));
  } catch {
    return null;
  }
}

function rememberText(room: string, item: Extract<RoomItem, { type: "text" }>, text: string) {
  try {
    localStorage.setItem(textCacheKey(room, item), text);
  } catch {
    // Storage can be full or disabled; the network path still works.
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function timeAgo(value: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timeLeft(value: number) {
  const minutes = Math.max(0, Math.floor((value - Date.now()) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours) return `${hours}h ${rest}m left`;
  return `${rest}m left`;
}

function fileExtension(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match?.[1]?.toLowerCase() || "";
}

function fileIconFor(item: RoomItem): { Icon: LucideIcon; tone: string; label: string } {
  if (item.type === "text") return { Icon: Clipboard, tone: "text", label: "text" };

  const extension = fileExtension(item.fileName);
  const mime = item.mimeType || "";
  const image = ["avif", "gif", "heic", "jpeg", "jpg", "png", "svg", "webp"];
  const video = ["avi", "m4v", "mkv", "mov", "mp4", "webm"];
  const audio = ["aac", "flac", "m4a", "mp3", "ogg", "wav"];
  const archive = ["7z", "bz2", "gz", "rar", "tar", "tgz", "zip"];
  const sheet = ["csv", "ods", "tsv", "xls", "xlsx"];
  const code = ["c", "cpp", "css", "go", "html", "java", "js", "jsx", "py", "rs", "sh", "ts", "tsx"];
  const json = ["json", "jsonl", "map"];
  const text = ["log", "md", "rtf", "txt", "yaml", "yml"];

  if (image.includes(extension) || mime.startsWith("image/")) return { Icon: FileImage, tone: "image", label: extension || "image" };
  if (video.includes(extension) || mime.startsWith("video/")) return { Icon: FileVideo, tone: "video", label: extension || "video" };
  if (audio.includes(extension) || mime.startsWith("audio/")) return { Icon: FileAudio, tone: "audio", label: extension || "audio" };
  if (archive.includes(extension)) return { Icon: FileArchive, tone: "archive", label: extension };
  if (sheet.includes(extension)) return { Icon: FileSpreadsheet, tone: "sheet", label: extension };
  if (json.includes(extension)) return { Icon: FileJson, tone: "json", label: extension };
  if (code.includes(extension)) return { Icon: FileCode2, tone: "code", label: extension };
  if (text.includes(extension) || mime.startsWith("text/")) return { Icon: FileText, tone: "document", label: extension || "text" };

  return { Icon: FileIcon, tone: "file", label: extension || "file" };
}

function extensionForMime(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/svg+xml") return "svg";
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim().toLowerCase();
  return subtype && /^[a-z0-9]+$/.test(subtype) ? subtype : "png";
}

function namedClipboardFile(file: File, index: number) {
  if (file.name && file.name !== "image.png") return file;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = file.type.startsWith("image/") ? "pasted-image" : "pasted-file";
  return new File([file], `${prefix}-${stamp}${index ? `-${index + 1}` : ""}.${extensionForMime(file.type)}`, {
    type: file.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}

function filesFromClipboard(data: DataTransfer) {
  const files = Array.from(data.files || []);
  if (files.length) return files.map(namedClipboardFile);

  return Array.from(data.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .map(namedClipboardFile);
}

function roomSalt(room: string) {
  return CryptoJS.SHA256(`teleport:${room}`).toString(CryptoJS.enc.Base64);
}

function deriveKeys(room: string, password: string, salt: string, iterations: number) {
  const cacheKey = `${room}:${password}:${salt}:${iterations}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  const material = CryptoJS.PBKDF2(`${room}:${password}`, CryptoJS.enc.Base64.parse(salt), {
    keySize: 512 / 32,
    iterations,
    hasher: CryptoJS.algo.SHA256,
  });
  const keys = {
    encKey: CryptoJS.lib.WordArray.create(material.words.slice(0, 8), 32),
    macKey: CryptoJS.lib.WordArray.create(material.words.slice(8, 16), 32),
  };
  keyCache.set(cacheKey, keys);
  return keys;
}

function stripData(envelope: CryptoEnvelope): CryptoEnvelope {
  const { data, ...rest } = envelope;
  return rest;
}

function sealWordArray(payload: CryptoJS.lib.WordArray, room: string, password: string): CryptoEnvelope {
  const salt = roomSalt(room);
  const iv = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Base64);
  const keys = deriveKeys(room, password, salt, cryptoIterations);
  const encrypted = CryptoJS.AES.encrypt(payload, keys.encKey, {
    iv: CryptoJS.enc.Base64.parse(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const data = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  const mac = CryptoJS.HmacSHA256(`${salt}.${iv}.${data}`, keys.macKey).toString(CryptoJS.enc.Base64);
  return {
    v: 2,
    cipher: "AES-CBC-HMAC-SHA256",
    kdf: "PBKDF2-SHA256",
    iterations: cryptoIterations,
    salt,
    iv,
    mac,
    data,
  };
}

function openWordArray(envelope: CryptoEnvelope, data: string, room: string, password: string) {
  const keys = deriveKeys(room, password, envelope.salt, envelope.iterations || cryptoIterations);
  const mac = CryptoJS.HmacSHA256(`${envelope.salt}.${envelope.iv}.${data}`, keys.macKey).toString(CryptoJS.enc.Base64);
  if (mac !== envelope.mac) throw new Error("Unable to open item.");
  return CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(data) }),
    keys.encKey,
    {
      iv: CryptoJS.enc.Base64.parse(envelope.iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    },
  );
}

function sealText(value: string, room: string, password: string) {
  return sealWordArray(CryptoJS.enc.Utf8.parse(value), room, password);
}

function openText(envelope: CryptoEnvelope, data: string, room: string, password: string) {
  return CryptoJS.enc.Utf8.stringify(openWordArray(envelope, data, room, password));
}

function readableItem(item: RoomItem, room: string): RoomItem {
  if (!item.encrypted || item.type !== "text") return item;

  const cached = readCachedText(room, item);
  if (cached !== null) {
    return { ...item, textContent: cached, bytes: new Blob([cached]).size };
  }

  return { ...item, textContent: "", bytes: 0 };
}

function isPreviewableImage(item: RoomItem) {
  return item.type === "file" && item.mimeType.startsWith("image/");
}

function textPreview(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 90);
}

function itemNotificationLabel(item: RoomItem, room: string) {
  if (item.type === "file") {
    const type = item.mimeType?.split("/")[1] || item.mimeType || "file";
    return `${item.fileName} (${formatBytes(item.fileSize)}, ${type})`;
  }

  const text = item.encrypted ? readCachedText(room, item) || "" : item.textContent;
  const preview = textPreview(text);
  return preview ? `"${preview}"` : "Encrypted text paste";
}

function notificationTitleFor(items: RoomItem[], room: string) {
  if (items.length > 1) return `${items.length} new pastes in ${room}`;
  const item = items[0];
  return item.type === "file" ? `New file in ${room}` : `New text in ${room}`;
}

function notificationDetailFor(items: RoomItem[], room: string) {
  if (items.length > 1) {
    const files = items.filter((item) => item.type === "file").length;
    const texts = items.length - files;
    const parts = [
      texts ? `${texts} text${texts === 1 ? "" : "s"}` : "",
      files ? `${files} file${files === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    const first = itemNotificationLabel(items[0], room);
    return `${parts.join(", ")} · Latest: ${first}`;
  }
  return itemNotificationLabel(items[0], room);
}

function clipboardTextSignature(text: string) {
  return `text:${text.length}:${text}`;
}

function clipboardImageSignature(width: number, height: number, rgba: Uint8Array) {
  let sample = 0;
  const stride = Math.max(1, Math.floor(rgba.length / 128));
  for (let i = 0; i < rgba.length; i += stride) {
    sample = (sample * 33 + rgba[i]) >>> 0;
  }
  return `image:${width}x${height}:${rgba.length}:${sample}`;
}

function stampFileName(prefix: string, extension: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${stamp}.${extension}`;
}

function tryClaimClipboardCaptureLease(owner: string) {
  const now = Date.now();
  try {
    const current = JSON.parse(localStorage.getItem(clipboardLeaseKey) || "null") as
      | { owner?: string; expiresAt?: number }
      | null;
    if (current?.owner && current.owner !== owner && Number(current.expiresAt) > now) return false;

    const next = JSON.stringify({ owner, expiresAt: now + 5000 });
    localStorage.setItem(clipboardLeaseKey, next);
    return localStorage.getItem(clipboardLeaseKey) === next;
  } catch {
    return true;
  }
}

function rememberClipboardWriteSignature(signature: string) {
  try {
    localStorage.setItem(clipboardWriteSignatureKey, signature);
  } catch {
    // The in-memory signature remains the fallback.
  }
}

function wasClipboardWrittenByTeleport(signature: string, currentWindowSignature: string) {
  if (signature === currentWindowSignature) return true;
  try {
    return localStorage.getItem(clipboardWriteSignatureKey) === signature;
  } catch {
    return false;
  }
}

function tryClaimNotification(items: RoomItem[], room: string) {
  const ids = items.map((item) => item.id).sort().join(",");
  const key = `${room}:${ids}`;
  const now = Date.now();
  try {
    const current = JSON.parse(localStorage.getItem(notificationLeaseKey) || "null") as
      | { key?: string; expiresAt?: number }
      | null;
    if (current?.key === key && Number(current.expiresAt) > now) return false;

    localStorage.setItem(notificationLeaseKey, JSON.stringify({ key, expiresAt: now + 8000 }));
    return true;
  } catch {
    return true;
  }
}

async function imageToPngBlob(image: Image) {
  const size = await image.size();
  const rgba = await image.rgba();
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to read clipboard image.");
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), size.width, size.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Unable to read clipboard image.");
  return { blob, signature: clipboardImageSignature(size.width, size.height, rgba) };
}

async function readClipboardSnapshot(): Promise<ClipboardSnapshot> {
  const text = await readClipboardText().catch(() => "");
  if (text) return { type: "text", text, signature: clipboardTextSignature(text) };

  const image = await readClipboardImage().catch(() => null);
  if (!image) return { type: "empty" };
  const size = await image.size();
  const rgba = await image.rgba();
  return {
    type: "image",
    image,
    signature: clipboardImageSignature(size.width, size.height, rgba),
  };
}

async function restoreClipboardSnapshot(snapshot: ClipboardSnapshot) {
  if (snapshot.type === "text") {
    await writeClipboardText(snapshot.text).catch(() => undefined);
    return;
  }
  if (snapshot.type === "image") {
    await writeClipboardImage(snapshot.image).catch(() => undefined);
    return;
  }
  await clearClipboard().catch(() => undefined);
}

async function blobToPngBytes(blob: Blob) {
  if (blob.type === "image/png") return new Uint8Array(await blob.arrayBuffer());

  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to copy image.");
  context.drawImage(bitmap, 0, 0);
  const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!pngBlob) throw new Error("Unable to copy image.");
  return new Uint8Array(await pngBlob.arrayBuffer());
}

async function copyText(text: string) {
  if (isDesktopRuntime()) {
    try {
      await writeClipboardText(text);
      rememberClipboardWriteSignature(clipboardTextSignature(text));
      return;
    } catch {
      // Fall through to the browser clipboard path.
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    rememberClipboardWriteSignature(clipboardTextSignature(text));
    return;
  }

  const shim = document.createElement("textarea");
  shim.value = text;
  shim.setAttribute("readonly", "");
  shim.className = "copy-shim";
  document.body.append(shim);
  shim.select();
  document.execCommand("copy");
  shim.remove();
  rememberClipboardWriteSignature(clipboardTextSignature(text));
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function App() {
  const desktopMode = React.useMemo(isDesktopRuntime, []);
  const currentWindowLabel = React.useMemo(() => {
    if (!desktopMode) return "main";
    try {
      return getCurrentWindow().label;
    } catch {
      return "main";
    }
  }, [desktopMode]);
  const isMiniWindow = desktopMode && currentWindowLabel === "mini";
  const initialRoomValue = React.useMemo(initialRoom, []);
  const initialServerValue = React.useMemo(initialServerUrl, []);
  const initialMinifiedValue = React.useMemo(initialMinifiedMode, []);
  const shortcutDefaults = React.useMemo(desktopShortcutDefaults, []);
  const initialAutoCaptureClipboard = React.useMemo(
    () => initialBooleanSetting(autoCaptureClipboardKey, false),
    [],
  );
  const initialAutoCopyIncoming = React.useMemo(
    () => initialBooleanSetting(autoCopyIncomingKey, false),
    [],
  );
  const initialNotificationsEnabled = React.useMemo(
    () => initialBooleanSetting(notificationsEnabledKey, true),
    [],
  );
  const [roomInput, setRoomInput] = React.useState(initialRoomValue);
  const [room, setRoom] = React.useState(initialRoomValue);
  const [serverInput, setServerInput] = React.useState(initialServerValue);
  const [serverUrl, setServerUrl] = React.useState(initialServerValue);
  const [minifiedMode, setMinifiedMode] = React.useState(initialMinifiedValue);
  const [openPanelShortcut, setOpenPanelShortcut] = React.useState(() =>
    initialShortcut(openPanelShortcutKey, shortcutDefaults.openPanel, legacyOpenPanelShortcuts),
  );
  const [copyShortcut, setCopyShortcut] = React.useState(() =>
    initialShortcut(copyShortcutKey, shortcutDefaults.copy),
  );
  const [pasteShortcut, setPasteShortcut] = React.useState(() =>
    initialShortcut(pasteShortcutKey, shortcutDefaults.paste),
  );
  const [openPanelInput, setOpenPanelInput] = React.useState(openPanelShortcut);
  const [copyInput, setCopyInput] = React.useState(copyShortcut);
  const [pasteInput, setPasteInput] = React.useState(pasteShortcut);
  const [autoCaptureClipboard, setAutoCaptureClipboard] = React.useState(initialAutoCaptureClipboard);
  const [autoCopyIncoming, setAutoCopyIncoming] = React.useState(initialAutoCopyIncoming);
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(initialNotificationsEnabled);
  const [passwordInput, setPasswordInput] = React.useState(() =>
    initialRoomValue && !desktopMode ? passwordForRoom(initialRoomValue) : "",
  );
  const [roomPassword, setRoomPassword] = React.useState(() =>
    initialRoomValue && !desktopMode ? passwordForRoom(initialRoomValue) : "",
  );
  const [isEditingRoom, setIsEditingRoom] = React.useState(!initialRoomValue);
  const [items, setItems] = React.useState<RoomItem[]>([]);
  const [recentRooms, setRecentRooms] = React.useState<RecentRoom[]>(readRecentRooms);
  const [error, setError] = React.useState("");
  const [isDragging, setIsDragging] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState<UploadProgress | null>(null);
  const [copiedItemId, setCopiedItemId] = React.useState("");
  const [newItemNotice, setNewItemNotice] = React.useState<NewItemNotice | null>(null);
  const [expandedImage, setExpandedImage] = React.useState<Extract<RoomItem, { type: "file" }> | null>(null);
  const [isMiniSettingsOpen, setIsMiniSettingsOpen] = React.useState(false);
  const [settingsMessage, setSettingsMessage] = React.useState("");
  const [desktopSettingsReady, setDesktopSettingsReady] = React.useState(!desktopMode);
  const [cacheVersion, setCacheVersion] = React.useState(0);
  const pasteBoxRef = React.useRef<HTMLDivElement | null>(null);
  const desktopStoreRef = React.useRef<Store | null>(null);
  const clipboardOwnerRef = React.useRef(
    `${currentWindowLabel}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  );
  const miniWindowDragRef = React.useRef(false);
  const miniWindowDragTimerRef = React.useRef<number | null>(null);
  const clipboardCaptureBusyRef = React.useRef(false);
  const syntheticShortcutRef = React.useRef(false);
  const lastClipboardCaptureSignatureRef = React.useRef("");
  const lastClipboardWriteSignatureRef = React.useRef("");
  const feedStateRef = React.useRef<{
    key: string;
    startedAt: number;
    primed: boolean;
    ids: Set<string>;
  } | null>(null);
  const noticeTimerRef = React.useRef<number | null>(null);
  const visibleItems = React.useMemo(
    () => items.map((item) => readableItem(item, room)),
    [items, room, cacheVersion],
  );

  const publishDesktopState = React.useCallback(
    (next: DesktopStateSync = {}) => {
      if (!desktopMode) return;
      emit("teleport-state-sync", {
        room: next.room ?? room,
        serverUrl: next.serverUrl ?? serverUrl,
        roomPassword: next.roomPassword ?? roomPassword,
      }).catch(() => undefined);
    },
    [desktopMode, room, roomPassword, serverUrl],
  );

  const openFullWindow = React.useCallback(async () => {
    publishDesktopState();
    await invoke("show_full_window").catch(() => undefined);
  }, [publishDesktopState]);

  React.useEffect(() => {
    if (!room) return undefined;

    primeRoomFeed(room);
    loadRoom(room).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Unable to load room.");
    });
    const events = new EventSource(apiUrl(`/api/rooms/${encodeURIComponent(room)}/events`, serverUrl));
    events.addEventListener("items", (event) => {
      const payload = JSON.parse(event.data) as RoomPayload;
      syncRoomItems(payload.items, room, true);
    });

    return () => {
      events.close();
    };
  }, [room, serverUrl]);

  React.useEffect(() => {
    if (!desktopMode) return undefined;

    let cancelled = false;
    loadDesktopStore()
      .then(async (store) => {
        if (!store || cancelled) return;
        desktopStoreRef.current = store;
        const storedServerUrl = normalizeServerUrl((await store.get<string>(serverUrlKey)) || initialServerValue);
        const storedRoom = (await store.get<string>(roomKey)) || initialRoomValue;
        const storedMinified = (await store.get<boolean>(minifiedModeKey)) ?? initialMinifiedValue;
        const storedOpenPanelShortcut =
          normalizeStoredShortcut(
            (await store.get<string>(openPanelShortcutKey)) || "",
            shortcutDefaults.openPanel,
            legacyOpenPanelShortcuts,
          ) || initialShortcut(openPanelShortcutKey, shortcutDefaults.openPanel, legacyOpenPanelShortcuts);
        const storedCopyShortcut =
          (await store.get<string>(copyShortcutKey)) || initialShortcut(copyShortcutKey, shortcutDefaults.copy);
        const storedPasteShortcut =
          (await store.get<string>(pasteShortcutKey)) || initialShortcut(pasteShortcutKey, shortcutDefaults.paste);
        const storedAutoCapture =
          (await store.get<boolean>(autoCaptureClipboardKey)) ?? initialAutoCaptureClipboard;
        const storedAutoCopy =
          (await store.get<boolean>(autoCopyIncomingKey)) ?? initialAutoCopyIncoming;
        const storedNotifications =
          (await store.get<boolean>(notificationsEnabledKey)) ?? initialNotificationsEnabled;
        const nextRoom = storedRoom ? normalizeRoom(storedRoom) : "";
        const nextPassword = nextRoom ? await keychainGet(nextRoom) : "";

        if (cancelled) return;
        setServerUrl(storedServerUrl || defaultDesktopServerUrl);
        setServerInput(storedServerUrl || defaultDesktopServerUrl);
        setMinifiedMode(storedMinified);
        setOpenPanelShortcut(storedOpenPanelShortcut);
        setOpenPanelInput(storedOpenPanelShortcut);
        setCopyShortcut(storedCopyShortcut);
        setCopyInput(storedCopyShortcut);
        setPasteShortcut(storedPasteShortcut);
        setPasteInput(storedPasteShortcut);
        setAutoCaptureClipboard(storedAutoCapture);
        setAutoCopyIncoming(storedAutoCopy);
        setNotificationsEnabled(storedNotifications);
        if (nextRoom) {
          setRoom(nextRoom);
          setRoomInput(nextRoom);
          setRoomPassword(nextPassword);
          setPasswordInput(nextPassword);
          setIsEditingRoom(false);
        }
        if (isMiniWindow && !storedMinified) {
          invoke("show_full_window").catch(() => undefined);
        }
      })
      .catch(() => {
        // Local storage remains the fallback.
      })
      .finally(() => {
        if (!cancelled) setDesktopSettingsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [
    desktopMode,
    initialAutoCaptureClipboard,
    initialAutoCopyIncoming,
    initialMinifiedValue,
    initialNotificationsEnabled,
    initialRoomValue,
    initialServerValue,
    isMiniWindow,
    shortcutDefaults,
  ]);

  React.useEffect(() => {
    if (!desktopMode) return undefined;

    const openDebugTools = (event: KeyboardEvent) => {
      if (event.key !== "F12") return;
      event.preventDefault();
      invoke("open_debug_tools").catch(() => undefined);
    };
    window.addEventListener("keydown", openDebugTools);
    return () => window.removeEventListener("keydown", openDebugTools);
  }, [desktopMode]);

  React.useEffect(() => {
    if (!desktopMode) return undefined;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<DesktopStateSync>("teleport-state-sync", async ({ payload }) => {
      if (cancelled) return;

      if (payload.serverUrl !== undefined) {
        setServerUrl(payload.serverUrl);
        setServerInput(payload.serverUrl);
      }

      if (payload.room !== undefined) {
        const nextRoom = payload.room ? normalizeRoom(payload.room) : "";
        const nextPassword = payload.roomPassword ?? (nextRoom ? await keychainGet(nextRoom) : "");
        if (cancelled) return;
        setRoom(nextRoom);
        setRoomInput(nextRoom);
        setPasswordInput(nextPassword);
        setRoomPassword(nextPassword);
        setIsEditingRoom(!nextRoom);
      }
    })
      .then((listener) => {
        if (cancelled) listener();
        else unlisten = listener;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [desktopMode]);

  React.useEffect(() => {
    if (!desktopMode || !isMiniWindow) return undefined;

    let mounted = true;
    const shortcuts = [openPanelShortcut, copyShortcut, pasteShortcut].filter(
      (shortcut, index, values) => shortcut && values.indexOf(shortcut) === index,
    );
    register(shortcuts, async (event) => {
      if (event.state !== "Pressed") return;
      if (syntheticShortcutRef.current) return;
      if (shortcutsMatch(event.shortcut, copyShortcut)) {
        await sendSelectedItem();
        return;
      }
      if (shortcutsMatch(event.shortcut, pasteShortcut)) {
        await pasteFirstItem();
        return;
      }
      if (!shortcutsMatch(event.shortcut, openPanelShortcut)) return;
      await invoke("show_mini_panel").catch(() => undefined);
      window.setTimeout(() => {
        if (mounted) pasteBoxRef.current?.focus();
      }, 80);
    }).catch((caught) => {
      setSettingsMessage(caught instanceof Error ? caught.message : "Shortcut registration failed.");
    });

    return () => {
      mounted = false;
      if (shortcuts.length) unregister(shortcuts).catch(() => undefined);
    };
  }, [copyShortcut, desktopMode, isMiniWindow, openPanelShortcut, pasteShortcut, visibleItems]);

  React.useEffect(() => {
    if (!desktopMode || !isMiniWindow || !desktopSettingsReady) return undefined;

    const timer = window.setTimeout(() => {
      applyDesktopSettings({ automatic: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    autoCaptureClipboard,
    autoCopyIncoming,
    copyInput,
    desktopMode,
    desktopSettingsReady,
    isMiniWindow,
    minifiedMode,
    notificationsEnabled,
    openPanelInput,
    pasteInput,
    serverInput,
  ]);

  React.useEffect(() => {
    if (!desktopMode || !isMiniWindow) return undefined;

    let disposed = false;
    const currentWindow = getCurrentWindow();
    const unlisteners: Array<() => void> = [];
    currentWindow.onFocusChanged(({ payload }) => {
      if (!payload) {
        if (!disposed && !miniWindowDragRef.current) invoke("hide_mini_panel").catch(() => undefined);
      }
    }).then((unlisten) => unlisteners.push(unlisten));
    onAction(() => {
      invoke("show_mini_panel").catch(() => undefined);
    }).then((listener) => {
      unlisteners.push(() => {
        listener.unregister().catch(() => undefined);
      });
    }).catch(() => undefined);

    return () => {
      disposed = true;
      if (miniWindowDragTimerRef.current) window.clearTimeout(miniWindowDragTimerRef.current);
      for (const unlisten of unlisteners) unlisten();
    };
  }, [desktopMode, isMiniWindow]);

  React.useEffect(() => {
    if (!desktopMode || !autoCaptureClipboard || !room) return undefined;

    let disposed = false;
    const captureClipboard = async () => {
      if (!disposed) await pasteClipboardNow();
    };

    const timer = window.setInterval(() => {
      captureClipboard().catch(() => undefined);
    }, 1600);
    captureClipboard().catch(() => undefined);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [autoCaptureClipboard, desktopMode, room, roomPassword, serverUrl]);

  React.useEffect(() => {
    const timer = setInterval(() => setItems((current) => [...current]), 30000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    if (notificationsEnabled) return;
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNewItemNotice(null);
  }, [notificationsEnabled]);

  React.useEffect(() => {
    if (!room) return;
    rememberRoom(room);
    setRecentRooms(readRecentRooms());
  }, [room]);

  React.useEffect(() => {
    if (!roomPassword) return undefined;
    const timer = window.setTimeout(() => {
      deriveKeys(room, roomPassword, roomSalt(room), cryptoIterations);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [room, roomPassword]);

  React.useEffect(() => {
    if (!roomPassword) return undefined;

    const pending = items.filter(
      (item): item is Extract<RoomItem, { type: "text" }> =>
        item.type === "text" && Boolean(item.encrypted && item.cryptoMeta) && readCachedText(room, item) === null,
    );
    if (!pending.length) return undefined;

    let cancelled = false;
    let timer = 0;
    let index = 0;

    const decryptNext = () => {
      if (cancelled) return;
      const item = pending[index];
      index += 1;
      if (!item) return;

      timer = window.setTimeout(() => {
        try {
          const text = openText(item.cryptoMeta as CryptoEnvelope, item.textContent, room, roomPassword);
          rememberText(room, item, text);
          setCacheVersion((value) => value + 1);
        } catch {
          // Leave the item blank when the local password does not match.
        }
        decryptNext();
      }, 20);
    };

    timer = window.setTimeout(decryptNext, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [items, room, roomPassword]);

  async function loadRoom(nextRoom: string) {
    const response = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(nextRoom)}/items`, serverUrl));
    const payload = (await response.json()) as RoomPayload | { error: string };
    if (!response.ok) throw new Error("error" in payload ? payload.error : "Unable to load room.");
    syncRoomItems((payload as RoomPayload).items, nextRoom, false);
  }

  function feedKeyFor(nextRoom: string) {
    return `${serverUrl || "web"}:${nextRoom}`;
  }

  function primeRoomFeed(nextRoom: string) {
    feedStateRef.current = {
      key: feedKeyFor(nextRoom),
      startedAt: Date.now(),
      primed: false,
      ids: new Set(),
    };
  }

  function syncRoomItems(nextItems: RoomItem[], nextRoom: string, shouldNotify: boolean) {
    const key = feedKeyFor(nextRoom);
    let feedState = feedStateRef.current;
    if (!feedState || feedState.key !== key) {
      feedState = {
        key,
        startedAt: Date.now(),
        primed: false,
        ids: new Set(),
      };
    }

    const nextIds = new Set(nextItems.map((item) => item.id));
    if (!feedState.primed) {
      feedStateRef.current = { ...feedState, primed: true, ids: nextIds };
      setItems(nextItems);
      return;
    }

    const newItems = nextItems.filter(
      (item) => !feedState.ids.has(item.id) && item.createdAt >= feedState.startedAt - 1000,
    );
    feedStateRef.current = { ...feedState, ids: nextIds };
    setItems(nextItems);

    if (shouldNotify && newItems.length) {
      notifyNewItems(newItems, nextRoom);
      copyIncomingItems(newItems, nextRoom).catch(() => undefined);
    }
  }

  async function copyIncomingItems(newItems: RoomItem[], nextRoom: string) {
    if (!desktopMode || !autoCopyIncoming) return;
    const item = newItems.find(
      (candidate) => candidate.type === "text" || (candidate.type === "file" && candidate.mimeType.startsWith("image/")),
    );
    if (!item) return;

    if (item.type === "text") {
      let text = item.textContent;
      if (item.encrypted && item.cryptoMeta) {
        text = readCachedText(nextRoom, item) || "";
        if (!text && roomPassword) {
          text = openText(item.cryptoMeta, item.textContent, nextRoom, roomPassword);
          rememberText(nextRoom, item, text);
          setCacheVersion((value) => value + 1);
        }
      }
      if (!text) return;
      lastClipboardWriteSignatureRef.current = clipboardTextSignature(text);
      rememberClipboardWriteSignature(lastClipboardWriteSignatureRef.current);
      await writeClipboardText(text);
      return;
    }

    const response = await fetch(absoluteItemUrl(item.downloadUrl, serverUrl));
    if (!response.ok) return;
    const bytes = await blobToPngBytes(await response.blob());
    const image = await Image.fromBytes(bytes);
    const size = await image.size();
    const rgba = await image.rgba();
    lastClipboardWriteSignatureRef.current = clipboardImageSignature(size.width, size.height, rgba);
    rememberClipboardWriteSignature(lastClipboardWriteSignatureRef.current);
    await writeClipboardImage(image);
  }

  function notifyNewItems(newItems: RoomItem[], nextRoom: string) {
    if (!notificationsEnabled) return;

    const title = notificationTitleFor(newItems, nextRoom);
    const detail = notificationDetailFor(newItems, nextRoom);
    setNewItemNotice({
      id: `${Date.now()}:${newItems.map((item) => item.id).join(",")}`,
      title,
      detail,
    });

    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNewItemNotice(null);
      noticeTimerRef.current = null;
    }, 4200);

    if (desktopMode) {
      if (tryClaimNotification(newItems, nextRoom)) {
        sendDesktopNotification(title, detail, nextRoom);
      }
      return;
    }

    if ("Notification" in window && Notification.permission === "granted" && (document.hidden || !document.hasFocus())) {
      new Notification("teleport", {
        body: `${title} · ${detail}`,
        tag: `teleport:${nextRoom}`,
      });
    }
  }

  async function sendDesktopNotification(title: string, detail: string, nextRoom: string) {
    try {
      let permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        permissionGranted = (await requestPermission()) === "granted";
      }
      if (!permissionGranted) return;

      sendNotification({
        title,
        body: detail,
        group: `teleport:${nextRoom}`,
      });
    } catch {
      // The in-app notice above remains the fallback.
    }
  }

  async function enterRoom(value = roomInput, passwordValue?: string) {
    try {
      const nextRoom = normalizeRoom(value);
      const nextServerUrl = desktopMode ? normalizeServerUrl(serverInput) || defaultDesktopServerUrl : "";
      const nextPassword = passwordValue ?? passwordInput;
      setError("");
      setServerUrl(nextServerUrl);
      setServerInput(nextServerUrl);
      setRoom(nextRoom);
      setRoomInput(nextRoom);
      setPasswordInput(nextPassword);
      setRoomPassword(nextPassword);
      setIsEditingRoom(false);
      localStorage.setItem(roomKey, nextRoom);
      localStorage.setItem(serverUrlKey, nextServerUrl);
      await keychainSet(nextRoom, nextPassword);
      rememberRoom(nextRoom);
      setRecentRooms(readRecentRooms());
      if (desktopStoreRef.current) {
        await desktopStoreRef.current.set(roomKey, nextRoom);
        await desktopStoreRef.current.set(serverUrlKey, nextServerUrl);
      }
      publishDesktopState({ room: nextRoom, serverUrl: nextServerUrl, roomPassword: nextPassword });
      requestAnimationFrame(() => pasteBoxRef.current?.focus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid room name.");
    }
  }

  async function enterRecentRoom(nextRoom: string) {
    setRoomInput(nextRoom);
    const nextPassword = await keychainGet(nextRoom);
    setPasswordInput(nextPassword);
    await enterRoom(nextRoom, nextPassword);
  }

  async function pasteClipboardNow(options: { force?: boolean; useLease?: boolean } = {}) {
    if (!room) {
      setError("Create or join a room first.");
      setIsEditingRoom(true);
      return;
    }
    if (clipboardCaptureBusyRef.current) return;

    clipboardCaptureBusyRef.current = true;
    try {
      if (options.useLease !== false && !tryClaimClipboardCaptureLease(clipboardOwnerRef.current)) return;

      const text = await readClipboardText().catch(() => "");
      if (text.trim()) {
        const signature = clipboardTextSignature(text);
        if (
          options.force ||
          (signature !== lastClipboardCaptureSignatureRef.current &&
            !wasClipboardWrittenByTeleport(signature, lastClipboardWriteSignatureRef.current))
        ) {
          lastClipboardCaptureSignatureRef.current = signature;
          await uploadText(text);
        }
        return;
      }

      const image = await readClipboardImage().catch(() => null);
      if (!image) return;
      const { blob, signature } = await imageToPngBlob(image);
      if (
        !options.force &&
        (signature === lastClipboardCaptureSignatureRef.current ||
          wasClipboardWrittenByTeleport(signature, lastClipboardWriteSignatureRef.current))
      ) {
        return;
      }
      lastClipboardCaptureSignatureRef.current = signature;
      await uploadFiles([
        new File([blob], stampFileName("clipboard-image", "png"), {
          type: "image/png",
          lastModified: Date.now(),
        }),
      ]);
    } finally {
      clipboardCaptureBusyRef.current = false;
    }
  }

  async function sendSelectedItem() {
    if (!room) return;
    if (clipboardCaptureBusyRef.current) return;

    clipboardCaptureBusyRef.current = true;
    const sentinel = `teleport-selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const previousClipboard = await readClipboardSnapshot();
    try {
      await writeClipboardText(sentinel);
      await wait(40);
      await pressSystemShortcut("copy");
      const selected = await readClipboardSnapshot();

      if (selected.type === "text" && selected.text === sentinel) {
        await restoreClipboardSnapshot(previousClipboard);
        return;
      }

      if (selected.type === "empty") {
        await restoreClipboardSnapshot(previousClipboard);
        return;
      }

      if (selected.type === "text") {
        if (!selected.text.trim()) return;
        lastClipboardCaptureSignatureRef.current = selected.signature;
        await uploadText(selected.text);
        return;
      }

      if (selected.type === "image") {
        const { blob, signature } = await imageToPngBlob(selected.image);
        lastClipboardCaptureSignatureRef.current = signature;
        await uploadFiles([
          new File([blob], stampFileName("selection-image", "png"), {
            type: "image/png",
            lastModified: Date.now(),
          }),
        ]);
      }
    } finally {
      clipboardCaptureBusyRef.current = false;
    }
  }

  async function writeItemToClipboard(item: RoomItem, options: { preferImage?: boolean } = {}) {
    if (item.type === "text") {
      if (!item.textContent) return false;
      await copyText(item.textContent);
      return true;
    }

    const itemUrl = absoluteItemUrl(item.downloadUrl, serverUrl);
    if (options.preferImage && item.mimeType.startsWith("image/")) {
      const response = await fetch(itemUrl);
      if (!response.ok) return false;
      const bytes = await blobToPngBytes(await response.blob());
      const image = await Image.fromBytes(bytes);
      const size = await image.size();
      const rgba = await image.rgba();
      const signature = clipboardImageSignature(size.width, size.height, rgba);
      lastClipboardWriteSignatureRef.current = signature;
      rememberClipboardWriteSignature(signature);
      await writeClipboardImage(image);
      return true;
    }

    await copyText(itemUrl);
    return true;
  }

  async function pasteFirstItem() {
    const firstItem = visibleItems.find((item) => item.type === "file" || item.textContent);
    if (!firstItem) return;
    const didCopy = await writeItemToClipboard(firstItem, { preferImage: true });
    if (!didCopy) return;
    await wait(80);
    await pressSystemShortcut("paste");
  }

  async function pressSystemShortcut(action: "copy" | "paste") {
    syntheticShortcutRef.current = true;
    try {
      await invoke("press_system_shortcut", { action }).catch(() => undefined);
      await wait(120);
    } finally {
      syntheticShortcutRef.current = false;
    }
  }

  async function applyDesktopSettings(options: { automatic?: boolean } = {}) {
    try {
      const nextServerUrl = normalizeServerUrl(serverInput) || defaultDesktopServerUrl;
      const nextOpenPanelShortcut = normalizeShortcut(openPanelInput, shortcutDefaults.openPanel);
      const nextCopyShortcut = normalizeShortcut(copyInput, shortcutDefaults.copy);
      const nextPasteShortcut = normalizeShortcut(pasteInput, shortcutDefaults.paste);
      if (new Set([nextOpenPanelShortcut, nextCopyShortcut, nextPasteShortcut]).size !== 3) {
        throw new Error("Shortcuts must be different.");
      }

      setServerUrl(nextServerUrl);
      setServerInput(nextServerUrl);
      setOpenPanelShortcut(nextOpenPanelShortcut);
      setOpenPanelInput(nextOpenPanelShortcut);
      setCopyShortcut(nextCopyShortcut);
      setCopyInput(nextCopyShortcut);
      setPasteShortcut(nextPasteShortcut);
      setPasteInput(nextPasteShortcut);
      setSettingsMessage(options.automatic ? "Auto saved" : "Saved");
      localStorage.setItem(serverUrlKey, nextServerUrl);
      localStorage.setItem(minifiedModeKey, String(minifiedMode));
      localStorage.setItem(openPanelShortcutKey, nextOpenPanelShortcut);
      localStorage.setItem(copyShortcutKey, nextCopyShortcut);
      localStorage.setItem(pasteShortcutKey, nextPasteShortcut);
      localStorage.setItem(autoCaptureClipboardKey, String(autoCaptureClipboard));
      localStorage.setItem(autoCopyIncomingKey, String(autoCopyIncoming));
      localStorage.setItem(notificationsEnabledKey, String(notificationsEnabled));

      if (desktopStoreRef.current) {
        await desktopStoreRef.current.set(serverUrlKey, nextServerUrl);
        await desktopStoreRef.current.set(minifiedModeKey, minifiedMode);
        await desktopStoreRef.current.set(openPanelShortcutKey, nextOpenPanelShortcut);
        await desktopStoreRef.current.set(copyShortcutKey, nextCopyShortcut);
        await desktopStoreRef.current.set(pasteShortcutKey, nextPasteShortcut);
        await desktopStoreRef.current.set(autoCaptureClipboardKey, autoCaptureClipboard);
        await desktopStoreRef.current.set(autoCopyIncomingKey, autoCopyIncoming);
        await desktopStoreRef.current.set(notificationsEnabledKey, notificationsEnabled);
      }

      publishDesktopState({ room, serverUrl: nextServerUrl, roomPassword });
      if (isMiniWindow && !minifiedMode) {
        await openFullWindow();
      }
    } catch (caught) {
      setSettingsMessage(caught instanceof Error ? caught.message : "Settings were not saved.");
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLElement>) {
    const files = filesFromClipboard(event.clipboardData);
    if (files.length) {
      event.preventDefault();
      uploadFiles(files);
      return;
    }

    const text = event.clipboardData.getData("text/plain");
    if (text.trim()) {
      event.preventDefault();
      uploadText(text);
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    uploadFiles(event.dataTransfer.files);
  }

  async function uploadText(content: string) {
    const text = content.trimEnd();
    if (!text.trim()) return;
    if (!room) {
      setError("Create or join a room first.");
      setIsEditingRoom(true);
      return;
    }

    setError("");
    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
    const sealed = roomPassword ? sealText(text, room, roomPassword) : null;
    const response = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(room)}/items`, serverUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        sealed
          ? { content: sealed.data, encrypted: true, cryptoMeta: stripData(sealed) }
          : { content: text },
      ),
    });
    const payload = (await response.json()) as RoomPayload | { error: string };
    if (!response.ok) {
      setError("error" in payload ? payload.error : "Text sync failed.");
      return;
    }

    const nextItems = (payload as RoomPayload).items;
    if (sealed) {
      const saved = nextItems.find(
        (item): item is Extract<RoomItem, { type: "text" }> =>
          item.type === "text" && Boolean(item.encrypted) && item.textContent === sealed.data,
      );
      if (saved) {
        rememberText(room, saved, text);
        setCacheVersion((value) => value + 1);
      }
    }

    syncRoomItems(nextItems, room, false);
  }

  function uploadFile(file: File, index: number, totalFiles: number) {
    return new Promise<RoomPayload>((resolve, reject) => {
      const request = new XMLHttpRequest();
      const form = new FormData();
      form.append("file", file);

      setUploadProgress({
        fileName: file.name,
        index,
        totalFiles,
        percent: 0,
        loaded: 0,
        total: file.size,
        processing: false,
      });

      request.upload.onprogress = (event) => {
        const total = event.lengthComputable ? event.total : file.size;
        const percent = total ? Math.min(99, Math.round((event.loaded / total) * 100)) : 0;
        setUploadProgress({
          fileName: file.name,
          index,
          totalFiles,
          percent,
          loaded: event.loaded,
          total,
          processing: false,
        });
      };

      request.onload = () => {
        let payload: RoomPayload | { error: string };
        try {
          payload = JSON.parse(request.responseText || "{}");
        } catch {
          reject(new Error("Upload response was invalid."));
          return;
        }

        if (request.status < 200 || request.status >= 300) {
          reject(new Error("error" in payload ? payload.error : `Upload failed for ${file.name}.`));
          return;
        }

        setUploadProgress({
          fileName: file.name,
          index,
          totalFiles,
          percent: 100,
          loaded: file.size,
          total: file.size,
          processing: true,
        });
        resolve(payload as RoomPayload);
      };

      request.onerror = () => reject(new Error(`Upload failed for ${file.name}.`));
      request.open("POST", apiUrl(`/api/rooms/${encodeURIComponent(room)}/items`, serverUrl));
      request.send(form);
    });
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!room) {
      setError("Create or join a room first.");
      setIsEditingRoom(true);
      return;
    }

    const batch = Array.from(files);
    if (!batch.length) return;

    setError("");
    for (let i = 0; i < batch.length; i += 1) {
      const file = batch[i];
      if (file.size > maxFileBytes) {
        setError(`${file.name} is larger than 200 MB.`);
        continue;
      }

      try {
        const payload = await uploadFile(file, i + 1, batch.length);
        syncRoomItems(payload.items, room, false);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : `Upload failed for ${file.name}.`);
      }
    }

    setTimeout(() => setUploadProgress(null), 900);
  }

  async function deleteItem(item: RoomItem) {
    const response = await fetch(
      apiUrl(`/api/rooms/${encodeURIComponent(room)}/items/${encodeURIComponent(item.id)}`, serverUrl),
      { method: "DELETE" },
    );
    const payload = (await response.json()) as RoomPayload | { error: string };
    if (response.ok) syncRoomItems((payload as RoomPayload).items, room, false);
  }

  async function copyItem(item: RoomItem) {
    const didCopy = await writeItemToClipboard(item);
    if (!didCopy) return;

    setCopiedItemId(item.id);
    window.setTimeout(() => {
      setCopiedItemId((current) => (current === item.id ? "" : current));
    }, 1300);
    if (desktopMode && isMiniWindow) {
      invoke("hide_mini_panel").catch(() => undefined);
    }
  }

  async function downloadItem(item: RoomItem) {
    if (item.type !== "file") return;
    window.open(absoluteItemUrl(item.downloadUrl, serverUrl), "_blank", "noopener,noreferrer");
  }

  function startMiniWindowDrag(event: React.MouseEvent<HTMLElement>) {
    if (!desktopMode || !isMiniWindow || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) return;
    miniWindowDragRef.current = true;
    if (miniWindowDragTimerRef.current) window.clearTimeout(miniWindowDragTimerRef.current);
    getCurrentWindow()
      .startDragging()
      .catch(() => undefined)
      .finally(() => {
        miniWindowDragTimerRef.current = window.setTimeout(() => {
          miniWindowDragRef.current = false;
          getCurrentWindow().setFocus().catch(() => undefined);
        }, 350);
      });
  }

  if (isMiniWindow) {
    return (
      <main className="mini-shell">
        <header className="mini-titlebar" onMouseDown={startMiniWindowDrag}>
          <div className="mini-brand">
            <span aria-hidden="true">
              <Zap size={16} fill="currentColor" />
            </span>
            <strong>teleport</strong>
          </div>
          <div className="mini-actions">
            {!isMiniSettingsOpen && room && (
              <button className="mini-room-chip" onClick={() => setIsEditingRoom(true)}>{room}</button>
            )}
            {!isMiniSettingsOpen && (
              <button
                className="mini-icon-button"
                onClick={() => setIsMiniSettingsOpen(true)}
                aria-label="Settings"
                title="Settings"
              >
                <Settings size={16} />
              </button>
            )}
            <button
              className="mini-icon-button"
              onClick={openFullWindow}
              aria-label="Full window"
              title="Full window"
            >
              <Maximize2 size={16} />
            </button>
          </div>
        </header>

        <section className="mini-content">
          {isMiniSettingsOpen ? (
            <section className="mini-settings-page" aria-label="Client settings">
              <div className="mini-page-head">
                <button className="mini-back-button" type="button" onClick={() => setIsMiniSettingsOpen(false)}>
                  <ArrowLeft size={15} />
                  Back
                </button>
                <h2>Settings</h2>
              </div>

              <div className="mini-settings-form">
                <label className="mini-toggle">
                  <span>
                    <strong>Minified mode</strong>
                    <small>Open this panel on launch</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={minifiedMode}
                    onChange={(event) => setMinifiedMode(event.currentTarget.checked)}
                  />
                </label>
                <label className="mini-toggle">
                  <span>
                    <strong>Auto Paste</strong>
                    <small>Auto paste copied text and images</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={autoCaptureClipboard}
                    onChange={(event) => setAutoCaptureClipboard(event.currentTarget.checked)}
                  />
                </label>
                <label className="mini-toggle">
                  <span>
                    <strong>Auto Copy</strong>
                    <small>Auto copy incoming text and images</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={autoCopyIncoming}
                    onChange={(event) => setAutoCopyIncoming(event.currentTarget.checked)}
                  />
                </label>
                <label className="mini-toggle">
                  <span>
                    <strong>Notifications</strong>
                    <small>Show new paste alerts</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={notificationsEnabled}
                    onChange={(event) => setNotificationsEnabled(event.currentTarget.checked)}
                  />
                </label>
                <label>
                  <span>Server address</span>
                  <input value={serverInput} onChange={(event) => setServerInput(event.target.value)} />
                </label>
                <label>
                  <span>Open panel</span>
                  <ShortcutInput value={openPanelInput} onChange={setOpenPanelInput} />
                </label>
                <label>
                  <span>Copy</span>
                  <ShortcutInput value={copyInput} onChange={setCopyInput} />
                </label>
                <label>
                  <span>Paste</span>
                  <ShortcutInput value={pasteInput} onChange={setPasteInput} />
                </label>
              </div>

              <div className="mini-settings-foot">
                {settingsMessage && <p>{settingsMessage}</p>}
              </div>
            </section>
          ) : !room || isEditingRoom ? (
            <section className="mini-room-card">
              <h2>{room ? "Switch room" : "Create or join a room"}</h2>
              <RoomPrompt
                room={room}
                roomInput={roomInput}
                passwordInput={passwordInput}
                serverInput={serverInput}
                recentRooms={recentRooms}
                error={error}
                autoFocus
                compact
                onRoomInput={setRoomInput}
                onPasswordInput={setPasswordInput}
                onServerInput={setServerInput}
                onSubmit={() => enterRoom()}
                onCancel={room ? () => setIsEditingRoom(false) : undefined}
                onRecentRoom={enterRecentRoom}
              />
            </section>
          ) : (
            <>
              <section
                ref={pasteBoxRef}
                tabIndex={0}
                role="textbox"
                aria-label="Paste or drop box"
                className={`mini-paste-box ${isDragging ? "mini-paste-box-dragging" : ""}`}
                onPaste={handlePaste}
                onDragOver={handleDragOver}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <span>
                  <UploadCloud size={22} />
                </span>
                <div>
                  <strong>Paste or drop</strong>
                  <p>Synced to {room}</p>
                </div>
              </section>

              {uploadProgress && <UploadPrompt progress={uploadProgress} />}
              {error && <p className="mini-error">{error}</p>}

              <section className="mini-list-panel">
                <div className="mini-list-head">
                  <h2>Recent pastes</h2>
                  <button onClick={openFullWindow}>
                    <ExternalLink size={14} />
                    Open
                  </button>
                </div>
                {visibleItems.length ? (
                  <ol className="mini-items-list">
                    {visibleItems.slice(0, 8).map((item) => (
                      <MiniItemCard
                        key={item.id}
                        item={item}
                        isCopied={copiedItemId === item.id}
                        onCopy={copyItem}
                        onDelete={deleteItem}
                        onDownload={downloadItem}
                        onPreview={setExpandedImage}
                        getItemUrl={(itemUrl) => absoluteItemUrl(itemUrl, serverUrl)}
                      />
                    ))}
                  </ol>
                ) : (
                  <div className="mini-empty">
                    <Clipboard size={24} />
                    <p>Paste text or drop a file.</p>
                  </div>
                )}
              </section>
            </>
          )}
        </section>

        {newItemNotice && (
          <div className="mini-notice" role="status" aria-live="polite">
            <strong>{newItemNotice.title}</strong>
            <p>{newItemNotice.detail}</p>
          </div>
        )}

        {expandedImage && (
          <div className="image-modal image-modal-mini" role="dialog" aria-modal="true" onClick={() => setExpandedImage(null)}>
            <div className="image-modal-inner" onClick={(event) => event.stopPropagation()}>
              <button className="image-modal-close" onClick={() => setExpandedImage(null)} aria-label="Close preview">
                <X size={18} />
              </button>
              <img src={absoluteItemUrl(expandedImage.downloadUrl, serverUrl)} alt={expandedImage.fileName} />
              <p>{expandedImage.fileName}</p>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <header className="title-bar">
        <div className="title-inner">
          <div className="brand">
            <span className="brand-icon" aria-hidden="true">
              <Zap size={18} fill="currentColor" />
            </span>
            <h1>teleport</h1>
          </div>

          <div className="room-control">
            {room ? (
              <button
                className="joined-pill"
                onClick={() => {
                  setRoomInput(room);
                  setPasswordInput(roomPassword);
                  setIsEditingRoom((value) => !value);
                }}
                aria-expanded={isEditingRoom}
                aria-label={`Change room, currently ${room}`}
                title="Change room"
              >
                <span>{room}</span>
                <Check className="joined-check" size={16} />
                <ChevronDown className="room-chevron" size={15} />
              </button>
            ) : (
              <button className="create-room-pill" onClick={() => setIsEditingRoom(true)}>
                <Plus size={16} />
                Create room
              </button>
            )}

            {room && isEditingRoom && (
              <div className="room-popover" role="dialog" aria-label="Switch room">
                <RoomPrompt
                  room={room}
                  roomInput={roomInput}
                  passwordInput={passwordInput}
                  serverInput={serverInput}
                  recentRooms={recentRooms}
                  error={error}
                  showServer={desktopMode}
                  autoFocus
                  onRoomInput={setRoomInput}
                  onPasswordInput={setPasswordInput}
                  onServerInput={setServerInput}
                  onSubmit={() => enterRoom()}
                  onCancel={() => {
                    setRoomInput(room);
                    setPasswordInput(roomPassword);
                    setIsEditingRoom(false);
                  }}
                  onRecentRoom={enterRecentRoom}
                />
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="workspace">
        <div className="drop-column">
          <section className="drop-panel">
            <h2>Paste or drop</h2>
            <div
              ref={pasteBoxRef}
              tabIndex={0}
              role="textbox"
              aria-label="Paste or drop box"
              className={`paste-box ${isDragging ? "paste-box-dragging" : ""}`}
              onPaste={handlePaste}
              onDragOver={handleDragOver}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <span className="drop-icon">
                <UploadCloud size={44} strokeWidth={1.75} />
              </span>
              <div>
                <h3>Paste text or drop files</h3>
                <p>{room ? `Synced to room ${room} instantly` : "Create a room to start syncing instantly"}</p>
              </div>
              <div className="guidance-row">
                <span>
                  <Keyboard size={14} />
                  Ctrl/⌘ + V
                </span>
                <span>
                  <FolderUp size={14} />
                  Drag files
                </span>
                <span>
                  <HardDriveUpload size={14} />
                  200 MB max
                </span>
              </div>

              {uploadProgress && <UploadPrompt progress={uploadProgress} />}
            </div>
          </section>

          <section className="recent-panel">
            <h2>Recent rooms</h2>
            <div className="recent-list">
              {recentRooms.length ? (
                recentRooms.map((entry) => (
                  <button
                    key={entry.room}
                    className={entry.room === room ? "recent-chip recent-chip-active" : "recent-chip"}
                    onClick={() => enterRecentRoom(entry.room)}
                  >
                    <Link2 size={15} />
                    {entry.room}
                  </button>
                ))
              ) : (
                <p>No recent rooms yet.</p>
              )}
            </div>
          </section>

          {error && <p className="error-line">{error}</p>}
        </div>

        <section className="items-panel">
          <div className="items-head">
            <p>Recent pastes</p>
          </div>

          {visibleItems.length ? (
            <ol className="items-list">
              {visibleItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  isCopied={copiedItemId === item.id}
                  onCopy={copyItem}
                  onDelete={deleteItem}
                  onDownload={downloadItem}
                  onPreview={setExpandedImage}
                  getItemUrl={(itemUrl) => absoluteItemUrl(itemUrl, serverUrl)}
                />
              ))}
            </ol>
          ) : (
            <div className="empty-state">
              <FileCode2 size={34} />
              <p>{room ? "Paste text or drop a file to start syncing." : "Create a room to start syncing."}</p>
            </div>
          )}
        </section>
      </section>

      {newItemNotice && (
        <div className="new-item-notice" role="status" aria-live="polite">
          <span>
            <Clipboard size={16} />
          </span>
          <div>
            <strong>{newItemNotice.title}</strong>
            <p>{newItemNotice.detail}</p>
          </div>
        </div>
      )}

      {!room && isEditingRoom && (
        <div className="room-intro-overlay" role="dialog" aria-modal="true" aria-label="Create or join a room">
          <div className="room-intro-card">
            <div className="intro-brand">
              <span className="intro-mark" aria-hidden="true">
                <Zap size={20} fill="currentColor" />
              </span>
              <span>teleport</span>
            </div>
            <h2>Create or join a room</h2>
            <p className="intro-copy">Pick a short room name. Everyone using the same room sees the same paste list.</p>
            <RoomPrompt
              room={room}
              roomInput={roomInput}
              passwordInput={passwordInput}
              serverInput={serverInput}
              recentRooms={recentRooms}
              error={error}
              showServer={desktopMode}
              autoFocus
              compact
              onRoomInput={setRoomInput}
              onPasswordInput={setPasswordInput}
              onServerInput={setServerInput}
              onSubmit={() => enterRoom()}
              onRecentRoom={enterRecentRoom}
            />
          </div>
        </div>
      )}

      {expandedImage && (
        <div className="image-modal" role="dialog" aria-modal="true" onClick={() => setExpandedImage(null)}>
          <div className="image-modal-inner" onClick={(event) => event.stopPropagation()}>
            <button className="image-modal-close" onClick={() => setExpandedImage(null)} aria-label="Close preview">
              <X size={18} />
            </button>
            <img src={absoluteItemUrl(expandedImage.downloadUrl, serverUrl)} alt={expandedImage.fileName} />
            <p>{expandedImage.fileName}</p>
          </div>
        </div>
      )}
    </main>
  );
}

function ShortcutInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      className="shortcut-input"
      readOnly
      value={displayShortcut(value)}
      placeholder="Click, then press keys"
      title="Click, then press a key combination"
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const input = event.currentTarget;
        if (event.key === "Escape") {
          input.blur();
          return;
        }
        const nextShortcut = shortcutFromKeyboardEvent(event);
        if (nextShortcut) {
          onChange(nextShortcut);
          window.setTimeout(() => input.select(), 0);
        }
      }}
    />
  );
}

function RoomPrompt({
  room,
  roomInput,
  passwordInput,
  serverInput,
  recentRooms,
  error,
  autoFocus,
  compact,
  showServer,
  onRoomInput,
  onPasswordInput,
  onServerInput,
  onSubmit,
  onCancel,
  onRecentRoom,
}: {
  room: string;
  roomInput: string;
  passwordInput: string;
  serverInput: string;
  recentRooms: RecentRoom[];
  error: string;
  autoFocus?: boolean;
  compact?: boolean;
  showServer?: boolean;
  onRoomInput: (value: string) => void;
  onPasswordInput: (value: string) => void;
  onServerInput: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onCancel?: () => void;
  onRecentRoom: (room: string) => void | Promise<void>;
}) {
  const usableRooms = recentRooms.filter((entry) => entry.room !== room);

  return (
    <div className={compact ? "room-prompt room-prompt-compact" : "room-prompt"}>
      {!compact && (
        <div className="room-prompt-head">
          <div>
            <h2>Switch room</h2>
            <p>Create a new room or jump back to a recent one.</p>
          </div>
          {onCancel && (
            <button className="room-close" type="button" onClick={onCancel} aria-label="Close room switcher">
              <X size={16} />
            </button>
          )}
        </div>
      )}

      <form
        className="room-switch-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onCancel) onCancel();
        }}
      >
        <label>
          <span>
            <Link2 size={14} />
            Room
          </span>
          <input
            autoFocus={autoFocus}
            value={roomInput}
            onChange={(event) => onRoomInput(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Room name"
          />
        </label>

        {showServer && (
          <label>
            <span>
              <HardDriveUpload size={14} />
              Server
            </span>
            <input
              value={serverInput}
              onChange={(event) => onServerInput(event.target.value)}
              placeholder={defaultDesktopServerUrl}
              aria-label="Server URL"
            />
          </label>
        )}

        <label>
          <span>
            <LockKeyhole size={14} />
            Password
          </span>
          <input
            type="password"
            value={passwordInput}
            onChange={(event) => onPasswordInput(event.target.value)}
            placeholder="optional"
            aria-label="Room password"
          />
        </label>

        {error && <p className="room-form-error">{error}</p>}

        <div className="room-actions">
          {onCancel && (
            <button className="room-secondary" type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="room-primary" type="submit">
            <Send size={15} />
            {room ? "Switch" : "Enter room"}
          </button>
        </div>
      </form>

      {usableRooms.length > 0 && (
        <div className="room-recents">
          <p>Recent rooms</p>
          <div>
            {usableRooms.map((entry) => (
              <button key={entry.room} type="button" onClick={() => onRecentRoom(entry.room)}>
                <Link2 size={14} />
                {entry.room}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadPrompt({ progress }: { progress: UploadProgress }) {
  return (
    <div className="upload-prompt" aria-live="polite">
      <div className="upload-prompt-head">
        <strong>{progress.fileName}</strong>
        <span>
          {progress.index}/{progress.totalFiles}
        </span>
      </div>
      <div className="progress-track">
        <div style={{ width: `${progress.percent}%` }} />
      </div>
      <p>
        {progress.processing
          ? "Processing..."
          : `${progress.percent}% · ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`}
      </p>
    </div>
  );
}

function ItemCard({
  item,
  onCopy,
  onDelete,
  onDownload,
  onPreview,
  getItemUrl,
  isCopied,
}: {
  item: RoomItem;
  isCopied: boolean;
  onCopy: (item: RoomItem) => void;
  onDelete: (item: RoomItem) => void;
  onDownload: (item: RoomItem) => void;
  onPreview: (item: Extract<RoomItem, { type: "file" }>) => void;
  getItemUrl: (downloadUrl: string) => string;
}) {
  const title = item.type === "file" ? item.fileName : "Text paste";
  const icon = fileIconFor(item);
  const Icon = icon.Icon;
  const isImage = isPreviewableImage(item);
  const meta =
    item.type === "file"
      ? [formatBytes(item.fileSize), icon.label, timeLeft(item.expiresAt)]
      : [timeAgo(item.createdAt), timeLeft(item.expiresAt)];

  return (
    <li className={isCopied ? "item-card item-card-copied" : "item-card"}>
      {isImage && item.type === "file" ? (
        <button className="item-thumb" onClick={() => onPreview(item)} aria-label={`Preview ${item.fileName}`}>
          <img src={getItemUrl(item.downloadUrl)} alt="" loading="lazy" />
        </button>
      ) : (
        <div className={`item-icon item-icon-${icon.tone}`}>
          <Icon size={20} />
        </div>
      )}
      <div className="item-body">
        <div className="item-meta">
          <h4>{title}</h4>
          {meta.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </div>
        {item.type === "text" && <pre>{item.textContent}</pre>}
      </div>
      <div className="item-actions">
        <button className={isCopied ? "copy-action copy-action-done" : "copy-action"} onClick={() => onCopy(item)}>
          {isCopied ? <Check size={15} /> : <Copy size={15} />}
          <span>{isCopied ? "Copied" : item.type === "file" ? "Copy link" : "Copy"}</span>
        </button>
        {item.type === "file" && (
          <button className="primary-action" onClick={() => onDownload(item)}>
            <Download size={15} />
            Download
          </button>
        )}
        <button className="danger" onClick={() => onDelete(item)}>
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}

function MiniItemCard({
  item,
  onCopy,
  onDelete,
  onDownload,
  onPreview,
  getItemUrl,
  isCopied,
}: {
  item: RoomItem;
  isCopied: boolean;
  onCopy: (item: RoomItem) => void;
  onDelete: (item: RoomItem) => void;
  onDownload: (item: RoomItem) => void;
  onPreview: (item: Extract<RoomItem, { type: "file" }>) => void;
  getItemUrl: (downloadUrl: string) => string;
}) {
  const icon = fileIconFor(item);
  const Icon = icon.Icon;
  const isImage = isPreviewableImage(item);
  const title = item.type === "file" ? item.fileName : "Text paste";
  const meta = item.type === "file" ? `${formatBytes(item.fileSize)} · ${icon.label}` : timeAgo(item.createdAt);
  const primary = item.type === "file" ? onDownload : onCopy;

  return (
    <li className={isCopied ? "mini-item mini-item-copied" : "mini-item"}>
      <button className="mini-item-main" onClick={() => primary(item)}>
        {isImage && item.type === "file" ? (
          <span className="mini-thumb" onClick={(event) => {
            event.stopPropagation();
            onPreview(item);
          }}>
            <img src={getItemUrl(item.downloadUrl)} alt="" loading="lazy" />
          </span>
        ) : (
          <span className={`mini-file-icon item-icon-${icon.tone}`}>
            <Icon size={17} />
          </span>
        )}
        <span className="mini-item-copy">
          <strong>{title}</strong>
          <small>{meta} · {timeLeft(item.expiresAt)}</small>
          {item.type === "text" && <em>{item.textContent || "Locked text paste"}</em>}
        </span>
      </button>
      <div className="mini-item-actions">
        {item.type === "file" ? (
          <>
            <button onClick={() => onDownload(item)} title="Download" aria-label={`Download ${item.fileName}`}>
              <Download size={14} />
            </button>
            <button onClick={() => onCopy(item)} title="Copy link" aria-label={`Copy link for ${item.fileName}`}>
              {isCopied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </>
        ) : (
          <button onClick={() => onCopy(item)} title="Copy" aria-label="Copy text paste">
            {isCopied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
        <button className="mini-danger" onClick={() => onDelete(item)} title="Delete" aria-label="Delete item">
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
