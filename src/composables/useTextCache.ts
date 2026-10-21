import { computed, ref, watch, type Ref } from "vue";
import { cryptoIterations } from "../config";
import {
  readableItem,
  readCachedText,
  rememberText,
} from "../lib/room-storage";
import { deriveKeys, openTextItem, roomSalt } from "../lib/text-codec";
import type { RoomItem } from "../types";

type Options = {
  items: Ref<RoomItem[]>;
  room: Ref<string>;
  roomPassword: Ref<string>;
};

export function useTextCache({ items, room, roomPassword }: Options) {
  const cacheVersion = ref(0);
  const visibleItems = computed(() => {
    void cacheVersion.value;
    return items.value.map((item) => readableItem(item, room.value));
  });

  watch(
    [room, roomPassword],
    ([nextRoom, password], _, onCleanup) => {
      if (!password) return;
      const timer = window.setTimeout(() => {
        deriveKeys(nextRoom, password, roomSalt(nextRoom), cryptoIterations);
      }, 80);
      onCleanup(() => window.clearTimeout(timer));
    },
    { immediate: true },
  );

  watch(
    [items, room, roomPassword],
    ([nextItems, nextRoom, password], _, onCleanup) => {
      const pending = nextItems.filter(
        (item): item is Extract<RoomItem, { type: "text" }> =>
          item.type === "text" &&
          Boolean(
            (item.encrypted && item.cryptoMeta && password) ||
              item.textEncoding,
          ) &&
          readCachedText(nextRoom, item) === null,
      );
      let cancelled = false;
      let timer = 0;
      let index = 0;
      const decryptNext = () => {
        if (cancelled) return;
        const item = pending[index++];
        if (!item) return;
        timer = window.setTimeout(async () => {
          try {
            const text = await openTextItem(item, nextRoom, password);
            if (cancelled) return;
            rememberText(nextRoom, item, text);
            cacheVersion.value += 1;
          } catch {
            // Keep encrypted text hidden when the local password does not match.
          }
          decryptNext();
        }, 20);
      };
      if (pending.length) timer = window.setTimeout(decryptNext, 120);
      onCleanup(() => {
        cancelled = true;
        window.clearTimeout(timer);
      });
    },
    { immediate: true },
  );

  function invalidateTextCache() {
    cacheVersion.value += 1;
  }

  return { visibleItems, invalidateTextCache };
}
