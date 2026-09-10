import { formatBytes } from "../lib/format";
import type { UploadProgress } from "../types";

export function UploadPrompt({ progress }: { progress: UploadProgress }) {
  return (
    <div className="upload-prompt" aria-live="polite">
      <div className="upload-prompt-head">
        <strong>{progress.fileName}</strong>
        <span>
          {progress.index}/{progress.totalFiles}
        </span>
      </div>
      <div className="progress-track">
        <div style={{ width: `${progress.percent}%` }} />
      </div>
      <p>
        {progress.processing
          ? "Processing..."
          : `${progress.percent}% · ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}${
              progress.totalChunks && progress.totalChunks > 1
                ? ` · Chunk ${progress.chunkIndex} of ${progress.totalChunks}`
                : ""
            }`}
      </p>
    </div>
  );
}
