import { proxyChallengeMessage } from "../config";
import type { RoomPayload } from "../types";

export function apiUrl(path: string, serverUrl: string) {
  return serverUrl ? `${serverUrl}${path}` : path;
}

export function absoluteItemUrl(downloadUrl: string, serverUrl: string) {
  if (/^https?:\/\//i.test(downloadUrl)) return downloadUrl;
  return serverUrl ? `${serverUrl}${downloadUrl}` : new URL(downloadUrl, window.location.href).href;
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

export function looksLikeBlockedRedirect(caught: unknown) {
  if (caught instanceof TypeError) return true;
  if (!(caught instanceof Error)) return false;
  const message = caught.message.toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("networkerror") ||
    message.includes("err_failed") ||
    message.includes("cors")
  );
}

export async function readJsonPayload(response: Response): Promise<RoomPayload | { error: string }> {
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
