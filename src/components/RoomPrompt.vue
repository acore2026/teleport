<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from "vue";
import { Link2, LockKeyhole, Send, X } from "lucide-vue-next";
import type { RecentRoom } from "../types";

const props = defineProps<{
  room: string;
  recentRooms: RecentRoom[];
  error: string;
  autoFocus?: boolean;
  compact?: boolean;
  cancellable?: boolean;
}>();
const roomInput = defineModel<string>("roomInput", { required: true });
const passwordInput = defineModel<string>("passwordInput", { required: true });
const emit = defineEmits<{
  submit: [];
  cancel: [];
  recentRoom: [room: string];
}>();
const roomField = useTemplateRef<HTMLInputElement>("roomField");
const usableRooms = computed(() =>
  props.recentRooms.filter((entry) => entry.room !== props.room),
);

onMounted(() => {
  if (props.autoFocus) roomField.value?.focus();
});

function selectRoomInput(event: FocusEvent) {
  (event.target as HTMLInputElement).select();
}
</script>

<template>
  <div :class="['room-prompt', { 'room-prompt-compact': compact }]">
    <div v-if="!compact" class="room-prompt-head">
      <div>
        <h2>Switch room</h2>
        <p>Create a new room or jump back to a recent one.</p>
      </div>
      <button
        v-if="cancellable"
        class="room-close"
        type="button"
        aria-label="Close room switcher"
        @click="emit('cancel')"
      >
        <X :size="16" />
      </button>
    </div>
    <form
      class="room-switch-form"
      @submit.prevent="emit('submit')"
      @keydown.esc="cancellable && emit('cancel')"
    >
      <label>
        <span><Link2 :size="14" />Room</span>
        <input
          ref="roomField"
          v-model="roomInput"
          aria-label="Room name"
          @focus="selectRoomInput"
        />
      </label>
      <label>
        <span><LockKeyhole :size="14" />Password</span>
        <input
          v-model="passwordInput"
          type="password"
          placeholder="optional"
          aria-label="Room password"
        />
      </label>
      <p v-if="error" class="room-form-error">{{ error }}</p>
      <div class="room-actions">
        <button
          v-if="cancellable"
          class="room-secondary"
          type="button"
          @click="emit('cancel')"
        >
          Cancel
        </button>
        <button class="room-primary" type="submit">
          <Send :size="15" />{{ room ? "Switch" : "Enter room" }}
        </button>
      </div>
    </form>
    <div v-if="usableRooms.length" class="room-recents">
      <p>Recent rooms</p>
      <div>
        <button
          v-for="entry in usableRooms"
          :key="entry.room"
          type="button"
          @click="emit('recentRoom', entry.room)"
        >
          <Link2 :size="14" />{{ entry.room }}
        </button>
      </div>
    </div>
  </div>
</template>
