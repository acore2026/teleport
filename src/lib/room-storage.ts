import { recentRoomsKey, roomKey, roomPasswordsKey, textCacheKeyPrefix } from "../config";
import type { RecentRoom, RoomItem } from "../types";

export function normalizeRoom(value: string) {
  const room = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(room)) {
    throw new Error("Use letters, numbers, hyphens, or underscores.");
  }
  return room;
}

export function initialRoom() {
  try {
    const stored = localStorage.getItem(roomKey) || "";
    if (stored === "my-room") return "";
    return stored ? normalizeRoom(stored) : "";
  } catch {
    return "";
  }
}

export function readRecentRooms(): RecentRoom[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentRoomsKey) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function rememberRoom(room: string) {
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

export function passwordForRoom(room: string) {
  return readRoomPasswords()[room] || "";
}

export function rememberRoomPassword(room: string, password: string) {
  const passwords = readRoomPasswords();
  if (password) passwords[room] = password;
  else delete passwords[room];
  localStorage.setItem(roomPasswordsKey, JSON.stringify(passwords));
}

function textCacheKey(room: string, item: Extract<RoomItem, { type: "text" }>) {
  return `${textCacheKeyPrefix}:${room}:${item.id}:${item.hash}`;
}

export function readCachedText(room: string, item: Extract<RoomItem, { type: "text" }>) {
  try {
    return localStorage.getItem(textCacheKey(room, item));
  } catch {
    return null;
  }
}

export function rememberText(room: string, item: Extract<RoomItem, { type: "text" }>, text: string) {
  try {
    localStorage.setItem(textCacheKey(room, item), text);
  } catch {
    // Storage can be full or disabled; the network path still works.
  }
}

export function readableItem(item: RoomItem, room: string): RoomItem {
  if (item.type !== "text") return item;
  if (!item.encrypted && !item.textEncoding) return item;

  const cached = readCachedText(room, item);
  if (cached !== null) {
    return { ...item, textContent: cached, bytes: new Blob([cached]).size };
  }

  return { ...item, textContent: "", bytes: 0 };
}
