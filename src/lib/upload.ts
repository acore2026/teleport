import type { RoomPayload, UploadProgress } from "../types";
import { apiUrl, looksLikeProxyChallenge, ProxyChallengeError } from "./api";

type UploadOptions = {
  room: string;
  serverUrl: string;
  desktopMode: boolean;
  chunkSizeBytes: number | null;
  onProgress: (progress: UploadProgress) => void;
};

type UploadResponse = {
  status: number;
  payload: RoomPayload | { error: string; complete?: boolean };
};

function createUploadId() {
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto?.randomUUID === "function") return browserCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof browserCrypto?.getRandomValues === "function") {
    browserCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex
    .slice(8, 10)
    .join("")}-${hex.slice(10).join("")}`;
}

function sendUpload(url: string, form: FormData, desktopMode: boolean, onProgress: (loaded: number) => void) {
  return new Promise<UploadResponse>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => {
      try {
        resolve({ status: request.status, payload: JSON.parse(request.responseText || "{}") });
      } catch {
        if (looksLikeProxyChallenge(request.responseText || "")) {
          reject(new ProxyChallengeError(request.responseURL || url));
          return;
        }
        reject(new Error("Upload response was invalid."));
      }
    };
    request.onerror = () => {
      reject(desktopMode ? new ProxyChallengeError(url) : new Error("Upload failed."));
    };
    request.open("POST", url);
    request.send(form);
  });
}

function reportProgress(
  file: File,
  index: number,
  totalFiles: number,
  onProgress: UploadOptions["onProgress"],
  loaded: number,
  chunkIndex?: number,
  totalChunks?: number,
  processing = false,
) {
  const safeLoaded = Math.min(file.size, loaded);
  onProgress({
    fileName: file.name,
    index,
    totalFiles,
    percent: processing ? 100 : Math.min(99, file.size ? Math.round((safeLoaded / file.size) * 100) : 0),
    loaded: safeLoaded,
    total: file.size,
    processing,
    chunkIndex,
    totalChunks,
  });
}

async function uploadWholeFile(file: File, index: number, totalFiles: number, options: UploadOptions) {
  const uploadUrl = apiUrl(`/api/rooms/${encodeURIComponent(options.room)}/items`, options.serverUrl);
  const form = new FormData();
  form.append("file", file);
  reportProgress(file, index, totalFiles, options.onProgress, 0);
  const response = await sendUpload(uploadUrl, form, options.desktopMode, (loaded) => {
    reportProgress(file, index, totalFiles, options.onProgress, loaded);
  });
  if (response.status < 200 || response.status >= 300 || "error" in response.payload) {
    throw new Error("error" in response.payload ? response.payload.error : `Upload failed for ${file.name}.`);
  }
  reportProgress(file, index, totalFiles, options.onProgress, file.size, undefined, undefined, true);
  return response.payload;
}

async function uploadInChunks(file: File, index: number, totalFiles: number, options: UploadOptions) {
  const chunkSize = options.chunkSizeBytes!;
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
  const uploadId = createUploadId();
  const uploadUrl = apiUrl(
    `/api/rooms/${encodeURIComponent(options.room)}/uploads/${encodeURIComponent(uploadId)}/chunks`,
    options.serverUrl,
  );
  let finalPayload: RoomPayload | null = null;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const offset = chunkIndex * chunkSize;
    const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
    const form = new FormData();
    form.append("chunk", chunk, `${file.name}.part`);
    form.append("fileName", file.name);
    form.append("mimeType", file.type || "application/octet-stream");
    form.append("fileSize", String(file.size));
    form.append("chunkSize", String(chunkSize));
    form.append("chunkIndex", String(chunkIndex));
    form.append("totalChunks", String(totalChunks));
    reportProgress(file, index, totalFiles, options.onProgress, offset, chunkIndex + 1, totalChunks);

    const response = await sendUpload(uploadUrl, form, options.desktopMode, (loaded) => {
      reportProgress(
        file,
        index,
        totalFiles,
        options.onProgress,
        offset + Math.min(chunk.size, loaded),
        chunkIndex + 1,
        totalChunks,
      );
    });
    if (response.status < 200 || response.status >= 300 || "error" in response.payload) {
      throw new Error(
        "error" in response.payload ? response.payload.error : `Upload failed for ${file.name}.`,
      );
    }
    if (response.status === 201) finalPayload = response.payload as RoomPayload;
  }

  if (!finalPayload) throw new Error(`Upload did not finish for ${file.name}.`);
  reportProgress(file, index, totalFiles, options.onProgress, file.size, totalChunks, totalChunks, true);
  return finalPayload;
}

export function uploadFile(file: File, index: number, totalFiles: number, options: UploadOptions) {
  return options.chunkSizeBytes
    ? uploadInChunks(file, index, totalFiles, options)
    : uploadWholeFile(file, index, totalFiles, options);
}
