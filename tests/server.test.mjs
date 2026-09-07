import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

test("room API preserves items, broadcasts changes, and expires stored files", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "teleport-test-"));
  process.env.DATA_DIR = dataDir;
  const { app } = await import("../dist-server/app.js");
  const { pruneExpired } = await import("../dist-server/cleanup.js");
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const roomUrl = `${base}/api/rooms/refactor-test`;
  const database = new DatabaseSync(join(dataDir, "pasteroom.sqlite"));
  const streamController = new AbortController();

  async function post(body) {
    const response = await fetch(`${roomUrl}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 201);
    return response.json();
  }

  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ttlMs, 24 * 60 * 60 * 1000);
    assert.equal((await fetch(`${base}/api/rooms/invalid%20room/items`)).status, 400);

    const events = await fetch(`${roomUrl}/events`, { signal: streamController.signal });
    assert.match(events.headers.get("content-type"), /text\/event-stream/);
    const reader = events.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    async function nextEvent() {
      while (!pending.includes("\n\n")) {
        const { value, done } = await reader.read();
        assert.equal(done, false);
        pending += decoder.decode(value, { stream: true });
      }
      const end = pending.indexOf("\n\n");
      const event = pending.slice(0, end);
      pending = pending.slice(end + 2);
      assert.match(event, /^event: items\n/);
      return JSON.parse(event.split("\ndata: ")[1]);
    }
    assert.deepEqual((await nextEvent()).items, []);

    const textPayload = await post({ content: "hello refactor  \n" });
    const textItem = textPayload.items[0];
    assert.equal(textItem.textContent, "hello refactor");
    assert.equal(textItem.expiresAt - textItem.createdAt, health.ttlMs);
    assert.equal((await nextEvent()).items[0].id, textItem.id);

    const cryptoMeta = { v: 2, cipher: "AES-CBC-HMAC-SHA256", salt: "test-salt" };
    const sealed = await post({ content: "opaque-ciphertext", encrypted: true, cryptoMeta });
    assert.deepEqual(sealed.items.find((item) => item.encrypted).cryptoMeta, cryptoMeta);
    await nextEvent();
    const compressed = await post({ content: "opaque-base64", textEncoding: "gzip-base64" });
    assert.equal(compressed.items.find((item) => item.textEncoding).textEncoding, "gzip-base64");
    await nextEvent();

    const form = new FormData();
    form.append("file", new Blob(["file contents"], { type: "text/plain" }), "sample.txt");
    const upload = await fetch(`${roomUrl}/items`, { method: "POST", body: form });
    assert.equal(upload.status, 201);
    const fileItem = (await upload.json()).items.find((item) => item.type === "file");
    assert.equal(fileItem.fileName, "sample.txt");
    assert.equal(await (await fetch(`${base}${fileItem.downloadUrl}`)).text(), "file contents");
    await nextEvent();

    const removed = await fetch(`${roomUrl}/items/${textItem.id}`, { method: "DELETE" });
    assert.equal(
      (await removed.json()).items.some((item) => item.id === textItem.id),
      false,
    );
    assert.equal(
      (await nextEvent()).items.some((item) => item.id === textItem.id),
      false,
    );

    const { file_path: storedPath } = database
      .prepare("SELECT file_path FROM room_items WHERE id = ?")
      .get(fileItem.id);
    assert.equal(existsSync(resolve(storedPath)), true);
    database.prepare("UPDATE room_items SET expires_at = ?").run(Date.now() - 1);
    assert.equal((await fetch(`${base}${fileItem.downloadUrl}`)).status, 404);
    pruneExpired();
    assert.deepEqual((await nextEvent()).items, []);
    assert.equal(existsSync(resolve(storedPath)), false);
    assert.deepEqual((await (await fetch(`${roomUrl}/items`)).json()).items, []);
    assert.equal(database.prepare("SELECT count(*) AS count FROM room_items").get().count, 0);
  } finally {
    streamController.abort();
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
    database.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
