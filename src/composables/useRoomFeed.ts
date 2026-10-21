import { watch, type Ref } from "vue";
import { proxyChallengeMessage } from "../config";
import { apiUrl, readJsonPayload } from "../lib/api";
import type { RoomItem, RoomPayload } from "../types";

type Options = {
  room: Ref<string>;
  items: Ref<RoomItem[]>;
  error: Ref<string>;
  handleSyncError: (caught: unknown, fallback: string) => string;
  notifyNewItems: (items: RoomItem[], room: string) => void;
};

export function useRoomFeed({
  room,
  items,
  error,
  handleSyncError,
  notifyNewItems,
}: Options) {
  let feedState: {
    room: string;
    startedAt: number;
    primed: boolean;
    ids: Set<string>;
  } | null = null;

  watch(
    room,
    (nextRoom, _, onCleanup) => {
      if (!nextRoom) return;
      const controller = new AbortController();
      primeRoomFeed(nextRoom);
      items.value = [];
      loadRoom(nextRoom, controller.signal).catch((caught) => {
        if (!controller.signal.aborted)
          error.value = handleSyncError(caught, "Unable to load room.");
      });
      const events = new EventSource(
        apiUrl("/api/rooms/" + encodeURIComponent(nextRoom) + "/events"),
      );
      events.addEventListener("items", (event) => {
        if (controller.signal.aborted) return;
        try {
          const payload = JSON.parse(event.data) as RoomPayload;
          syncRoomItems(payload.items, nextRoom, true);
        } catch (caught) {
          error.value = handleSyncError(caught, "Invalid room update.");
        }
      });
      events.onerror = () => {
        probeRoomConnection(nextRoom, controller.signal).catch((caught) => {
          if (controller.signal.aborted) return;
          const message = handleSyncError(caught, "Connection interrupted.");
          if (message !== proxyChallengeMessage) error.value = message;
        });
      };
      onCleanup(() => {
        controller.abort();
        events.close();
      });
    },
    { immediate: true },
  );

  async function fetchRoom(nextRoom: string, signal?: AbortSignal) {
    const response = await fetch(
      apiUrl("/api/rooms/" + encodeURIComponent(nextRoom) + "/items"),
      {
        cache: "no-store",
        signal,
      },
    );
    const payload = await readJsonPayload(response);
    if (!response.ok || "error" in payload) {
      throw new Error(
        "error" in payload ? payload.error : "Unable to load room.",
      );
    }
    return payload;
  }

  async function loadRoom(nextRoom: string, signal?: AbortSignal) {
    const payload = await fetchRoom(nextRoom, signal);
    if (!signal?.aborted) syncRoomItems(payload.items, nextRoom, false);
  }

  async function probeRoomConnection(nextRoom: string, signal?: AbortSignal) {
    await fetchRoom(nextRoom, signal);
  }

  function primeRoomFeed(nextRoom: string) {
    feedState = {
      room: nextRoom,
      startedAt: Date.now(),
      primed: false,
      ids: new Set(),
    };
  }

  function syncRoomItems(
    nextItems: RoomItem[],
    nextRoom: string,
    shouldNotify: boolean,
  ) {
    if (room.value !== nextRoom) return;
    if (!feedState || feedState.room !== nextRoom) primeRoomFeed(nextRoom);
    const current = feedState!;
    const newItems = current.primed
      ? nextItems.filter(
          (item) =>
            !current.ids.has(item.id) &&
            item.createdAt >= current.startedAt - 1000,
        )
      : [];
    feedState = {
      ...current,
      primed: true,
      ids: new Set(nextItems.map((item) => item.id)),
    };
    items.value = nextItems;
    if (shouldNotify && newItems.length) notifyNewItems(newItems, nextRoom);
  }

  return { loadRoom, primeRoomFeed, syncRoomItems };
}
