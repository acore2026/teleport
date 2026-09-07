import CryptoJS from "crypto-js";
import { cryptoIterations, textCompressionThresholdBytes } from "../config";
import type { CryptoEnvelope, RoomItem } from "../types";

const keyCache = new Map<string, { encKey: CryptoJS.lib.WordArray; macKey: CryptoJS.lib.WordArray }>();

export function roomSalt(room: string) {
  return CryptoJS.SHA256(`teleport:${room}`).toString(CryptoJS.enc.Base64);
}

export function deriveKeys(room: string, password: string, salt: string, iterations: number) {
  const cacheKey = `${room}:${password}:${salt}:${iterations}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  const material = CryptoJS.PBKDF2(`${room}:${password}`, CryptoJS.enc.Base64.parse(salt), {
    keySize: 512 / 32,
    iterations,
    hasher: CryptoJS.algo.SHA256,
  });
  const keys = {
    encKey: CryptoJS.lib.WordArray.create(material.words.slice(0, 8), 32),
    macKey: CryptoJS.lib.WordArray.create(material.words.slice(8, 16), 32),
  };
  keyCache.set(cacheKey, keys);
  return keys;
}

export function stripData(envelope: CryptoEnvelope): CryptoEnvelope {
  const { data, ...rest } = envelope;
  return rest;
}

function wordArrayFromBytes(bytes: Uint8Array) {
  const words: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >>> 2] |= bytes[index] << (24 - (index % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

function bytesFromWordArray(wordArray: CryptoJS.lib.WordArray) {
  const bytes = new Uint8Array(wordArray.sigBytes);
  for (let index = 0; index < wordArray.sigBytes; index += 1) {
    bytes[index] = (wordArray.words[index >>> 2] >>> (24 - (index % 4) * 8)) & 0xff;
  }
  return bytes;
}

export function base64FromBytes(bytes: Uint8Array) {
  return CryptoJS.enc.Base64.stringify(wordArrayFromBytes(bytes));
}

function bytesFromBase64(value: string) {
  return bytesFromWordArray(CryptoJS.enc.Base64.parse(value));
}

async function streamToBytes(stream: ReadableStream<Uint8Array>) {
  const response = new Response(stream);
  return new Uint8Array(await response.arrayBuffer());
}

async function gzipBytes(bytes: Uint8Array) {
  if (!("CompressionStream" in window)) return null;
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new CompressionStream("gzip"));
  return streamToBytes(stream);
}

async function gunzipBytes(bytes: Uint8Array) {
  if (!("DecompressionStream" in window))
    throw new Error("Compressed text is not supported in this browser.");
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream("gzip"));
  return streamToBytes(stream);
}

export async function maybeCompressText(text: string) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length < textCompressionThresholdBytes) {
    return { bytes, compressed: false };
  }

  const compressed = await gzipBytes(bytes).catch(() => null);
  if (!compressed || compressed.length >= bytes.length * 0.95) {
    return { bytes, compressed: false };
  }

  return { bytes: compressed, compressed: true };
}

async function openCompressedText(data: string) {
  const bytes = await gunzipBytes(bytesFromBase64(data));
  return new TextDecoder().decode(bytes);
}

function sealWordArray(
  payload: CryptoJS.lib.WordArray,
  room: string,
  password: string,
  options: { compression?: "gzip" } = {},
): CryptoEnvelope {
  const salt = roomSalt(room);
  const iv = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Base64);
  const keys = deriveKeys(room, password, salt, cryptoIterations);
  const encrypted = CryptoJS.AES.encrypt(payload, keys.encKey, {
    iv: CryptoJS.enc.Base64.parse(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const data = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  const mac = CryptoJS.HmacSHA256(`${salt}.${iv}.${data}`, keys.macKey).toString(CryptoJS.enc.Base64);
  return {
    v: 2,
    cipher: "AES-CBC-HMAC-SHA256",
    kdf: "PBKDF2-SHA256",
    iterations: cryptoIterations,
    salt,
    iv,
    mac,
    data,
    compression: options.compression,
  };
}

function openWordArray(envelope: CryptoEnvelope, data: string, room: string, password: string) {
  const keys = deriveKeys(room, password, envelope.salt, envelope.iterations || cryptoIterations);
  const mac = CryptoJS.HmacSHA256(`${envelope.salt}.${envelope.iv}.${data}`, keys.macKey).toString(
    CryptoJS.enc.Base64,
  );
  if (mac !== envelope.mac) throw new Error("Unable to open item.");
  return CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(data) }),
    keys.encKey,
    {
      iv: CryptoJS.enc.Base64.parse(envelope.iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    },
  );
}

export async function sealPreparedText(
  prepared: { bytes: Uint8Array; compressed: boolean },
  room: string,
  password: string,
) {
  return sealWordArray(wordArrayFromBytes(prepared.bytes), room, password, {
    compression: prepared.compressed ? "gzip" : undefined,
  });
}

async function openSealedText(envelope: CryptoEnvelope, data: string, room: string, password: string) {
  const opened = openWordArray(envelope, data, room, password);
  if (envelope.compression === "gzip") {
    return new TextDecoder().decode(await gunzipBytes(bytesFromWordArray(opened)));
  }
  return CryptoJS.enc.Utf8.stringify(opened);
}

export async function openTextItem(
  item: Extract<RoomItem, { type: "text" }>,
  room: string,
  password: string,
) {
  if (item.encrypted && item.cryptoMeta) {
    return openSealedText(item.cryptoMeta, item.textContent, room, password);
  }
  if (item.textEncoding === "gzip-base64") {
    return openCompressedText(item.textContent);
  }
  return item.textContent;
}
