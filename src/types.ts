export type RoomItem =
  | {
      id: string;
      room: string;
      type: "text";
      textContent: string;
      textEncoding?: "gzip-base64" | null;
      bytes: number;
      createdAt: number;
      expiresAt: number;
      pinned: boolean;
      hash: string;
      encrypted?: boolean;
      cryptoMeta?: CryptoEnvelope | null;
    }
  | {
      id: string;
      room: string;
      type: "file";
      fileName: string;
      mimeType: string;
      fileSize: number;
      downloadUrl: string;
      createdAt: number;
      expiresAt: number;
      pinned: boolean;
      hash: string;
      encrypted?: boolean;
      cryptoMeta?: CryptoEnvelope | null;
    };

export type RoomPayload = {
  room: string;
  items: RoomItem[];
  ttlMs: number;
  maxTextBytes: number;
  maxFileBytes: number;
};

export type UploadProgress = {
  fileName: string;
  index: number;
  totalFiles: number;
  percent: number;
  loaded: number;
  total: number;
  processing: boolean;
  chunkIndex?: number;
  totalChunks?: number;
};

export type ProxyChallenge = {
  url: string;
  detectedAt: number;
};

export type RecentRoom = {
  room: string;
  at: number;
};

export type NewItemNotice = {
  id: string;
  title: string;
  detail: string;
};

export type CryptoEnvelope = {
  v: 1 | 2;
  cipher: "AES-CBC-HMAC-SHA256";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  mac: string;
  data?: string;
  compression?: "gzip";
};
