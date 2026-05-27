import React from "react";
import { createRoot } from "react-dom/client";
import CryptoJS from "crypto-js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  toggleMini: string;
  openFull: string;
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
const toggleMiniShortcutKey = "teleport-shortcut-toggle-mini";
const openFullShortcutKey = "teleport-shortcut-open-full";
const defaultDesktopServerUrl = "http://101.245.78.174:7777";
const defaultShortcuts: DesktopShortcuts = {
  toggleMini: "CommandOrControl+Shift+V",
  openFull: "CommandOrControl+Shift+O",
};
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

function initialShortcut(key: string, fallback: string) {
  if (!isDesktopRuntime()) return fallback;
  try {
    return localStorage.getItem(key) || fallback;
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
    throw new Error("Shortcut must include at least one modifier, for example CommandOrControl+Shift+V.");
  }
  return shortcut;
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

function notificationTitleFor(items: RoomItem[]) {
  if (items.length > 1) return `${items.length} new pastes`;
  const item = items[0];
  return item.type === "file" ? item.fileName : "New text paste";
}

function notificationDetailFor(items: RoomItem[], room: string) {
  if (items.length > 1) return `Synced to room ${room}`;
  const item = items[0];
  if (item.type === "file") return `${formatBytes(item.fileSize)} · ${item.mimeType || "file"}`;
  return "Synced to room";
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
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
  const [roomInput, setRoomInput] = React.useState(initialRoomValue);
  const [room, setRoom] = React.useState(initialRoomValue);
  const [serverInput, setServerInput] = React.useState(initialServerValue);
  const [serverUrl, setServerUrl] = React.useState(initialServerValue);
  const [minifiedMode, setMinifiedMode] = React.useState(initialMinifiedValue);
  const [toggleMiniShortcut, setToggleMiniShortcut] = React.useState(() =>
    initialShortcut(toggleMiniShortcutKey, defaultShortcuts.toggleMini),
  );
  const [openFullShortcut, setOpenFullShortcut] = React.useState(() =>
    initialShortcut(openFullShortcutKey, defaultShortcuts.openFull),
  );
  const [toggleMiniInput, setToggleMiniInput] = React.useState(toggleMiniShortcut);
  const [openFullInput, setOpenFullInput] = React.useState(openFullShortcut);
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
  const [cacheVersion, setCacheVersion] = React.useState(0);
  const pasteBoxRef = React.useRef<HTMLDivElement | null>(null);
  const desktopStoreRef = React.useRef<Store | null>(null);
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
        const storedToggleShortcut =
          (await store.get<string>(toggleMiniShortcutKey)) ||
          initialShortcut(toggleMiniShortcutKey, defaultShortcuts.toggleMini);
        const storedOpenFullShortcut =
          (await store.get<string>(openFullShortcutKey)) ||
          initialShortcut(openFullShortcutKey, defaultShortcuts.openFull);
        const nextRoom = storedRoom ? normalizeRoom(storedRoom) : "";
        const nextPassword = nextRoom ? await keychainGet(nextRoom) : "";

        if (cancelled) return;
        setServerUrl(storedServerUrl || defaultDesktopServerUrl);
        setServerInput(storedServerUrl || defaultDesktopServerUrl);
        setMinifiedMode(storedMinified);
        setToggleMiniShortcut(storedToggleShortcut);
        setToggleMiniInput(storedToggleShortcut);
        setOpenFullShortcut(storedOpenFullShortcut);
        setOpenFullInput(storedOpenFullShortcut);
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
      });

    return () => {
      cancelled = true;
    };
  }, [desktopMode, initialMinifiedValue, initialRoomValue, initialServerValue, isMiniWindow]);

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
    const shortcuts = [toggleMiniShortcut, openFullShortcut].filter(
      (shortcut, index, values) => shortcut && values.indexOf(shortcut) === index,
    );
    register(shortcuts, async (event) => {
      if (event.state !== "Pressed") return;
      if (event.shortcut === openFullShortcut) {
        await openFullWindow();
        return;
      }
      await invoke("toggle_mini_panel").catch(() => undefined);
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
  }, [desktopMode, isMiniWindow, openFullShortcut, openFullWindow, toggleMiniShortcut]);

  React.useEffect(() => {
    if (!desktopMode || !isMiniWindow) return undefined;

    let disposed = false;
    const currentWindow = getCurrentWindow();
    const unlisteners: Array<() => void> = [];
    currentWindow.onFocusChanged(({ payload }) => {
      if (!payload) {
        window.setTimeout(() => {
          if (!disposed) invoke("hide_mini_panel").catch(() => undefined);
        }, 120);
      }
    }).then((unlisten) => unlisteners.push(unlisten));
    onAction(() => {
      invoke("show_mini_panel").catch(() => undefined);
    }).then((listener) => {
      unlisteners.push(() => {
        listener.unregister().catch(() => undefined);
      });
    });

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [desktopMode, isMiniWindow]);

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
    }
  }

  function notifyNewItems(newItems: RoomItem[], nextRoom: string) {
    const title = notificationTitleFor(newItems);
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
      sendDesktopNotification(title, detail, nextRoom);
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
        body: `${detail} · ${nextRoom}`,
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

  async function applyDesktopSettings() {
    try {
      const nextServerUrl = normalizeServerUrl(serverInput) || defaultDesktopServerUrl;
      const nextToggleShortcut = normalizeShortcut(toggleMiniInput, defaultShortcuts.toggleMini);
      const nextOpenFullShortcut = normalizeShortcut(openFullInput, defaultShortcuts.openFull);
      if (nextToggleShortcut === nextOpenFullShortcut) {
        throw new Error("Shortcuts must be different.");
      }

      setServerUrl(nextServerUrl);
      setServerInput(nextServerUrl);
      setToggleMiniShortcut(nextToggleShortcut);
      setToggleMiniInput(nextToggleShortcut);
      setOpenFullShortcut(nextOpenFullShortcut);
      setOpenFullInput(nextOpenFullShortcut);
      setSettingsMessage("Saved");
      localStorage.setItem(serverUrlKey, nextServerUrl);
      localStorage.setItem(minifiedModeKey, String(minifiedMode));
      localStorage.setItem(toggleMiniShortcutKey, nextToggleShortcut);
      localStorage.setItem(openFullShortcutKey, nextOpenFullShortcut);

      if (desktopStoreRef.current) {
        await desktopStoreRef.current.set(serverUrlKey, nextServerUrl);
        await desktopStoreRef.current.set(minifiedModeKey, minifiedMode);
        await desktopStoreRef.current.set(toggleMiniShortcutKey, nextToggleShortcut);
        await desktopStoreRef.current.set(openFullShortcutKey, nextOpenFullShortcut);
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
    if (item.type === "file") {
      await copyText(absoluteItemUrl(item.downloadUrl, serverUrl));
    } else if (item.textContent) {
      await copyText(item.textContent);
    } else {
      return;
    }

    setCopiedItemId(item.id);
    window.setTimeout(() => {
      setCopiedItemId((current) => (current === item.id ? "" : current));
    }, 1300);
  }

  async function downloadItem(item: RoomItem) {
    if (item.type !== "file") return;
    window.open(absoluteItemUrl(item.downloadUrl, serverUrl), "_blank", "noopener,noreferrer");
  }

  function startMiniWindowDrag(event: React.MouseEvent<HTMLElement>) {
    if (!desktopMode || !isMiniWindow || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) return;
    getCurrentWindow().startDragging().catch(() => undefined);
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
                <label>
                  <span>Server address</span>
                  <input value={serverInput} onChange={(event) => setServerInput(event.target.value)} />
                </label>
                <label>
                  <span>Toggle panel</span>
                  <input value={toggleMiniInput} onChange={(event) => setToggleMiniInput(event.target.value)} />
                </label>
                <label>
                  <span>Full window</span>
                  <input value={openFullInput} onChange={(event) => setOpenFullInput(event.target.value)} />
                </label>
              </div>

              <div className="mini-settings-foot">
                {settingsMessage && <p>{settingsMessage}</p>}
                <button type="button" onClick={applyDesktopSettings}>
                  Save
                </button>
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
