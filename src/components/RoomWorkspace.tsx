import {
  Check,
  ChevronDown,
  Clipboard,
  FileCode2,
  FolderUp,
  HardDriveUpload,
  Keyboard,
  Link2,
  Plus,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import type { TeleportModel } from "../hooks/useTeleport";
import { absoluteItemUrl } from "../lib/api";
import { ItemCard } from "./ItemCard";
import { ProxyPrompt } from "./ProxyPrompt";
import { RoomPrompt } from "./RoomPrompt";
import { TextComposer } from "./TextComposer";
import { UploadPrompt } from "./UploadPrompt";
import { UploadSettings } from "./UploadSettings";

export function RoomWorkspace({ model }: { model: TeleportModel }) {
  const {
    desktopMode,
    roomInput,
    setRoomInput,
    room,
    serverInput,
    setServerInput,
    serverUrl,
    passwordInput,
    setPasswordInput,
    roomPassword,
    isEditingRoom,
    setIsEditingRoom,
    recentRooms,
    error,
    isDragging,
    setIsDragging,
    uploadProgress,
    chunkUploadsEnabled,
    setChunkUploadsEnabled,
    chunkSizeKb,
    setChunkSizeKb,
    copiedItemId,
    newItemNotice,
    expandedImage,
    setExpandedImage,
    proxyChallenge,
    setProxyChallenge,
    pasteBoxRef,
    visibleItems,
    openProxyChallenge,
    retryProxyConnection,
    enterRoom,
    enterRecentRoom,
    uploadText,
    handlePaste,
    handleDragOver,
    handleDrop,
    deleteItem,
    togglePin,
    copyItem,
    downloadItem,
  } = model;

  return (
    <main className="min-h-screen">
      <header className="title-bar">
        <div className="title-inner">
          <div className="brand">
            <span className="brand-icon" aria-hidden="true">
              <Zap size={18} fill="currentColor" />
            </span>
            <h1>teleport</h1>
          </div>

          <div className="room-control">
            {room ? (
              <button
                className="joined-pill"
                onClick={() => {
                  setRoomInput(room);
                  setPasswordInput(roomPassword);
                  setIsEditingRoom((value) => !value);
                }}
                aria-expanded={isEditingRoom}
                aria-label={`Change room, currently ${room}`}
                title="Change room"
              >
                <span>{room}</span>
                <Check className="joined-check" size={16} />
                <ChevronDown className="room-chevron" size={15} />
              </button>
            ) : (
              <button className="create-room-pill" onClick={() => setIsEditingRoom(true)}>
                <Plus size={16} />
                Create room
              </button>
            )}

            {room && isEditingRoom && (
              <div className="room-popover" role="dialog" aria-label="Switch room">
                <RoomPrompt
                  room={room}
                  roomInput={roomInput}
                  passwordInput={passwordInput}
                  serverInput={serverInput}
                  recentRooms={recentRooms}
                  error={error}
                  showServer={desktopMode}
                  autoFocus
                  onRoomInput={setRoomInput}
                  onPasswordInput={setPasswordInput}
                  onServerInput={setServerInput}
                  onSubmit={() => enterRoom()}
                  onCancel={() => {
                    setRoomInput(room);
                    setPasswordInput(roomPassword);
                    setIsEditingRoom(false);
                  }}
                  onRecentRoom={enterRecentRoom}
                />
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="workspace">
        <div className="drop-column">
          <section className="drop-panel">
            <h2>Paste or drop</h2>
            <div
              ref={pasteBoxRef}
              tabIndex={0}
              role="textbox"
              aria-label="Paste or drop box"
              className={`paste-box ${isDragging ? "paste-box-dragging" : ""}`}
              onPaste={handlePaste}
              onDragOver={handleDragOver}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <span className="drop-icon">
                <UploadCloud size={44} strokeWidth={1.75} />
              </span>
              <div>
                <h3>Paste text or drop files</h3>
                <p>
                  {room ? `Synced to room ${room} instantly` : "Create a room to start syncing instantly"}
                </p>
              </div>
              <div className="guidance-row">
                <span>
                  <Keyboard size={14} />
                  Ctrl/⌘ + V
                </span>
                <span>
                  <FolderUp size={14} />
                  Drag files
                </span>
                <span>
                  <HardDriveUpload size={14} />
                  200 MB max
                </span>
              </div>

              {uploadProgress && <UploadPrompt progress={uploadProgress} />}
            </div>
          </section>

          <UploadSettings
            enabled={chunkUploadsEnabled}
            chunkSizeKb={chunkSizeKb}
            onEnabledChange={setChunkUploadsEnabled}
            onChunkSizeChange={setChunkSizeKb}
          />

          <TextComposer key={`${serverUrl}:${room}`} room={room} onSend={uploadText} />

          <section className="recent-panel">
            <h2>Recent rooms</h2>
            <div className="recent-list">
              {recentRooms.length ? (
                recentRooms.map((entry) => (
                  <button
                    key={entry.room}
                    className={entry.room === room ? "recent-chip recent-chip-active" : "recent-chip"}
                    onClick={() => enterRecentRoom(entry.room)}
                  >
                    <Link2 size={15} />
                    {entry.room}
                  </button>
                ))
              ) : (
                <p>No recent rooms yet.</p>
              )}
            </div>
          </section>

          {error && <p className="error-line">{error}</p>}
          {proxyChallenge && (
            <ProxyPrompt
              onOpen={() => openProxyChallenge(proxyChallenge.url, true)}
              onRetry={retryProxyConnection}
              onDismiss={() => setProxyChallenge(null)}
            />
          )}
        </div>

        <section className="items-panel">
          <div className="items-head">
            <p>Recent pastes</p>
          </div>

          {visibleItems.length ? (
            <ol className="items-list">
              {visibleItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  isCopied={copiedItemId === item.id}
                  onCopy={copyItem}
                  onDelete={deleteItem}
                  onTogglePin={togglePin}
                  onDownload={downloadItem}
                  onPreview={setExpandedImage}
                  getItemUrl={(itemUrl) => absoluteItemUrl(itemUrl, serverUrl)}
                />
              ))}
            </ol>
          ) : (
            <div className="empty-state">
              <FileCode2 size={34} />
              <p>
                {room ? "Paste text or drop a file to start syncing." : "Create a room to start syncing."}
              </p>
            </div>
          )}
        </section>
      </section>

      {newItemNotice && (
        <div className="new-item-notice" role="status" aria-live="polite">
          <span>
            <Clipboard size={16} />
          </span>
          <div>
            <strong>{newItemNotice.title}</strong>
            <p>{newItemNotice.detail}</p>
          </div>
        </div>
      )}

      {!room && isEditingRoom && (
        <div
          className="room-intro-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Create or join a room"
        >
          <div className="room-intro-card">
            <div className="intro-brand">
              <span className="intro-mark" aria-hidden="true">
                <Zap size={20} fill="currentColor" />
              </span>
              <span>teleport</span>
            </div>
            <h2>Create or join a room</h2>
            <p className="intro-copy">
              Pick a short room name. Everyone using the same room sees the same paste list.
            </p>
            <RoomPrompt
              room={room}
              roomInput={roomInput}
              passwordInput={passwordInput}
              serverInput={serverInput}
              recentRooms={recentRooms}
              error={error}
              showServer={desktopMode}
              autoFocus
              compact
              onRoomInput={setRoomInput}
              onPasswordInput={setPasswordInput}
              onServerInput={setServerInput}
              onSubmit={() => enterRoom()}
              onRecentRoom={enterRecentRoom}
            />
          </div>
        </div>
      )}

      {expandedImage && (
        <div className="image-modal" role="dialog" aria-modal="true" onClick={() => setExpandedImage(null)}>
          <div className="image-modal-inner" onClick={(event) => event.stopPropagation()}>
            <button
              className="image-modal-close"
              onClick={() => setExpandedImage(null)}
              aria-label="Close preview"
            >
              <X size={18} />
            </button>
            <img src={absoluteItemUrl(expandedImage.downloadUrl, serverUrl)} alt={expandedImage.fileName} />
            <p>{expandedImage.fileName}</p>
          </div>
        </div>
      )}
    </main>
  );
}
