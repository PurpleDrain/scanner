import { ref, computed } from "vue";

export function useProcessing() {
  const processingDepth = ref(0);
  const processingMessage = ref("");
  const isProcessing = computed(() => processingDepth.value > 0);

  function beginProcessing(message: string) {
    processingDepth.value++;
    processingMessage.value = message;
  }

  function endProcessing() {
    processingDepth.value = Math.max(0, processingDepth.value - 1);
  }

  function updateProcessingMessage(message: string) {
    processingMessage.value = message;
  }

  return { isProcessing, processingMessage, beginProcessing, endProcessing, updateProcessingMessage };
}
