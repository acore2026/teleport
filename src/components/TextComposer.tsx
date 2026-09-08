import { Send } from "lucide-react";
import { useRef, useState } from "react";

type TextComposerProps = {
  room: string;
  onSend: (text: string) => Promise<boolean | undefined>;
};

export function TextComposer({ room, onSend }: TextComposerProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const sendingRef = useRef(false);

  async function submit() {
    if (!room || !draft.trim() || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSent(false);
    try {
      if (await onSend(draft)) {
        setDraft("");
        setSent(true);
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <form className="text-composer" onSubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
      <label htmlFor="paste-text">Send text</label>
      <p id="paste-text-help">On your phone, touch and hold the field, then choose Paste.</p>
      <textarea
        id="paste-text"
        aria-describedby="paste-text-help"
        placeholder="Paste or type text here"
        rows={4}
        value={draft}
        readOnly={sending}
        onChange={(event) => {
          setDraft(event.target.value);
          setSent(false);
        }}
      />
      <div className="text-composer-actions">
        <span role="status">{sent ? "Sent to room" : ""}</span>
        <button className="room-primary" type="submit" disabled={!room || !draft.trim() || sending}>
          <Send size={16} />
          {sending ? "Sending…" : "Send text"}
        </button>
      </div>
    </form>
  );
}
