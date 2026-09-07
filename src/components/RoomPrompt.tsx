import { HardDriveUpload, Link2, LockKeyhole, Send, X } from "lucide-react";
import { defaultDesktopServerUrl } from "../config";
import type { RecentRoom } from "../types";

export function RoomPrompt({
  room,
  roomInput,
  passwordInput,
  serverInput,
  recentRooms,
  error,
  autoFocus,
  compact,
  showServer,
  onRoomInput,
  onPasswordInput,
  onServerInput,
  onSubmit,
  onCancel,
  onRecentRoom,
}: {
  room: string;
  roomInput: string;
  passwordInput: string;
  serverInput: string;
  recentRooms: RecentRoom[];
  error: string;
  autoFocus?: boolean;
  compact?: boolean;
  showServer?: boolean;
  onRoomInput: (value: string) => void;
  onPasswordInput: (value: string) => void;
  onServerInput: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onCancel?: () => void;
  onRecentRoom: (room: string) => void | Promise<void>;
}) {
  const usableRooms = recentRooms.filter((entry) => entry.room !== room);

  return (
    <div className={compact ? "room-prompt room-prompt-compact" : "room-prompt"}>
      {!compact && (
        <div className="room-prompt-head">
          <div>
            <h2>Switch room</h2>
            <p>Create a new room or jump back to a recent one.</p>
          </div>
          {onCancel && (
            <button className="room-close" type="button" onClick={onCancel} aria-label="Close room switcher">
              <X size={16} />
            </button>
          )}
        </div>
      )}

      <form
        className="room-switch-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onCancel) onCancel();
        }}
      >
        <label>
          <span>
            <Link2 size={14} />
            Room
          </span>
          <input
            autoFocus={autoFocus}
            value={roomInput}
            onChange={(event) => onRoomInput(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Room name"
          />
        </label>

        {showServer && (
          <label>
            <span>
              <HardDriveUpload size={14} />
              Server
            </span>
            <input
              value={serverInput}
              onChange={(event) => onServerInput(event.target.value)}
              placeholder={defaultDesktopServerUrl}
              aria-label="Server URL"
            />
          </label>
        )}

        <label>
          <span>
            <LockKeyhole size={14} />
            Password
          </span>
          <input
            type="password"
            value={passwordInput}
            onChange={(event) => onPasswordInput(event.target.value)}
            placeholder="optional"
            aria-label="Room password"
          />
        </label>

        {error && <p className="room-form-error">{error}</p>}

        <div className="room-actions">
          {onCancel && (
            <button className="room-secondary" type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="room-primary" type="submit">
            <Send size={15} />
            {room ? "Switch" : "Enter room"}
          </button>
        </div>
      </form>

      {usableRooms.length > 0 && (
        <div className="room-recents">
          <p>Recent rooms</p>
          <div>
            {usableRooms.map((entry) => (
              <button key={entry.room} type="button" onClick={() => onRecentRoom(entry.room)}>
                <Link2 size={14} />
                {entry.room}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
