import { Check, Copy, Download, Trash2 } from "lucide-react";
import { fileIconFor, isPreviewableImage } from "../lib/files";
import { formatBytes, timeAgo, timeLeft } from "../lib/format";
import type { RoomItem } from "../types";

export function ItemCard({
  item,
  onCopy,
  onDelete,
  onDownload,
  onPreview,
  getItemUrl,
  isCopied,
}: {
  item: RoomItem;
  isCopied: boolean;
  onCopy: (item: RoomItem) => void;
  onDelete: (item: RoomItem) => void;
  onDownload: (item: RoomItem) => void;
  onPreview: (item: Extract<RoomItem, { type: "file" }>) => void;
  getItemUrl: (downloadUrl: string) => string;
}) {
  const title = item.type === "file" ? item.fileName : "Text paste";
  const icon = fileIconFor(item);
  const Icon = icon.Icon;
  const isImage = isPreviewableImage(item);
  const meta =
    item.type === "file"
      ? [formatBytes(item.fileSize), icon.label, timeLeft(item.expiresAt)]
      : [timeAgo(item.createdAt), timeLeft(item.expiresAt)];

  return (
    <li className={isCopied ? "item-card item-card-copied" : "item-card"}>
      {isImage && item.type === "file" ? (
        <button
          className="item-thumb"
          onClick={() => onPreview(item)}
          aria-label={`Preview ${item.fileName}`}
        >
          <img src={getItemUrl(item.downloadUrl)} alt="" loading="lazy" />
        </button>
      ) : (
        <div className={`item-icon item-icon-${icon.tone}`}>
          <Icon size={20} />
        </div>
      )}
      <div className="item-body">
        <div className="item-meta">
          <h4>{title}</h4>
          {meta.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </div>
        {item.type === "text" && <pre>{item.textContent}</pre>}
      </div>
      <div className="item-actions">
        <button
          className={isCopied ? "copy-action copy-action-done" : "copy-action"}
          onClick={() => onCopy(item)}
        >
          {isCopied ? <Check size={15} /> : <Copy size={15} />}
          <span>{isCopied ? "Copied" : item.type === "file" ? "Copy link" : "Copy"}</span>
        </button>
        {item.type === "file" && (
          <button className="primary-action" onClick={() => onDownload(item)}>
            <Download size={15} />
            Download
          </button>
        )}
        <button className="danger" onClick={() => onDelete(item)}>
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}

export function MiniItemCard({
  item,
  onCopy,
  onDelete,
  onDownload,
  onPreview,
  getItemUrl,
  isCopied,
}: {
  item: RoomItem;
  isCopied: boolean;
  onCopy: (item: RoomItem) => void;
  onDelete: (item: RoomItem) => void;
  onDownload: (item: RoomItem) => void;
  onPreview: (item: Extract<RoomItem, { type: "file" }>) => void;
  getItemUrl: (downloadUrl: string) => string;
}) {
  const icon = fileIconFor(item);
  const Icon = icon.Icon;
  const isImage = isPreviewableImage(item);
  const title = item.type === "file" ? item.fileName : "Text paste";
  const meta =
    item.type === "file" ? `${formatBytes(item.fileSize)} · ${icon.label}` : timeAgo(item.createdAt);
  const primary = item.type === "file" ? onDownload : onCopy;

  return (
    <li className={isCopied ? "mini-item mini-item-copied" : "mini-item"}>
      <button className="mini-item-main" onClick={() => primary(item)}>
        {isImage && item.type === "file" ? (
          <span
            className="mini-thumb"
            onClick={(event) => {
              event.stopPropagation();
              onPreview(item);
            }}
          >
            <img src={getItemUrl(item.downloadUrl)} alt="" loading="lazy" />
          </span>
        ) : (
          <span className={`mini-file-icon item-icon-${icon.tone}`}>
            <Icon size={17} />
          </span>
        )}
        <span className="mini-item-copy">
          <strong>{title}</strong>
          <small>
            {meta} · {timeLeft(item.expiresAt)}
          </small>
          {item.type === "text" && <em>{item.textContent || "Locked text paste"}</em>}
        </span>
      </button>
      <div className="mini-item-actions">
        {item.type === "file" ? (
          <>
            <button
              onClick={() => onDownload(item)}
              title="Download"
              aria-label={`Download ${item.fileName}`}
            >
              <Download size={14} />
            </button>
            <button
              onClick={() => onCopy(item)}
              title="Copy link"
              aria-label={`Copy link for ${item.fileName}`}
            >
              {isCopied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </>
        ) : (
          <button onClick={() => onCopy(item)} title="Copy" aria-label="Copy text paste">
            {isCopied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
        <button
          className="mini-danger"
          onClick={() => onDelete(item)}
          title="Delete"
          aria-label="Delete item"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}
