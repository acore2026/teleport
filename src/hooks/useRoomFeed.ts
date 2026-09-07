import React from "react";
import { proxyChallengeMessage } from "../config";
import { apiUrl, readJsonPayload } from "../lib/api";
import type { RoomItem, RoomPayload } from "../types";

type Options = {
  room: string;
  serverUrl: string;
  setItems: React.Dispatch<React.SetStateAction<RoomItem[]>>;
  setError: (message: string) => void;
  handleSyncError: (caught: unknown, fallback: string) => string;
  notifyNewItems: (items: RoomItem[], room: string) => void;
  copyIncomingItems: (items: RoomItem[], room: string) => Promise<void>;
};

export function useRoomFeed({
  room,
  serverUrl,
  setItems,
  setError,
  handleSyncError,
  notifyNewItems,
  copyIncomingItems,
}: Options) {
  const feedStateRef = React.useRef<{
    key: string;
    startedAt: number;
    primed: boolean;
    ids: Set<string>;
  } | null>(null);

  React.useEffect(() => {
    if (!room) return undefined;

    primeRoomFeed(room);
    loadRoom(room).catch((caught) => {
      setError(handleSyncError(caught, "Unable to load room."));
    });
    const events = new EventSource(apiUrl(`/api/rooms/${encodeURIComponent(room)}/events`, serverUrl));
    events.addEventListener("items", (event) => {
      const payload = JSON.parse(event.data) as RoomPayload;
      syncRoomItems(payload.items, room, true);
    });
    events.onerror = () => {
      probeRoomConnection(room).catch((caught) => {
        const message = handleSyncError(caught, "Connection interrupted.");
        if (message !== proxyChallengeMessage) setError(message);
      });
    };

    return () => {
      events.close();
    };
  }, [room, serverUrl]);

  async function loadRoom(nextRoom: string) {
    const response = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(nextRoom)}/items`, serverUrl));
    const payload = await readJsonPayload(response);
    if (!response.ok) throw new Error("error" in payload ? payload.error : "Unable to load room.");
    syncRoomItems((payload as RoomPayload).items, nextRoom, false);
  }

  async function probeRoomConnection(nextRoom: string) {
    const response = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(nextRoom)}/items`, serverUrl), {
      cache: "no-store",
    });
    const payload = await readJsonPayload(response);
    if (!response.ok) throw new Error("error" in payload ? payload.error : "Unable to load room.");
  }

  function feedKeyFor(nextRoom: string) {
    return `${serverUrl || "web"}:${nextRoom}`;
  }

  function primeRoomFeed(nextRoom: string) {
    feedStateRef.current = {
      key: feedKeyFor(nextRoom),
      startedAt: Date.now(),
      primed: false,
      ids: new Set(),
    };
  }

  function syncRoomItems(nextItems: RoomItem[], nextRoom: string, shouldNotify: boolean) {
    const key = feedKeyFor(nextRoom);
    let feedState = feedStateRef.current;
    if (!feedState || feedState.key !== key) {
      feedState = {
        key,
        startedAt: Date.now(),
        primed: false,
        ids: new Set(),
      };
    }

    const nextIds = new Set(nextItems.map((item) => item.id));
    if (!feedState.primed) {
      feedStateRef.current = { ...feedState, primed: true, ids: nextIds };
      setItems(nextItems);
      return;
    }

    const newItems = nextItems.filter(
      (item) => !feedState.ids.has(item.id) && item.createdAt >= feedState.startedAt - 1000,
    );
    feedStateRef.current = { ...feedState, ids: nextIds };
    setItems(nextItems);

    if (shouldNotify && newItems.length) {
      notifyNewItems(newItems, nextRoom);
      copyIncomingItems(newItems, nextRoom).catch(() => undefined);
    }
  }

  return { loadRoom, primeRoomFeed, syncRoomItems };
}
