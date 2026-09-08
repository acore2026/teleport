import { invoke } from "@tauri-apps/api/core";
import { Image } from "@tauri-apps/api/image";
import {
  readImage as readClipboardImage,
  readText as readClipboardText,
  writeImage as writeClipboardImage,
  writeText as writeClipboardText,
} from "@tauri-apps/plugin-clipboard-manager";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import React from "react";
import { absoluteItemUrl } from "../lib/api";
import {
  blobToPngBytes,
  clipboardImageSignature,
  clipboardTextSignature,
  copyText,
  imageToPngBlob,
  readClipboardSnapshot,
  rememberClipboardWriteSignature,
  restoreClipboardSnapshot,
  stampFileName,
  tryClaimClipboardCaptureLease,
  wasClipboardWrittenByTeleport,
} from "../lib/clipboard";
import { shortcutsMatch } from "../lib/shortcuts";
import { wait } from "../lib/timing";
import type { RoomItem } from "../types";

type Options = {
  desktopMode: boolean;
  isMiniWindow: boolean;
  currentWindowLabel: string;
  room: string;
  roomPassword: string;
  serverUrl: string;
  autoCaptureClipboard: boolean;
  visibleItems: RoomItem[];
  openPanelShortcut: string;
  copyShortcut: string;
  pasteShortcut: string;
  pasteBoxRef: React.RefObject<HTMLDivElement | null>;
  setSettingsMessage: (message: string) => void;
  setError: (message: string) => void;
  setIsEditingRoom: (editing: boolean) => void;
  uploadText: (content: string) => Promise<unknown>;
  uploadFiles: (files: FileList | File[]) => Promise<void>;
  lastClipboardWriteSignatureRef: React.RefObject<string>;
};

export function useDesktopClipboard({
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
}: Options) {
  const clipboardOwnerRef = React.useRef(
    `${currentWindowLabel}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  );

  const clipboardCaptureBusyRef = React.useRef(false);

  const syntheticShortcutRef = React.useRef(false);

  const lastClipboardCaptureSignatureRef = React.useRef("");

  React.useEffect(() => {
    if (!desktopMode || !isMiniWindow) return undefined;

    let mounted = true;
    const shortcuts = [openPanelShortcut, copyShortcut, pasteShortcut].filter(
      (shortcut, index, values) => shortcut && values.indexOf(shortcut) === index,
    );
    register(shortcuts, async (event) => {
      if (syntheticShortcutRef.current) return;
      if (shortcutsMatch(event.shortcut, copyShortcut)) {
        if (event.state !== "Released") return;
        await sendSelectedItem();
        return;
      }
      if (shortcutsMatch(event.shortcut, pasteShortcut)) {
        if (event.state !== "Released") return;
        await pasteFirstItem();
        return;
      }
      if (event.state !== "Pressed") return;
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

  return { writeItemToClipboard };
}
