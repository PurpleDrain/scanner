<script setup lang="ts">
import { ref, watch } from "vue";
import { CornerEditor } from "../ui/cornerEditor";
import type { Quad } from "../documentScanner";

const props = defineProps<{ open: boolean; isFlattening: boolean }>();
defineEmits<{ close: []; flatten: [] }>();

const dialogRef = ref<HTMLDialogElement | null>(null);
const editorBodyRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

let editor: CornerEditor | null = null;

watch(
  () => props.open,
  (open) => {
    if (!dialogRef.value) return;
    if (open && !dialogRef.value.open) dialogRef.value.showModal();
    else if (!open && dialogRef.value.open) dialogRef.value.close();
    if (!open) {
      editor?.destroy();
      editor = null;
    }
  },
  { flush: "post" },
);

function initEditor(still: HTMLCanvasElement, width: number, height: number, quad: Quad): void {
  requestAnimationFrame(() => {
    if (!editorBodyRef.value || !canvasRef.value) return;
    const pad = 16;
    const maxW = Math.max(1, editorBodyRef.value.clientWidth - pad);
    const maxH = Math.max(1, editorBodyRef.value.clientHeight - pad);
    editor?.destroy();
    editor = new CornerEditor({
      canvas: canvasRef.value,
      source: still,
      sourceWidth: width,
      sourceHeight: height,
      quad,
      maxDisplayWidth: maxW,
      maxDisplayHeight: maxH,
    });
  });
}

function getQuad(): Quad {
  if (!editor) throw new Error("No editor active");
  return editor.getQuad();
}

defineExpose({ initEditor, getQuad });
</script>

<template>
  <dialog ref="dialogRef" class="app-modal app-modal-full">
    <div class="modal-header">
      <h2>四隅の調整</h2>
      <button class="icon-btn modal-close" type="button" aria-label="キャンセル" @click="$emit('close')">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <p class="editor-hint">書類の四隅に合わせて、印をドラッグして調整してください。</p>
    <div ref="editorBodyRef" class="modal-body editor-body">
      <canvas ref="canvasRef" class="editor-canvas"></canvas>
    </div>
    <footer class="modal-footer">
      <button class="primary-btn" type="button" :disabled="isFlattening" @click="$emit('flatten')">補正して切り出す</button>
    </footer>
  </dialog>
</template>
