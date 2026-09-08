import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Image } from "@tauri-apps/api/image";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  writeImage as writeClipboardImage,
  writeText as writeClipboardText,
} from "@tauri-apps/plugin-clipboard-manager";
import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { Store } from "@tauri-apps/plugin-store";
import React from "react";
import {
  autoCaptureClipboardKey,
  autoCopyIncomingKey,
  copyShortcutKey,
  defaultDesktopServerUrl,
  legacyOpenPanelShortcuts,
  maxFileBytes,
  maxTextBytes,
  minifiedModeKey,
  notificationsEnabledKey,
  openPanelShortcutKey,
  pasteShortcutKey,
  roomKey,
  serverUrlKey,
} from "../config";
import { absoluteItemUrl, apiUrl, readJsonPayload } from "../lib/api";
import {
  blobToPngBytes,
  clipboardImageSignature,
  clipboardTextSignature,
  filesFromClipboard,
  rememberClipboardWriteSignature,
} from "../lib/clipboard";
import { formatBytes } from "../lib/format";
import { notificationDetailFor, notificationTitleFor, tryClaimNotification } from "../lib/notifications";
import {
  initialRoom,
  normalizeRoom,
  passwordForRoom,
  readCachedText,
  readRecentRooms,
  rememberRoom,
  rememberText,
} from "../lib/room-storage";
import {
  initialBooleanSetting,
  initialMinifiedMode,
  initialServerUrl,
  initialShortcut,
  isDesktopRuntime,
  keychainGet,
  keychainSet,
  loadDesktopStore,
  normalizeServerUrl,
  normalizeStoredShortcut,
} from "../lib/settings";
import { desktopShortcutDefaults, normalizeShortcut } from "../lib/shortcuts";
import {
  base64FromBytes,
  maybeCompressText,
  openTextItem,
  sealPreparedText,
  stripData,
} from "../lib/text-codec";
import { uploadFile } from "../lib/upload";
import type {
  CryptoEnvelope,
  DesktopStateSync,
  NewItemNotice,
  RecentRoom,
  RoomItem,
  RoomPayload,
  UploadProgress,
} from "../types";
import { useDesktopClipboard } from "./useDesktopClipboard";
import { useProxyChallenge } from "./useProxyChallenge";
import { useRoomFeed } from "./useRoomFeed";
import { useTextCache } from "./useTextCache";

export function useTeleport() {
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
  const initialAutoCopyIncoming = React.useMemo(() => initialBooleanSetting(autoCopyIncomingKey, false), []);
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
  const pasteBoxRef = React.useRef<HTMLDivElement | null>(null);
  const desktopStoreRef = React.useRef<Store | null>(null);
  const miniWindowDragRef = React.useRef(false);
  const miniWindowDragTimerRef = React.useRef<number | null>(null);
  const lastClipboardWriteSignatureRef = React.useRef("");
  const autoCopyIncomingRef = React.useRef(autoCopyIncoming);
  const roomPasswordRef = React.useRef(roomPassword);
  const serverUrlRef = React.useRef(serverUrl);
  const noticeTimerRef = React.useRef<number | null>(null);

  const { visibleItems, setCacheVersion } = useTextCache({ items, room, roomPassword });

  const { proxyChallenge, setProxyChallenge, openProxyChallenge, handleSyncError } = useProxyChallenge({
    desktopMode,
    serverUrl,
  });

  const { loadRoom, primeRoomFeed, syncRoomItems } = useRoomFeed({
    room,
    serverUrl,
    setItems,
    setError,
    handleSyncError,
    notifyNewItems,
    copyIncomingItems,
  });

  const { writeItemToClipboard } = useDesktopClipboard({
    desktopMode,
    isMiniWindow,
    currentWindowLabel,
    room,
    roomPassword,
    serverUrl,
    autoCaptureClipboard,
    visibleItems,
    openPanelShortcut,
    copyShortcut,
    pasteShortcut,
    pasteBoxRef,
    setSettingsMessage,
    setError,
    setIsEditingRoom,
    uploadText,
    uploadFiles,
    lastClipboardWriteSignatureRef,
  });

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

  React.useEffect(() => {
    autoCopyIncomingRef.current = autoCopyIncoming;
  }, [autoCopyIncoming]);

  React.useEffect(() => {
    roomPasswordRef.current = roomPassword;
  }, [roomPassword]);

  React.useEffect(() => {
    serverUrlRef.current = serverUrl;
  }, [serverUrl]);

  const openFullWindow = React.useCallback(async () => {
    publishDesktopState();
    await invoke("show_full_window").catch(() => undefined);
  }, [publishDesktopState]);

  React.useEffect(() => {
    if (!desktopMode) return undefined;

    let cancelled = false;
    loadDesktopStore()
      .then(async (store) => {
        if (!store || cancelled) return;
        desktopStoreRef.current = store;
        const storedServerUrl = normalizeServerUrl(
          (await store.get<string>(serverUrlKey)) || initialServerValue,
        );
        const storedRoom = (await store.get<string>(roomKey)) || initialRoomValue;
        const storedMinified = (await store.get<boolean>(minifiedModeKey)) ?? initialMinifiedValue;
        const storedOpenPanelShortcut =
          normalizeStoredShortcut(
            (await store.get<string>(openPanelShortcutKey)) || "",
            shortcutDefaults.openPanel,
            legacyOpenPanelShortcuts,
          ) || initialShortcut(openPanelShortcutKey, shortcutDefaults.openPanel, legacyOpenPanelShortcuts);
        const storedCopyShortcut =
          (await store.get<string>(copyShortcutKey)) ||
          initialShortcut(copyShortcutKey, shortcutDefaults.copy);
        const storedPasteShortcut =
          (await store.get<string>(pasteShortcutKey)) ||
          initialShortcut(pasteShortcutKey, shortcutDefaults.paste);
        const storedAutoCapture =
          (await store.get<boolean>(autoCaptureClipboardKey)) ?? initialAutoCaptureClipboard;
        const storedAutoCopy = (await store.get<boolean>(autoCopyIncomingKey)) ?? initialAutoCopyIncoming;
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
    if (!desktopMode) return undefined;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("teleport-proxy-confirmed", () => {
      if (cancelled) return;
      setProxyChallenge(null);
      setError("");
      if (!room) return;
      primeRoomFeed(room);
      loadRoom(room).catch((caught) => {
        setError(handleSyncError(caught, "Unable to load room."));
      });
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
  }, [desktopMode, room, serverUrl]);

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
    currentWindow
      .onFocusChanged(({ payload }) => {
        if (!payload) {
          if (!disposed && !miniWindowDragRef.current) invoke("hide_mini_panel").catch(() => undefined);
        }
      })
      .then((unlisten) => unlisteners.push(unlisten));
    onAction(() => {
      invoke("show_mini_panel").catch(() => undefined);
    })
      .then((listener) => {
        unlisteners.push(() => {
          listener.unregister().catch(() => undefined);
        });
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (miniWindowDragTimerRef.current) window.clearTimeout(miniWindowDragTimerRef.current);
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

  async function copyIncomingItems(newItems: RoomItem[], nextRoom: string) {
    if (!desktopMode || !autoCopyIncomingRef.current) return;
    const item = newItems.find(
      (candidate) =>
        candidate.type === "text" || (candidate.type === "file" && candidate.mimeType.startsWith("image/")),
    );
    if (!item) return;

    if (item.type === "text") {
      let text = readCachedText(nextRoom, item) || "";
      if (!text) {
        text = await openTextItem(item, nextRoom, roomPasswordRef.current);
        if (item.encrypted || item.textEncoding) {
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

    const response = await fetch(absoluteItemUrl(item.downloadUrl, serverUrlRef.current));
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

    if (
      "Notification" in window &&
      Notification.permission === "granted" &&
      (document.hidden || !document.hasFocus())
    ) {
      new Notification("teleport", {
        body: `${title} · ${detail}`,
        tag: `teleport:${nextRoom}`,
      });
    }
  }

  function retryProxyConnection() {
    setProxyChallenge(null);
    setError("");
    if (!room) return;
    primeRoomFeed(room);
    loadRoom(room).catch((caught) => {
      setError(handleSyncError(caught, "Unable to load room."));
    });
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
      uploadText(text).catch((caught) => {
        setError(handleSyncError(caught, "Text sync failed."));
      });
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
    if (new Blob([text]).size > maxTextBytes) {
      setError(`Text is larger than ${formatBytes(maxTextBytes)}.`);
      return;
    }

    setError("");
    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
    let sealed: CryptoEnvelope | null = null;
    let uploadContent = text;
    let textEncoding: "gzip-base64" | null = null;
    try {
      const prepared = await maybeCompressText(text);
      if (roomPassword) {
        sealed = await sealPreparedText(prepared, room, roomPassword);
      } else if (prepared.compressed) {
        uploadContent = base64FromBytes(prepared.bytes);
        textEncoding = "gzip-base64";
      }
      const response = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(room)}/items`, serverUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          sealed
            ? { content: sealed.data, encrypted: true, cryptoMeta: stripData(sealed) }
            : { content: uploadContent, textEncoding },
        ),
      });
      const payload = await readJsonPayload(response);
      if (!response.ok || "error" in payload) {
        setError("error" in payload ? payload.error : "Text sync failed.");
        return;
      }

      const nextItems = payload.items;
      if (sealed) {
        const saved = nextItems.find(
          (item): item is Extract<RoomItem, { type: "text" }> =>
            item.type === "text" && Boolean(item.encrypted) && item.textContent === sealed?.data,
        );
        if (saved) {
          rememberText(room, saved, text);
          setCacheVersion((value) => value + 1);
        }
      } else if (textEncoding) {
        const saved = nextItems.find(
          (item): item is Extract<RoomItem, { type: "text" }> =>
            item.type === "text" && item.textEncoding === textEncoding && item.textContent === uploadContent,
        );
        if (saved) {
          rememberText(room, saved, text);
          setCacheVersion((value) => value + 1);
        }
      }

      syncRoomItems(nextItems, room, false);
      return true;
    } catch (caught) {
      setError(handleSyncError(caught, "Text sync failed."));
    }
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
        const payload = await uploadFile(file, i + 1, batch.length, {
          room,
          serverUrl,
          desktopMode,
          onProgress: setUploadProgress,
        });
        syncRoomItems(payload.items, room, false);
      } catch (caught) {
        setError(handleSyncError(caught, `Upload failed for ${file.name}.`));
      }
    }

    setTimeout(() => setUploadProgress(null), 900);
  }

  async function deleteItem(item: RoomItem) {
    try {
      const response = await fetch(
        apiUrl(`/api/rooms/${encodeURIComponent(room)}/items/${encodeURIComponent(item.id)}`, serverUrl),
        { method: "DELETE" },
      );
      const payload = await readJsonPayload(response);
      if (response.ok) syncRoomItems((payload as RoomPayload).items, room, false);
      else setError("error" in payload ? payload.error : "Delete failed.");
    } catch (caught) {
      setError(handleSyncError(caught, "Delete failed."));
    }
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
          getCurrentWindow()
            .setFocus()
            .catch(() => undefined);
        }, 350);
      });
  }

  return {
    roomInput,
    setRoomInput,
    room,
    serverInput,
    setServerInput,
    serverUrl,
    minifiedMode,
    setMinifiedMode,
    openPanelInput,
    setOpenPanelInput,
    copyInput,
    setCopyInput,
    pasteInput,
    setPasteInput,
    autoCaptureClipboard,
    setAutoCaptureClipboard,
    autoCopyIncoming,
    setAutoCopyIncoming,
    notificationsEnabled,
    setNotificationsEnabled,
    passwordInput,
    setPasswordInput,
    isEditingRoom,
    setIsEditingRoom,
    recentRooms,
    error,
    isDragging,
    setIsDragging,
    uploadProgress,
    copiedItemId,
    newItemNotice,
    expandedImage,
    setExpandedImage,
    isMiniSettingsOpen,
    setIsMiniSettingsOpen,
    settingsMessage,
    proxyChallenge,
    setProxyChallenge,
    pasteBoxRef,
    visibleItems,
    openFullWindow,
    openProxyChallenge,
    retryProxyConnection,
    enterRoom,
    enterRecentRoom,
    uploadText,
    handlePaste,
    handleDragOver,
    handleDrop,
    deleteItem,
    copyItem,
    downloadItem,
    startMiniWindowDrag,
    desktopMode,
    roomPassword,
    isMiniWindow,
  };
}

export type TeleportModel = ReturnType<typeof useTeleport>;
