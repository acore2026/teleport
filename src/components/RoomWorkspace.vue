<script setup lang="ts">
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
} from "lucide-vue-next";
import { useTeleport } from "../composables/useTeleport";
import { absoluteItemUrl } from "../lib/api";
import ItemCard from "./ItemCard.vue";
import ProxyPrompt from "./ProxyPrompt.vue";
import RoomPrompt from "./RoomPrompt.vue";
import TextComposer from "./TextComposer.vue";
import UploadPrompt from "./UploadPrompt.vue";
import UploadSettings from "./UploadSettings.vue";

const {
  roomInput,
  room,
  passwordInput,
  roomPassword,
  isEditingRoom,
  recentRooms,
  error,
  isDragging,
  uploadProgress,
  chunkUploadsEnabled,
  chunkSizeKb,
  copiedItemId,
  newItemNotice,
  expandedImage,
  pasteBox,
  now,
  visibleItems,
  proxyChallenge,
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
} = useTeleport();

function toggleRoomEditor() {
  roomInput.value = room.value;
  passwordInput.value = roomPassword.value;
  isEditingRoom.value = !isEditingRoom.value;
}

function cancelRoomEditor() {
  roomInput.value = room.value;
  passwordInput.value = roomPassword.value;
  isEditingRoom.value = false;
}
</script>

<template>
  <main class="min-h-screen">
    <header class="title-bar">
      <div class="title-inner">
        <div class="brand">
          <span class="brand-icon" aria-hidden="true"
            ><Zap :size="18" fill="currentColor"
          /></span>
          <h1>teleport</h1>
        </div>
        <div class="room-control">
          <button
            v-if="room"
            class="joined-pill"
            :aria-expanded="isEditingRoom"
            :aria-label="'Change room, currently ' + room"
            title="Change room"
            @click="toggleRoomEditor"
          >
            <span>{{ room }}</span
            ><Check class="joined-check" :size="16" /><ChevronDown
              class="room-chevron"
              :size="15"
            />
          </button>
          <button v-else class="create-room-pill" @click="isEditingRoom = true">
            <Plus :size="16" />Create room
          </button>
          <div
            v-if="room && isEditingRoom"
            class="room-popover"
            role="dialog"
            aria-label="Switch room"
          >
            <RoomPrompt
              v-model:room-input="roomInput"
              v-model:password-input="passwordInput"
              :room="room"
              :recent-rooms="recentRooms"
              :error="error"
              auto-focus
              cancellable
              @submit="enterRoom()"
              @cancel="cancelRoomEditor"
              @recent-room="enterRecentRoom"
            />
          </div>
        </div>
      </div>
    </header>
    <section class="workspace">
      <div class="drop-column">
        <section class="drop-panel">
          <h2>Paste or drop</h2>
          <div
            ref="pasteBox"
            tabindex="0"
            role="textbox"
            aria-label="Paste or drop box"
            :class="['paste-box', { 'paste-box-dragging': isDragging }]"
            @paste="handlePaste"
            @dragover="handleDragOver"
            @dragleave="isDragging = false"
            @drop="handleDrop"
          >
            <span class="drop-icon"
              ><UploadCloud :size="44" :stroke-width="1.75"
            /></span>
            <div>
              <h3>Paste text or drop files</h3>
              <p>
                {{
                  room
                    ? "Synced to room " + room + " instantly"
                    : "Create a room to start syncing instantly"
                }}
              </p>
            </div>
            <div class="guidance-row">
              <span><Keyboard :size="14" />Ctrl/⌘ + V</span>
              <span><FolderUp :size="14" />Drag files</span>
              <span><HardDriveUpload :size="14" />200 MB max</span>
            </div>
            <UploadPrompt v-if="uploadProgress" :progress="uploadProgress" />
          </div>
        </section>
        <UploadSettings
          v-model:enabled="chunkUploadsEnabled"
          v-model:chunk-size-kb="chunkSizeKb"
        />
        <TextComposer :key="room" :room="room" :on-send="uploadText" />
        <section class="recent-panel">
          <h2>Recent rooms</h2>
          <div class="recent-list">
            <template v-if="recentRooms.length">
              <button
                v-for="entry in recentRooms"
                :key="entry.room"
                :class="[
                  'recent-chip',
                  { 'recent-chip-active': entry.room === room },
                ]"
                @click="enterRecentRoom(entry.room)"
              >
                <Link2 :size="15" />{{ entry.room }}
              </button>
            </template>
            <p v-else>No recent rooms yet.</p>
          </div>
        </section>
        <p v-if="error" class="error-line">{{ error }}</p>
        <ProxyPrompt
          v-if="proxyChallenge"
          @open="openProxyChallenge(proxyChallenge.url)"
          @retry="retryProxyConnection"
          @dismiss="proxyChallenge = null"
        />
      </div>
      <section class="items-panel">
        <div class="items-head"><p>Recent pastes</p></div>
        <ol v-if="visibleItems.length" class="items-list">
          <ItemCard
            v-for="item in visibleItems"
            :key="item.id"
            :item="item"
            :is-copied="copiedItemId === item.id"
            :now="now"
            @copy="copyItem"
            @delete="deleteItem"
            @toggle-pin="togglePin"
            @download="downloadItem"
            @preview="expandedImage = $event"
          />
        </ol>
        <div v-else class="empty-state">
          <FileCode2 :size="34" />
          <p>
            {{
              room
                ? "Paste text or drop a file to start syncing."
                : "Create a room to start syncing."
            }}
          </p>
        </div>
      </section>
    </section>
    <div
      v-if="newItemNotice"
      class="new-item-notice"
      role="status"
      aria-live="polite"
    >
      <span><Clipboard :size="16" /></span>
      <div>
        <strong>{{ newItemNotice.title }}</strong>
        <p>{{ newItemNotice.detail }}</p>
      </div>
    </div>
    <div
      v-if="!room && isEditingRoom"
      class="room-intro-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Create or join a room"
    >
      <div class="room-intro-card">
        <div class="intro-brand">
          <span class="intro-mark" aria-hidden="true"
            ><Zap :size="20" fill="currentColor" /></span
          ><span>teleport</span>
        </div>
        <h2>Create or join a room</h2>
        <p class="intro-copy">
          Pick a short room name. Everyone using the same room sees the same
          paste list.
        </p>
        <RoomPrompt
          v-model:room-input="roomInput"
          v-model:password-input="passwordInput"
          :room="room"
          :recent-rooms="recentRooms"
          :error="error"
          auto-focus
          compact
          @submit="enterRoom()"
          @recent-room="enterRecentRoom"
        />
      </div>
    </div>
    <div
      v-if="expandedImage"
      class="image-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      @click="expandedImage = null"
      @keydown.esc="expandedImage = null"
    >
      <div class="image-modal-inner" @click.stop>
        <button
          class="image-modal-close"
          aria-label="Close preview"
          @click="expandedImage = null"
        >
          <X :size="18" />
        </button>
        <img
          :src="absoluteItemUrl(expandedImage.downloadUrl)"
          :alt="expandedImage.fileName"
        />
        <p>{{ expandedImage.fileName }}</p>
      </div>
    </div>
  </main>
</template>
