import { ArrowLeft, Clipboard, ExternalLink, Maximize2, Settings, UploadCloud, X, Zap } from "lucide-react";
import type { TeleportModel } from "../hooks/useTeleport";
import { absoluteItemUrl } from "../lib/api";
import { MiniItemCard } from "./ItemCard";
import { ProxyPrompt } from "./ProxyPrompt";
import { RoomPrompt } from "./RoomPrompt";
import { ShortcutInput } from "./ShortcutInput";
import { UploadPrompt } from "./UploadPrompt";
import { UploadSettings } from "./UploadSettings";

export function MiniWindow({ model }: { model: TeleportModel }) {
  const {
    roomInput,
    setRoomInput,
    room,
    serverInput,
    setServerInput,
    serverUrl,
    minifiedMode,
    setMinifiedMode,
    openPanelInput,
    setOpenPanelInput,
    copyInput,
    setCopyInput,
    pasteInput,
    setPasteInput,
    autoCaptureClipboard,
    setAutoCaptureClipboard,
    autoCopyIncoming,
    setAutoCopyIncoming,
    notificationsEnabled,
    setNotificationsEnabled,
    passwordInput,
    setPasswordInput,
    isEditingRoom,
    setIsEditingRoom,
    recentRooms,
    error,
    isDragging,
    setIsDragging,
    uploadProgress,
    copiedItemId,
    newItemNotice,
    expandedImage,
    setExpandedImage,
    isMiniSettingsOpen,
    setIsMiniSettingsOpen,
    settingsMessage,
    chunkUploadsEnabled,
    setChunkUploadsEnabled,
    chunkSizeKb,
    setChunkSizeKb,
    proxyChallenge,
    setProxyChallenge,
    pasteBoxRef,
    visibleItems,
    openFullWindow,
    openProxyChallenge,
    retryProxyConnection,
    enterRoom,
    enterRecentRoom,
    handlePaste,
    handleDragOver,
    handleDrop,
    deleteItem,
    togglePin,
    copyItem,
    downloadItem,
    startMiniWindowDrag,
  } = model;

  return (
    <main className="mini-shell">
      <header className="mini-titlebar" onMouseDown={startMiniWindowDrag}>
        <div className="mini-brand">
          <span aria-hidden="true">
            <Zap size={16} fill="currentColor" />
          </span>
          <strong>teleport</strong>
        </div>
        <div className="mini-actions">
          {!isMiniSettingsOpen && room && (
            <button className="mini-room-chip" onClick={() => setIsEditingRoom(true)}>
              {room}
            </button>
          )}
          {!isMiniSettingsOpen && (
            <button
              className="mini-icon-button"
              onClick={() => setIsMiniSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
            >
              <Settings size={16} />
            </button>
          )}
          <button
            className="mini-icon-button"
            onClick={openFullWindow}
            aria-label="Full window"
            title="Full window"
          >
            <Maximize2 size={16} />
          </button>
        </div>
      </header>

      <section className="mini-content">
        {isMiniSettingsOpen ? (
          <section className="mini-settings-page" aria-label="Client settings">
            <div className="mini-page-head">
              <button className="mini-back-button" type="button" onClick={() => setIsMiniSettingsOpen(false)}>
                <ArrowLeft size={15} />
                Back
              </button>
              <h2>Settings</h2>
            </div>

            <div className="mini-settings-form">
              <UploadSettings
                compact
                enabled={chunkUploadsEnabled}
                chunkSizeKb={chunkSizeKb}
                onEnabledChange={setChunkUploadsEnabled}
                onChunkSizeChange={setChunkSizeKb}
              />
              <label className="mini-toggle">
                <span>
                  <strong>Minified mode</strong>
                  <small>Open this panel on launch</small>
                </span>
                <input
                  type="checkbox"
                  checked={minifiedMode}
                  onChange={(event) => setMinifiedMode(event.currentTarget.checked)}
                />
              </label>
              <label className="mini-toggle">
                <span>
                  <strong>Auto Paste</strong>
                  <small>Auto paste copied text and images</small>
                </span>
                <input
                  type="checkbox"
                  checked={autoCaptureClipboard}
                  onChange={(event) => setAutoCaptureClipboard(event.currentTarget.checked)}
                />
              </label>
              <label className="mini-toggle">
                <span>
                  <strong>Auto Copy</strong>
                  <small>Auto copy incoming text and images</small>
                </span>
                <input
                  type="checkbox"
                  checked={autoCopyIncoming}
                  onChange={(event) => setAutoCopyIncoming(event.currentTarget.checked)}
                />
              </label>
              <label className="mini-toggle">
                <span>
                  <strong>Notifications</strong>
                  <small>Show new paste alerts</small>
                </span>
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(event) => setNotificationsEnabled(event.currentTarget.checked)}
                />
              </label>
              <label>
                <span>Server address</span>
                <input value={serverInput} onChange={(event) => setServerInput(event.target.value)} />
              </label>
              <label>
                <span>Open panel</span>
                <ShortcutInput value={openPanelInput} onChange={setOpenPanelInput} />
              </label>
              <label>
                <span>Copy</span>
                <ShortcutInput value={copyInput} onChange={setCopyInput} />
              </label>
              <label>
                <span>Paste</span>
                <ShortcutInput value={pasteInput} onChange={setPasteInput} />
              </label>
            </div>

            <div className="mini-settings-foot">{settingsMessage && <p>{settingsMessage}</p>}</div>
          </section>
        ) : !room || isEditingRoom ? (
          <section className="mini-room-card">
            <h2>{room ? "Switch room" : "Create or join a room"}</h2>
            <RoomPrompt
              room={room}
              roomInput={roomInput}
              passwordInput={passwordInput}
              serverInput={serverInput}
              recentRooms={recentRooms}
              error={error}
              autoFocus
              compact
              onRoomInput={setRoomInput}
              onPasswordInput={setPasswordInput}
              onServerInput={setServerInput}
              onSubmit={() => enterRoom()}
              onCancel={room ? () => setIsEditingRoom(false) : undefined}
              onRecentRoom={enterRecentRoom}
            />
          </section>
        ) : (
          <>
            <section
              ref={pasteBoxRef}
              tabIndex={0}
              role="textbox"
              aria-label="Paste or drop box"
              className={`mini-paste-box ${isDragging ? "mini-paste-box-dragging" : ""}`}
              onPaste={handlePaste}
              onDragOver={handleDragOver}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <span>
                <UploadCloud size={22} />
              </span>
              <div>
                <strong>Paste or drop</strong>
                <p>Synced to {room}</p>
              </div>
            </section>

            {uploadProgress && <UploadPrompt progress={uploadProgress} />}
            {proxyChallenge && (
              <ProxyPrompt
                compact
                onOpen={() => openProxyChallenge(proxyChallenge.url, true)}
                onRetry={retryProxyConnection}
                onDismiss={() => setProxyChallenge(null)}
              />
            )}
            {error && <p className="mini-error">{error}</p>}

            <section className="mini-list-panel">
              <div className="mini-list-head">
                <h2>Recent pastes</h2>
                <button onClick={openFullWindow}>
                  <ExternalLink size={14} />
                  Open
                </button>
              </div>
              {visibleItems.length ? (
                <ol className="mini-items-list">
                  {visibleItems.slice(0, 8).map((item) => (
                    <MiniItemCard
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
                <div className="mini-empty">
                  <Clipboard size={24} />
                  <p>Paste text or drop a file.</p>
                </div>
              )}
            </section>
          </>
        )}
      </section>

      {newItemNotice && (
        <div className="mini-notice" role="status" aria-live="polite">
          <strong>{newItemNotice.title}</strong>
          <p>{newItemNotice.detail}</p>
        </div>
      )}

      {expandedImage && (
        <div
          className="image-modal image-modal-mini"
          role="dialog"
          aria-modal="true"
          onClick={() => setExpandedImage(null)}
        >
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
