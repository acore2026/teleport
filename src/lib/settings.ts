import { invoke, isTauri } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { defaultDesktopServerUrl, desktopSettingsFile, minifiedModeKey, serverUrlKey } from "../config";
import { passwordForRoom, rememberRoomPassword } from "./room-storage";

export function isDesktopRuntime() {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

export function initialServerUrl() {
  if (!isDesktopRuntime()) return "";
  try {
    return localStorage.getItem(serverUrlKey) || defaultDesktopServerUrl;
  } catch {
    return defaultDesktopServerUrl;
  }
}

export function initialMinifiedMode() {
  if (!isDesktopRuntime()) return false;
  try {
    const stored = localStorage.getItem(minifiedModeKey);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

export function initialBooleanSetting(key: string, fallback: boolean) {
  if (!isDesktopRuntime()) return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

export function initialStoredBooleanSetting(key: string, fallback: boolean) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

export function initialNumberSetting(key: string, fallback: number, min: number, max: number) {
  try {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored >= min && stored <= max ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function initialShortcut(key: string, fallback: string, legacyValues: string[] = []) {
  if (!isDesktopRuntime()) return fallback;
  try {
    return normalizeStoredShortcut(localStorage.getItem(key) || "", fallback, legacyValues);
  } catch {
    return fallback;
  }
}

export function normalizeStoredShortcut(value: string, fallback: string, legacyValues: string[] = []) {
  return legacyValues.includes(value) ? fallback : value || fallback;
}

export function normalizeServerUrl(value: string) {
  const url = value.trim().replace(/\/+$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Server must start with http:// or https://.");
  }
  return url;
}

export async function loadDesktopStore() {
  if (!isDesktopRuntime()) return null;
  return Store.load(desktopSettingsFile, { defaults: {}, autoSave: true });
}

export async function keychainGet(room: string) {
  if (!isDesktopRuntime()) return passwordForRoom(room);
  try {
    return (await invoke<string | null>("keychain_get", { room })) || "";
  } catch {
    return "";
  }
}

export async function keychainSet(room: string, password: string) {
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
