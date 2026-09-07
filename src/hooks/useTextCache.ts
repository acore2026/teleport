import React from "react";
import { cryptoIterations } from "../config";
import { readableItem, readCachedText, rememberText } from "../lib/room-storage";
import { deriveKeys, openTextItem, roomSalt } from "../lib/text-codec";
import type { RoomItem } from "../types";

type Options = {
  items: RoomItem[];
  room: string;
  roomPassword: string;
};

export function useTextCache({ items, room, roomPassword }: Options) {
  const [cacheVersion, setCacheVersion] = React.useState(0);

  const visibleItems = React.useMemo(
    () => items.map((item) => readableItem(item, room)),
    [items, room, cacheVersion],
  );

  React.useEffect(() => {
    if (!roomPassword) return undefined;
    const timer = window.setTimeout(() => {
      deriveKeys(room, roomPassword, roomSalt(room), cryptoIterations);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [room, roomPassword]);

  React.useEffect(() => {
    const pending = items.filter(
      (item): item is Extract<RoomItem, { type: "text" }> =>
        item.type === "text" &&
        Boolean((item.encrypted && item.cryptoMeta && roomPassword) || item.textEncoding) &&
        readCachedText(room, item) === null,
    );
    if (!pending.length) return undefined;

    let cancelled = false;
    let timer = 0;
    let index = 0;

    const decryptNext = () => {
      if (cancelled) return;
      const item = pending[index];
      index += 1;
      if (!item) return;

      timer = window.setTimeout(() => {
        void (async () => {
          try {
            const text = await openTextItem(item, room, roomPassword);
            rememberText(room, item, text);
            setCacheVersion((value) => value + 1);
          } catch {
            // Leave the item blank when the local password does not match.
          }
          decryptNext();
        })();
      }, 20);
    };

    timer = window.setTimeout(decryptNext, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [items, room, roomPassword]);

  return { visibleItems, setCacheVersion };
}
