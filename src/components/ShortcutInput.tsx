import { displayShortcut, shortcutFromKeyboardEvent } from "../lib/shortcuts";

export function ShortcutInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      className="shortcut-input"
      readOnly
      value={displayShortcut(value)}
      placeholder="Click, then press keys"
      title="Click, then press a key combination"
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const input = event.currentTarget;
        if (event.key === "Escape") {
          input.blur();
          return;
        }
        const nextShortcut = shortcutFromKeyboardEvent(event);
        if (nextShortcut) {
          onChange(nextShortcut);
          window.setTimeout(() => input.select(), 0);
        }
      }}
    />
  );
}
