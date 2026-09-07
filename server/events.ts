import type { Response } from "express";
import { payloadFor } from "./rooms.js";
import type { RoomPayload } from "./types.js";

export const channels = new Map<string, Set<Response>>();

export function sendEvent(res: Response, event: string, payload: RoomPayload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function channelFor(room: string) {
  let clients = channels.get(room);
  if (!clients) {
    clients = new Set();
    channels.set(room, clients);
  }
  return clients;
}

export function broadcast(room: string, event = "items") {
  const clients = channels.get(room);
  if (!clients?.size) return;

  const payload = payloadFor(room);
  for (const client of clients) {
    sendEvent(client, event, payload);
  }
}
