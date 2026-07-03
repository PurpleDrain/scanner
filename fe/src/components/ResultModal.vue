<script setup lang="ts">
import { ref, watch } from "vue";
import { enhanceForOcr } from "../enhance/ocrEnhance";
import type { DocumentQualityResult } from "../quality/types";

const props = defineProps<{
  open: boolean;
  quality: DocumentQualityResult | null;
  enhanced: boolean;
  submitting: boolean;
  submitError: string | null;
}>();

const emit = defineEmits<{
  close: [];
  "update:enhanced": [value: boolean];
  submit: [blob: Blob];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
const resultCanvasRef = ref<HTMLCanvasElement | null>(null);
const downloadPngHref = ref("");
const downloadPngName = ref("scanned-document.png");
const downloadJpegHref = ref("");
const downloadJpegName = ref("scanned-document.jpg");

interface RawWarp { data: Uint8ClampedArray; width: number; height: number }
let rawWarp: RawWarp | null = null;

watch(
  () => props.open,
  (open) => {
    if (!dialogRef.value) return;
    if (open && !dialogRef.value.open) dialogRef.value.showModal();
    else if (!open && dialogRef.value.open) dialogRef.value.close();
    if (!open) rawWarp = null;
  },
  { flush: "post" },
);

watch(() => props.enhanced, () => draw());

function showResult(data: Uint8ClampedArray, width: number, height: number): void {
  rawWarp = { data, width, height };
  draw();
}

function draw(): void {
  if (!rawWarp || !resultCanvasRef.value) return;
  const { data, width, height } = rawWarp;
  const out = props.enhanced ? enhanceForOcr(data, width, height) : data;
  resultCanvasRef.value.width = width;
  resultCanvasRef.value.height = height;
  resultCanvasRef.value.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(out), width, height), 0, 0);
  downloadPngHref.value = resultCanvasRef.value.toDataURL("image/png");
  downloadPngName.value = `scanned-document-${width}x${height}.png`;
  downloadJpegHref.value = resultCanvasRef.value.toDataURL("image/jpeg", 0.95);
  downloadJpegName.value = `scanned-document-${width}x${height}.jpg`;
}

function gradeClass(q: DocumentQualityResult | null): string {
  return q ? `quality-grade grade-${q.qualityGrade}` : "quality-grade";
}

function gradeText(q: DocumentQualityResult | null): string {
  return q ? `${q.qualityGrade.toUpperCase()} · ${q.overallScore}/100` : "";
}

function recommendations(q: DocumentQualityResult | null): string[] {
  if (!q) return [];
  return q.recommendations.length ? q.recommendations : ["きれいに読み取れました。問題はありません。"];
}

function onSubmit(): void {
  const canvas = resultCanvasRef.value;
  if (!canvas || props.submitting) return;
  canvas.toBlob(
    (blob) => {
      if (blob) emit("submit", blob);
    },
    "image/jpeg",
    0.95,
  );
}

defineExpose({ showResult });
</script>

<template>
  <dialog ref="dialogRef" class="app-modal app-modal-full">
    <div class="modal-header">
      <h2>スキャン結果</h2>
      <button class="icon-btn modal-close" type="button" aria-label="閉じる" @click="$emit('close')">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div class="modal-body result-body">
      <div class="quality-summary">
        <span :class="gradeClass(quality)">{{ gradeText(quality) }}</span>
        <label class="enhance-toggle">
          <input
            type="checkbox"
            :checked="enhanced"
            @change="$emit('update:enhanced', ($event.target as HTMLInputElement).checked)"
          />
          読み取り用に補正する
        </label>
      </div>
      <ul v-if="quality && recommendations(quality).length" class="quality-recommendations">
        <li v-for="rec in recommendations(quality)" :key="rec">{{ rec }}</li>
      </ul>
      <div class="result-canvas-wrap">
        <canvas ref="resultCanvasRef" class="result-canvas"></canvas>
      </div>
    </div>
    <p v-if="submitError" class="submit-error" role="alert">{{ submitError }}</p>
    <footer class="modal-footer result-footer">
      <a :href="downloadJpegHref" :download="downloadJpegName" class="secondary-btn download-btn">JPEGを保存</a>
      <a :href="downloadPngHref" :download="downloadPngName" class="secondary-btn download-btn">PNGを保存</a>
      <button class="secondary-btn" type="button" @click="$emit('close')">閉じる</button>
      <button class="primary-btn" type="button" :disabled="submitting" @click="onSubmit">読み取りへ進む</button>
    </footer>
  </dialog>
</template>
