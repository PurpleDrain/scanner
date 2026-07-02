<script setup lang="ts">
import { ref } from "vue";
import CameraPermissionGate from "./CameraPermissionGate.vue";
import type { CaptureMode } from "../composables/useCameraSession";

defineProps<{
  status: string;
  hints: string[];
  captureEnabled: boolean;
  captureMode: CaptureMode;
  showPermission: boolean;
  permissionMessage: string;
}>();

defineEmits<{
  capture: [];
  "allow-camera": [];
  "choose-gallery": [];
  "open-debug": [];
}>();

const videoEl = ref<HTMLVideoElement | null>(null);
const overlayEl = ref<HTMLCanvasElement | null>(null);

defineExpose({ videoEl, overlayEl });
</script>

<template>
  <section class="camera-shell">
    <div class="camera-viewport">
      <video ref="videoEl" class="camera-video" autoplay muted playsinline></video>
      <canvas ref="overlayEl" class="overlay-canvas"></canvas>
    </div>

    <CameraPermissionGate
      v-if="showPermission"
      :message="permissionMessage"
      @allow="$emit('allow-camera')"
      @gallery="$emit('choose-gallery')"
    />

    <div class="camera-chrome">
      <header class="camera-top">
        <p class="stage-status" aria-live="polite">{{ status }}</p>
        <button class="icon-btn" type="button" aria-label="Debug info" @click="$emit('open-debug')">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
      </header>

      <div class="precapture-hints" aria-live="polite">
        <span v-for="hint in hints" :key="hint" class="hint-chip">{{ hint }}</span>
      </div>

      <footer class="camera-bottom">
        <button class="icon-btn gallery-btn" type="button" aria-label="Choose from gallery" @click="$emit('choose-gallery')">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </button>
        <button
          class="shutter-btn"
          :class="{
            'hold-steady': !captureEnabled,
            'capture-soft': captureEnabled && captureMode !== 'ready',
          }"
          type="button"
          :disabled="!captureEnabled"
          :aria-label="captureEnabled ? 'Capture document' : 'Hold steady'"
          @click="$emit('capture')"
        >
          <span class="shutter-inner"></span>
        </button>
        <div class="camera-bottom-spacer" aria-hidden="true"></div>
      </footer>
    </div>
  </section>
</template>
