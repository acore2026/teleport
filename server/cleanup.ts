import { deleteExpired, selectExpiredItems } from "./database.js";
import { broadcast } from "./events.js";
import { removeStoredFile } from "./files.js";
import type { ExpiredItemRow } from "./types.js";

export function pruneExpired() {
  const now = Date.now();
  const expired = selectExpiredItems.all(now) as ExpiredItemRow[];
  if (!expired.length) return;

  const rooms = new Set(expired.map((item) => item.room));
  for (const item of expired) removeStoredFile(item.filePath);
  deleteExpired.run(now);
  for (const room of rooms) broadcast(room, "items");
}
