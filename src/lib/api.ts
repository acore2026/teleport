import { proxyChallengeMessage } from "../config";
import type { RoomPayload } from "../types";

export function apiUrl(path: string) {
  return path;
}

export function absoluteItemUrl(downloadUrl: string) {
  if (/^https?:\/\//i.test(downloadUrl)) return downloadUrl;
  return new URL(downloadUrl, window.location.href).href;
}

export class ProxyChallengeError extends Error {
  url: string;

  constructor(url: string) {
    super(proxyChallengeMessage);
    this.name = "ProxyChallengeError";
    this.url = url;
  }
}

export function looksLikeProxyChallenge(text: string) {
  if (!text) return false;
  const source = text.toLowerCase();
  return (
    source.includes("his proxy notification") ||
    source.includes("swg,proxy,netentsec") ||
    source.includes('id="continuebtn"') ||
    source.includes("接受风险并访问") ||
    source.includes("proxyaccess/lst")
  );
}

export async function readJsonPayload(response: Response): Promise<RoomPayload | { error: string }> {
  if (response.status === 403) {
    throw new ProxyChallengeError(response.url);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as RoomPayload | { error: string };
  }

  const text = await response.text().catch(() => "");
  if (looksLikeProxyChallenge(text)) {
    throw new ProxyChallengeError(response.url);
  }

  const detail = text.replace(/\s+/g, " ").trim();
  return {
    error: response.ok
      ? "Server response was not JSON."
      : detail
        ? `Request failed with ${response.status}: ${detail.slice(0, 140)}`
        : `Request failed with ${response.status}.`,
  };
}
