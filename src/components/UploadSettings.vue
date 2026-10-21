<script setup lang="ts">
import { Boxes } from "lucide-vue-next";
import { maxChunkSizeKb, minChunkSizeKb } from "../config";

const enabled = defineModel<boolean>("enabled", { required: true });
const chunkSizeKb = defineModel<number>("chunkSizeKb", { required: true });

function updateSize(event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber;
  if (Number.isFinite(value)) chunkSizeKb.value = value;
}

function clampSize(event: FocusEvent) {
  const value = Math.round(
    (event.target as HTMLInputElement).valueAsNumber || minChunkSizeKb,
  );
  chunkSizeKb.value = Math.min(maxChunkSizeKb, Math.max(minChunkSizeKb, value));
}
</script>

<template>
  <div class="chunk-setting">
    <label class="chunk-setting-toggle">
      <span class="chunk-setting-icon" aria-hidden="true"
        ><Boxes :size="16"
      /></span>
      <span class="chunk-setting-copy"
        ><strong>Chunk file uploads</strong
        ><small>Send large files in smaller requests</small></span
      >
      <input v-model="enabled" type="checkbox" />
    </label>
    <label v-if="enabled" class="chunk-size-field">
      <span>Chunk size</span>
      <span class="chunk-size-input">
        <input
          type="number"
          :min="minChunkSizeKb"
          :max="maxChunkSizeKb"
          :step="10"
          :value="chunkSizeKb"
          aria-label="Upload chunk size in KB"
          @input="updateSize"
          @blur="clampSize"
        />
        <span>KB</span>
      </span>
    </label>
  </div>
</template>
