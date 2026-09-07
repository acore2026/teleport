import { invoke } from "@tauri-apps/api/core";
import React from "react";
import { proxyChallengeMessage } from "../config";
import { looksLikeBlockedRedirect, ProxyChallengeError } from "../lib/api";
import type { ProxyChallenge } from "../types";

type Options = {
  desktopMode: boolean;
  serverUrl: string;
};

export function useProxyChallenge({ desktopMode, serverUrl }: Options) {
  const [proxyChallenge, setProxyChallenge] = React.useState<ProxyChallenge | null>(null);

  const proxyOpenRef = React.useRef<{ url: string; at: number } | null>(null);

  function challengeUrl(candidateUrl?: string) {
    const candidate = candidateUrl?.trim();
    if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
    if (serverUrl) return serverUrl;
    return window.location.href;
  }

  function openProxyChallenge(url: string, force = false) {
    const lastOpen = proxyOpenRef.current;
    if (!force && lastOpen?.url === url && Date.now() - lastOpen.at < 8000) return;
    proxyOpenRef.current = { url, at: Date.now() };

    if (desktopMode) {
      invoke("open_proxy_confirmation", { url }).catch(() => {
        window.open(url, "_blank", "noopener,noreferrer");
      });
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  function registerProxyChallenge(caught: ProxyChallengeError) {
    const url = challengeUrl(caught.url);
    setProxyChallenge((current) => (current?.url === url ? current : { url, detectedAt: Date.now() }));
    if (desktopMode) openProxyChallenge(url);
  }

  function handleSyncError(caught: unknown, fallback: string) {
    if (caught instanceof ProxyChallengeError) {
      registerProxyChallenge(caught);
      return proxyChallengeMessage;
    }
    if (desktopMode && serverUrl && looksLikeBlockedRedirect(caught)) {
      registerProxyChallenge(new ProxyChallengeError(serverUrl));
      return proxyChallengeMessage;
    }
    return caught instanceof Error ? caught.message : fallback;
  }

  return { proxyChallenge, setProxyChallenge, openProxyChallenge, handleSyncError };
}
