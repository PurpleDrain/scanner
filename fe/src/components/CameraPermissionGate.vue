<script setup lang="ts">
defineProps<{ message: string }>();
defineEmits<{ allow: []; gallery: [] }>();
</script>

<template>
  <div class="camera-permission">
    <div class="camera-permission-card">
      <h2>カメラの使用について</h2>
      <p>{{ message }}</p>
      <button class="primary-btn" type="button" @click="$emit('allow')">カメラを許可</button>
      <button class="secondary-btn" type="button" @click="$emit('gallery')">ギャラリーから選択</button>
    </div>
  </div>
</template>
