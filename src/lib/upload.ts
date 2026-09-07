import type { RoomPayload, UploadProgress } from "../types";
import { apiUrl, looksLikeProxyChallenge, ProxyChallengeError } from "./api";

export function uploadFile(
  file: File,
  index: number,
  totalFiles: number,
  options: {
    room: string;
    serverUrl: string;
    desktopMode: boolean;
    onProgress: (progress: UploadProgress) => void;
  },
) {
  const { room, serverUrl, desktopMode, onProgress } = options;
  return new Promise<RoomPayload>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const uploadUrl = apiUrl(`/api/rooms/${encodeURIComponent(room)}/items`, serverUrl);
    const form = new FormData();
    form.append("file", file);

    onProgress({
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
      onProgress({
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
        if (looksLikeProxyChallenge(request.responseText || "")) {
          reject(new ProxyChallengeError(request.responseURL || uploadUrl));
          return;
        }
        reject(new Error("Upload response was invalid."));
        return;
      }

      if (request.status < 200 || request.status >= 300) {
        reject(new Error("error" in payload ? payload.error : `Upload failed for ${file.name}.`));
        return;
      }

      onProgress({
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

    request.onerror = () => {
      reject(desktopMode ? new ProxyChallengeError(uploadUrl) : new Error(`Upload failed for ${file.name}.`));
    };
    request.open("POST", uploadUrl);
    request.send(form);
  });
}
