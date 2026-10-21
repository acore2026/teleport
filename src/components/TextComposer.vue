<script setup lang="ts">
import { ref } from "vue";
import { Send } from "lucide-vue-next";

const props = defineProps<{
  room: string;
  onSend: (text: string) => Promise<boolean | undefined>;
}>();
const draft = ref("");
const sending = ref(false);
const sent = ref(false);

async function submit() {
  if (!props.room || !draft.value.trim() || sending.value) return;
  sending.value = true;
  sent.value = false;
  try {
    if (await props.onSend(draft.value)) {
      draft.value = "";
      sent.value = true;
    }
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <form class="text-composer" @submit.prevent="submit">
    <label for="paste-text">Send text</label>
    <p id="paste-text-help">
      On your phone, touch and hold the field, then choose Paste.
    </p>
    <textarea
      id="paste-text"
      v-model="draft"
      aria-describedby="paste-text-help"
      placeholder="Paste or type text here"
      :rows="4"
      :readonly="sending"
      @input="sent = false"
    />
    <div class="text-composer-actions">
      <span role="status">{{ sent ? "Sent to room" : "" }}</span>
      <button
        class="room-primary"
        type="submit"
        :disabled="!room || !draft.trim() || sending"
      >
        <Send :size="16" />{{ sending ? "Sending…" : "Send text" }}
      </button>
    </div>
  </form>
</template>
