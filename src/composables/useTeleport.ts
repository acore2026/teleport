import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import {
  chunkSizeKbKey,
  chunkUploadsEnabledKey,
  defaultChunkSizeKb,
  maxFileBytes,
  maxChunkSizeKb,
  maxTextBytes,
  minChunkSizeKb,
  roomKey,
} from "../config";
import { absoluteItemUrl, apiUrl, readJsonPayload } from "../lib/api";
import { copyText, filesFromClipboard } from "../lib/clipboard";
import { formatBytes } from "../lib/format";
import {
  notificationDetailFor,
  notificationTitleFor,
} from "../lib/notifications";
import {
  initialRoom,
  normalizeRoom,
  passwordForRoom,
  readRecentRooms,
  rememberRoom,
  rememberRoomPassword,
  rememberText,
} from "../lib/room-storage";
import {
  initialNumberSetting,
  initialStoredBooleanSetting,
} from "../lib/settings";
import {
  base64FromBytes,
  maybeCompressText,
  sealPreparedText,
  stripData,
} from "../lib/text-codec";
import { uploadFile } from "../lib/upload";
import type {
  CryptoEnvelope,
  NewItemNotice,
  RecentRoom,
  RoomItem,
  RoomPayload,
  UploadProgress,
} from "../types";
import { useProxyChallenge } from "./useProxyChallenge";
import { useRoomFeed } from "./useRoomFeed";
import { useTextCache } from "./useTextCache";

export function useTeleport() {
  const initialRoomValue = initialRoom();
  const roomInput = ref(initialRoomValue);
  const room = ref(initialRoomValue);
  const chunkUploadsEnabled = ref(
    initialStoredBooleanSetting(chunkUploadsEnabledKey, true),
  );
  const chunkSizeKb = ref(
    initialNumberSetting(
      chunkSizeKbKey,
      defaultChunkSizeKb,
      minChunkSizeKb,
      maxChunkSizeKb,
    ),
  );
  const passwordInput = ref(
    initialRoomValue ? passwordForRoom(initialRoomValue) : "",
  );
  const roomPassword = ref(passwordInput.value);
  const isEditingRoom = ref(!initialRoomValue);
  const items = ref<RoomItem[]>([]);
  const recentRooms = ref<RecentRoom[]>(readRecentRooms());
  const error = ref("");
  const isDragging = ref(false);
  const uploadProgress = ref<UploadProgress | null>(null);
  const copiedItemId = ref("");
  const newItemNotice = ref<NewItemNotice | null>(null);
  const expandedImage = ref<Extract<RoomItem, { type: "file" }> | null>(null);
  const pasteBox = ref<HTMLDivElement | null>(null);
  const noticeTimer = ref<number | null>(null);
  const now = ref(Date.now());
  let clockTimer: number | undefined;
  const { visibleItems, invalidateTextCache } = useTextCache({
    items,
    room,
    roomPassword,
  });
  const { proxyChallenge, openProxyChallenge, handleSyncError } =
    useProxyChallenge();
  const { loadRoom, primeRoomFeed, syncRoomItems } = useRoomFeed({
    room,
    items,
    error,
    handleSyncError,
    notifyNewItems,
  });
  watch(
    [chunkSizeKb, chunkUploadsEnabled],
    () => {
      localStorage.setItem(
        chunkUploadsEnabledKey,
        String(chunkUploadsEnabled.value),
      );
      localStorage.setItem(chunkSizeKbKey, String(chunkSizeKb.value));
    },
    { immediate: true },
  );
  watch(
    room,
    (nextRoom) => {
      if (!nextRoom) return;
      rememberRoom(nextRoom);
      recentRooms.value = readRecentRooms();
    },
    { immediate: true },
  );
  onMounted(() => {
    clockTimer = window.setInterval(() => {
      now.value = Date.now();
    }, 30000);
  });
  onUnmounted(() => {
    window.clearInterval(clockTimer);
    if (noticeTimer.value) window.clearTimeout(noticeTimer.value);
  });
  function notifyNewItems(newItems: RoomItem[], nextRoom: string) {
    const title = notificationTitleFor(newItems, nextRoom);
    const detail = notificationDetailFor(newItems, nextRoom);
    newItemNotice.value = {
      id: `${Date.now()}:${newItems.map((item) => item.id).join(",")}`,
      title,
      detail,
    };
    if (noticeTimer.value) window.clearTimeout(noticeTimer.value);
    noticeTimer.value = window.setTimeout(() => {
      newItemNotice.value = null;
      noticeTimer.value = null;
    }, 4200);
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
    proxyChallenge.value = null;
    error.value = "";
    if (!room.value) return;
    primeRoomFeed(room.value);
    loadRoom(room.value).catch((caught) => {
      error.value = handleSyncError(caught, "Unable to load room.");
    });
  }
  async function enterRoom(value = roomInput.value, passwordValue?: string) {
    try {
      const nextRoom = normalizeRoom(value);
      const nextPassword = passwordValue ?? passwordInput.value;
      error.value = "";
      room.value = nextRoom;
      roomInput.value = nextRoom;
      passwordInput.value = nextPassword;
      roomPassword.value = nextPassword;
      isEditingRoom.value = false;
      localStorage.setItem(roomKey, nextRoom);
      rememberRoomPassword(nextRoom, nextPassword);
      rememberRoom(nextRoom);
      recentRooms.value = readRecentRooms();
      await nextTick();
      pasteBox.value?.focus();
    } catch (caught) {
      error.value =
        caught instanceof Error ? caught.message : "Invalid room name.";
    }
  }
  function enterRecentRoom(nextRoom: string) {
    roomInput.value = nextRoom;
    const nextPassword = passwordForRoom(nextRoom);
    passwordInput.value = nextPassword;
    void enterRoom(nextRoom, nextPassword);
  }
  function handlePaste(event: ClipboardEvent) {
    if (!event.clipboardData) return;
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
        error.value = handleSyncError(caught, "Text sync failed.");
      });
    }
  }
  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    isDragging.value = true;
  }
  function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDragging.value = false;
    if (event.dataTransfer) void uploadFiles(event.dataTransfer.files);
  }
  async function uploadText(content: string) {
    const targetRoom = room.value;
    const targetPassword = roomPassword.value;

    const text = content.trimEnd();
    if (!text.trim()) return;
    if (!targetRoom) {
      error.value = "Create or join a room first.";
      isEditingRoom.value = true;
      return;
    }
    if (new Blob([text]).size > maxTextBytes) {
      error.value = `Text is larger than ${formatBytes(maxTextBytes)}.`;
      return;
    }
    error.value = "";
    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
    let sealed: CryptoEnvelope | null = null;
    let uploadContent = text;
    let textEncoding: "gzip-base64" | null = null;
    try {
      const prepared = await maybeCompressText(text);
      if (targetPassword) {
        sealed = await sealPreparedText(prepared, targetRoom, targetPassword);
      } else if (prepared.compressed) {
        uploadContent = base64FromBytes(prepared.bytes);
        textEncoding = "gzip-base64";
      }
      const response = await fetch(
        apiUrl(`/api/rooms/${encodeURIComponent(targetRoom)}/items`),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            sealed
              ? {
                  content: sealed.data,
                  encrypted: true,
                  cryptoMeta: stripData(sealed),
                }
              : { content: uploadContent, textEncoding },
          ),
        },
      );
      const payload = await readJsonPayload(response);
      if (!response.ok || "error" in payload) {
        error.value = "error" in payload ? payload.error : "Text sync failed.";
        return;
      }
      const nextItems = payload.items;
      if (sealed) {
        const saved = nextItems.find(
          (
            item,
          ): item is Extract<
            RoomItem,
            {
              type: "text";
            }
          > =>
            item.type === "text" &&
            Boolean(item.encrypted) &&
            item.textContent === sealed?.data,
        );
        if (saved) {
          rememberText(targetRoom, saved, text);
          invalidateTextCache();
        }
      } else if (textEncoding) {
        const saved = nextItems.find(
          (
            item,
          ): item is Extract<
            RoomItem,
            {
              type: "text";
            }
          > =>
            item.type === "text" &&
            item.textEncoding === textEncoding &&
            item.textContent === uploadContent,
        );
        if (saved) {
          rememberText(targetRoom, saved, text);
          invalidateTextCache();
        }
      }
      syncRoomItems(nextItems, targetRoom, false);
      return true;
    } catch (caught) {
      error.value = handleSyncError(caught, "Text sync failed.");
    }
  }
  async function uploadFiles(files: FileList | File[]) {
    const targetRoom = room.value;
    const chunkSizeBytes = chunkUploadsEnabled.value
      ? Math.min(
          maxChunkSizeKb,
          Math.max(minChunkSizeKb, Math.round(chunkSizeKb.value)),
        ) * 1024
      : null;

    if (!targetRoom) {
      error.value = "Create or join a room first.";
      isEditingRoom.value = true;
      return;
    }
    const batch = Array.from(files);
    if (!batch.length) return;
    error.value = "";
    for (let i = 0; i < batch.length; i += 1) {
      const file = batch[i];
      if (file.size > maxFileBytes) {
        error.value = `${file.name} is larger than 200 MB.`;
        continue;
      }
      try {
        const payload = await uploadFile(file, i + 1, batch.length, {
          room: targetRoom,
          onProgress: (progress) => {
            uploadProgress.value = progress;
          },
          chunkSizeBytes,
        });
        syncRoomItems(payload.items, targetRoom, false);
      } catch (caught) {
        error.value = handleSyncError(
          caught,
          `Upload failed for ${file.name}.`,
        );
      }
    }
    setTimeout(() => (uploadProgress.value = null), 900);
  }
  async function deleteItem(item: RoomItem) {
    const targetRoom = room.value;

    try {
      const response = await fetch(
        apiUrl(
          `/api/rooms/${encodeURIComponent(targetRoom)}/items/${encodeURIComponent(item.id)}`,
        ),
        { method: "DELETE" },
      );
      const payload = await readJsonPayload(response);
      if (response.ok)
        syncRoomItems((payload as RoomPayload).items, targetRoom, false);
      else error.value = "error" in payload ? payload.error : "Delete failed.";
    } catch (caught) {
      error.value = handleSyncError(caught, "Delete failed.");
    }
  }
  async function togglePin(item: RoomItem) {
    const targetRoom = room.value;

    try {
      const response = await fetch(
        apiUrl(
          `/api/rooms/${encodeURIComponent(targetRoom)}/items/${encodeURIComponent(item.id)}/pin`,
        ),
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pinned: !item.pinned }),
        },
      );
      const payload = await readJsonPayload(response);
      if (response.ok) {
        error.value = "";
        syncRoomItems((payload as RoomPayload).items, targetRoom, false);
      } else {
        error.value =
          "error" in payload ? payload.error : "Unable to update pin.";
      }
    } catch (caught) {
      error.value = handleSyncError(caught, "Unable to update pin.");
    }
  }
  async function copyItem(item: RoomItem) {
    if (item.type === "text" && !item.textContent) return;
    await copyText(
      item.type === "text"
        ? item.textContent
        : absoluteItemUrl(item.downloadUrl),
    );
    copiedItemId.value = item.id;
    window.setTimeout(() => {
      copiedItemId.value =
        copiedItemId.value === item.id ? "" : copiedItemId.value;
    }, 1300);
  }
  async function downloadItem(item: RoomItem) {
    if (item.type !== "file") return;
    window.open(
      absoluteItemUrl(item.downloadUrl),
      "_blank",
      "noopener,noreferrer",
    );
  }

  return {
    roomInput,
    room,
    chunkUploadsEnabled,
    chunkSizeKb,
    passwordInput,
    roomPassword,
    isEditingRoom,
    recentRooms,
    error,
    isDragging,
    uploadProgress,
    copiedItemId,
    newItemNotice,
    expandedImage,
    pasteBox,
    now,
    visibleItems,
    proxyChallenge,
    openProxyChallenge,
    retryProxyConnection,
    enterRoom,
    enterRecentRoom,
    uploadText,
    handlePaste,
    handleDragOver,
    handleDrop,
    deleteItem,
    togglePin,
    copyItem,
    downloadItem,
  };
}
