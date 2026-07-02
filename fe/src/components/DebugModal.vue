<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  rows: [string, string][];
  overlayLayers: { rawDetected: boolean; velocity: boolean };
}>();

const emit = defineEmits<{
  close: [];
  "update:overlayLayers": [layers: { rawDetected: boolean; velocity: boolean }];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!dialogRef.value) return;
    if (open && !dialogRef.value.open) dialogRef.value.showModal();
    else if (!open && dialogRef.value.open) dialogRef.value.close();
  },
  { flush: "post" },
);

function toggleLayer(key: "rawDetected" | "velocity", value: boolean) {
  emit("update:overlayLayers", { ...props.overlayLayers, [key]: value });
}
</script>

<template>
  <dialog ref="dialogRef" class="app-modal">
    <div class="modal-header">
      <h2>Debug</h2>
      <button class="icon-btn modal-close" type="button" aria-label="Close debug" @click="$emit('close')">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div class="modal-body modal-body-scroll">
      <h3>Info</h3>
      <dl class="debug-list">
        <template v-for="[label, value] in rows" :key="label">
          <dt>{{ label }}</dt>
          <dd>{{ value }}</dd>
        </template>
      </dl>
      <h3>Overlay layers</h3>
      <p class="debug-hint">Toggle the detected-quad and velocity overlays.</p>
      <div class="debug-layers">
        <label>
          <input
            type="checkbox"
            :checked="overlayLayers.rawDetected"
            @change="toggleLayer('rawDetected', ($event.target as HTMLInputElement).checked)"
          />
          <span>Raw detected quad (yellow)</span>
        </label>
        <label>
          <input
            type="checkbox"
            :checked="overlayLayers.velocity"
            @change="toggleLayer('velocity', ($event.target as HTMLInputElement).checked)"
          />
          <span>Corner velocity vectors</span>
        </label>
      </div>
    </div>
  </dialog>
</template>
