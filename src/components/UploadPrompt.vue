<script setup lang="ts">
import { formatBytes } from "../lib/format";
import type { UploadProgress } from "../types";

defineProps<{ progress: UploadProgress }>();
</script>

<template>
  <div class="upload-prompt" aria-live="polite">
    <div class="upload-prompt-head">
      <strong>{{ progress.fileName }}</strong
      ><span>{{ progress.index }}/{{ progress.totalFiles }}</span>
    </div>
    <div class="progress-track">
      <div :style="{ width: progress.percent + '%' }" />
    </div>
    <p v-if="progress.processing">Processing...</p>
    <p v-else>
      {{ progress.percent }}% · {{ formatBytes(progress.loaded) }} /
      {{ formatBytes(progress.total) }}
      <template v-if="progress.totalChunks && progress.totalChunks > 1">
        · Chunk {{ progress.chunkIndex }} of
        {{ progress.totalChunks }}</template
      >
    </p>
  </div>
</template>
