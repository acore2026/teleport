import { Boxes } from "lucide-react";
import { maxChunkSizeKb, minChunkSizeKb } from "../config";

type UploadSettingsProps = {
  enabled: boolean;
  chunkSizeKb: number;
  compact?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onChunkSizeChange: (sizeKb: number) => void;
};

export function UploadSettings({
  enabled,
  chunkSizeKb,
  compact = false,
  onEnabledChange,
  onChunkSizeChange,
}: UploadSettingsProps) {
  return (
    <div className={compact ? "chunk-setting chunk-setting-compact" : "chunk-setting"}>
      <label className="chunk-setting-toggle">
        <span className="chunk-setting-icon" aria-hidden="true">
          <Boxes size={16} />
        </span>
        <span className="chunk-setting-copy">
          <strong>Chunk file uploads</strong>
          <small>Send large files in smaller requests</small>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.currentTarget.checked)}
        />
      </label>
      {enabled && (
        <label className="chunk-size-field">
          <span>Chunk size</span>
          <span className="chunk-size-input">
            <input
              type="number"
              min={minChunkSizeKb}
              max={maxChunkSizeKb}
              step={10}
              value={chunkSizeKb}
              aria-label="Upload chunk size in KB"
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isFinite(value)) onChunkSizeChange(value);
              }}
              onBlur={(event) => {
                const value = Math.round(event.currentTarget.valueAsNumber || minChunkSizeKb);
                onChunkSizeChange(Math.min(maxChunkSizeKb, Math.max(minChunkSizeKb, value)));
              }}
            />
            <span>KB</span>
          </span>
        </label>
      )}
    </div>
  );
}
