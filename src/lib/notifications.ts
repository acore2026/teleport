import { notificationLeaseKey } from "../config";
import type { RoomItem } from "../types";
import { formatBytes } from "./format";
import { readCachedText } from "./room-storage";

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

export function notificationTitleFor(items: RoomItem[], room: string) {
  if (items.length > 1) return `${items.length} new pastes in ${room}`;
  const item = items[0];
  return item.type === "file" ? `New file in ${room}` : `New text in ${room}`;
}

export function notificationDetailFor(items: RoomItem[], room: string) {
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

export function tryClaimNotification(items: RoomItem[], room: string) {
  const ids = items
    .map((item) => item.id)
    .sort()
    .join(",");
  const key = `${room}:${ids}`;
  const now = Date.now();
  try {
    const current = JSON.parse(localStorage.getItem(notificationLeaseKey) || "null") as {
      key?: string;
      expiresAt?: number;
    } | null;
    if (current?.key === key && Number(current.expiresAt) > now) return false;

    localStorage.setItem(notificationLeaseKey, JSON.stringify({ key, expiresAt: now + 8000 }));
    return true;
  } catch {
    return true;
  }
}
