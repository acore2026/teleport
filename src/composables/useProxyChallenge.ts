import { ref } from "vue";
import { proxyChallengeMessage } from "../config";
import { ProxyChallengeError } from "../lib/api";
import type { ProxyChallenge } from "../types";

export function useProxyChallenge() {
  const proxyChallenge = ref<ProxyChallenge | null>(null);

  function openProxyChallenge(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleSyncError(caught: unknown, fallback: string) {
    if (caught instanceof ProxyChallengeError) {
      const candidate = caught.url.trim();
      const url = /^https?:\/\//i.test(candidate)
        ? candidate
        : window.location.href;
      if (proxyChallenge.value?.url !== url)
        proxyChallenge.value = { url, detectedAt: Date.now() };
      return proxyChallengeMessage;
    }
    return caught instanceof Error ? caught.message : fallback;
  }

  return { proxyChallenge, openProxyChallenge, handleSyncError };
}
