<script setup lang="ts">
import { ExternalLink, LockKeyhole, X } from "lucide-vue-next";

const emit = defineEmits<{ open: []; retry: []; dismiss: [] }>();
</script>

<template>
  <div class="proxy-prompt" role="alert">
    <span class="proxy-prompt-icon" aria-hidden="true"
      ><LockKeyhole :size="16"
    /></span>
    <div>
      <strong>Proxy confirmation required</strong>
      <p>Accept the confirmation page, then retry.</p>
    </div>
    <button type="button" class="proxy-prompt-primary" @click="emit('open')">
      <ExternalLink :size="14" />Open
    </button>
    <button type="button" class="proxy-prompt-secondary" @click="emit('retry')">
      Retry
    </button>
    <button
      type="button"
      class="proxy-prompt-close"
      aria-label="Dismiss"
      @click="emit('dismiss')"
    >
      <X :size="14" />
    </button>
  </div>
</template>
