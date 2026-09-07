import { ExternalLink, LockKeyhole, X } from "lucide-react";

export function ProxyPrompt({
  compact = false,
  onOpen,
  onRetry,
  onDismiss,
}: {
  compact?: boolean;
  onOpen: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={compact ? "proxy-prompt proxy-prompt-compact" : "proxy-prompt"} role="alert">
      <span className="proxy-prompt-icon" aria-hidden="true">
        <LockKeyhole size={compact ? 14 : 16} />
      </span>
      <div>
        <strong>Proxy confirmation required</strong>
        <p>Accept the confirmation page, then retry.</p>
      </div>
      <button type="button" className="proxy-prompt-primary" onClick={onOpen}>
        <ExternalLink size={14} />
        Open
      </button>
      <button type="button" className="proxy-prompt-secondary" onClick={onRetry}>
        Retry
      </button>
      <button type="button" className="proxy-prompt-close" onClick={onDismiss} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}
