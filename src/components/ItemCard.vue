<script setup lang="ts">
import { computed } from "vue";
import { Check, Copy, Download, Pin, PinOff, Trash2 } from "lucide-vue-next";
import { absoluteItemUrl } from "../lib/api";
import { fileIconFor } from "../lib/files";
import { formatBytes, timeAgo, timeLeft } from "../lib/format";
import type { RoomItem } from "../types";

const props = defineProps<{ item: RoomItem; isCopied: boolean; now: number }>();
const emit = defineEmits<{
  copy: [item: RoomItem];
  delete: [item: RoomItem];
  togglePin: [item: RoomItem];
  download: [item: RoomItem];
  preview: [item: Extract<RoomItem, { type: "file" }>];
}>();
const title = computed(() =>
  props.item.type === "file" ? props.item.fileName : "Text paste",
);
const icon = computed(() => fileIconFor(props.item));
const meta = computed(() => {
  const item = props.item;
  return item.type === "file"
    ? [
        formatBytes(item.fileSize),
        icon.value.label,
        item.pinned ? "Pinned" : timeLeft(item.expiresAt, props.now),
      ]
    : [
        timeAgo(item.createdAt, props.now),
        item.pinned ? "Pinned" : timeLeft(item.expiresAt, props.now),
      ];
});
</script>

<template>
  <li :class="['item-card', { 'item-card-copied': isCopied }]">
    <button
      v-if="item.type === 'file' && item.mimeType.startsWith('image/')"
      class="item-thumb"
      :aria-label="'Preview ' + item.fileName"
      @click="emit('preview', item)"
    >
      <img :src="absoluteItemUrl(item.downloadUrl)" alt="" loading="lazy" />
    </button>
    <div v-else :class="'item-icon item-icon-' + icon.tone">
      <component :is="icon.Icon" :size="20" />
    </div>
    <div class="item-body">
      <div class="item-meta">
        <h4>{{ title }}</h4>
        <span v-for="value in meta" :key="value">{{ value }}</span>
      </div>
      <pre v-if="item.type === 'text'">{{ item.textContent }}</pre>
    </div>
    <div class="item-actions">
      <button
        :class="['pin-action', { 'pin-action-active': item.pinned }]"
        :title="
          item.pinned ? 'Unpin and restart expiry' : 'Pin to prevent expiry'
        "
        :aria-label="(item.pinned ? 'Unpin ' : 'Pin ') + title"
        @click="emit('togglePin', item)"
      >
        <PinOff v-if="item.pinned" :size="15" /><Pin v-else :size="15" />
        <span>{{ item.pinned ? "Unpin" : "Pin" }}</span>
      </button>
      <button
        :class="['copy-action', { 'copy-action-done': isCopied }]"
        @click="emit('copy', item)"
      >
        <Check v-if="isCopied" :size="15" /><Copy v-else :size="15" />
        <span>{{
          isCopied ? "Copied" : item.type === "file" ? "Copy link" : "Copy"
        }}</span>
      </button>
      <button
        v-if="item.type === 'file'"
        class="primary-action"
        @click="emit('download', item)"
      >
        <Download :size="15" />Download
      </button>
      <button
        class="danger"
        :aria-label="'Delete ' + title"
        @click="emit('delete', item)"
      >
        <Trash2 :size="15" />
      </button>
    </div>
  </li>
</template>
