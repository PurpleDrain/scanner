<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{ open: boolean; message: string }>();

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
</script>

<template>
  <dialog ref="dialogRef" class="processing-dialog" aria-live="polite">
    <div class="processing-content">
      <div class="spinner" role="status" aria-label="Processing"></div>
      <p class="processing-message">{{ message }}</p>
    </div>
  </dialog>
</template>
