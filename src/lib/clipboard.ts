import { Image } from "@tauri-apps/api/image";
import {
  clear as clearClipboard,
  readImage as readClipboardImage,
  readText as readClipboardText,
  writeImage as writeClipboardImage,
  writeText as writeClipboardText,
} from "@tauri-apps/plugin-clipboard-manager";
import { clipboardLeaseKey, clipboardWriteSignatureKey } from "../config";
import type { ClipboardSnapshot } from "../types";
import { isDesktopRuntime } from "./settings";

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
  return new File(
    [file],
    `${prefix}-${stamp}${index ? `-${index + 1}` : ""}.${extensionForMime(file.type)}`,
    {
      type: file.type || "application/octet-stream",
      lastModified: Date.now(),
    },
  );
}

export function filesFromClipboard(data: DataTransfer) {
  const files = Array.from(data.files || []);
  if (files.length) return files.map(namedClipboardFile);

  return Array.from(data.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .map(namedClipboardFile);
}

export function clipboardTextSignature(text: string) {
  return `text:${text.length}:${text}`;
}

export function clipboardImageSignature(width: number, height: number, rgba: Uint8Array) {
  let sample = 0;
  const stride = Math.max(1, Math.floor(rgba.length / 128));
  for (let i = 0; i < rgba.length; i += stride) {
    sample = (sample * 33 + rgba[i]) >>> 0;
  }
  return `image:${width}x${height}:${rgba.length}:${sample}`;
}

export function stampFileName(prefix: string, extension: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${stamp}.${extension}`;
}

export function tryClaimClipboardCaptureLease(owner: string) {
  const now = Date.now();
  try {
    const current = JSON.parse(localStorage.getItem(clipboardLeaseKey) || "null") as {
      owner?: string;
      expiresAt?: number;
    } | null;
    if (current?.owner && current.owner !== owner && Number(current.expiresAt) > now) return false;

    const next = JSON.stringify({ owner, expiresAt: now + 5000 });
    localStorage.setItem(clipboardLeaseKey, next);
    return localStorage.getItem(clipboardLeaseKey) === next;
  } catch {
    return true;
  }
}

export function rememberClipboardWriteSignature(signature: string) {
  try {
    localStorage.setItem(clipboardWriteSignatureKey, signature);
  } catch {
    // The in-memory signature remains the fallback.
  }
}

export function wasClipboardWrittenByTeleport(signature: string, currentWindowSignature: string) {
  if (signature === currentWindowSignature) return true;
  try {
    return localStorage.getItem(clipboardWriteSignatureKey) === signature;
  } catch {
    return false;
  }
}

export async function imageToPngBlob(image: Image) {
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

export async function readClipboardSnapshot(): Promise<ClipboardSnapshot> {
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

export async function restoreClipboardSnapshot(snapshot: ClipboardSnapshot) {
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

export async function blobToPngBytes(blob: Blob) {
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

export async function copyText(text: string) {
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
