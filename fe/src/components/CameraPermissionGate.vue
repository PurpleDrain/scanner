<script setup lang="ts">
defineProps<{ message: string }>();
defineEmits<{ allow: []; gallery: [] }>();
</script>

<template>
  <div class="camera-permission">
    <div class="camera-permission-card">
      <h2>Camera access</h2>
      <p>{{ message }}</p>
      <button class="primary-btn" type="button" @click="$emit('allow')">Allow camera</button>
      <button class="secondary-btn" type="button" @click="$emit('gallery')">Choose from gallery</button>
    </div>
  </div>
</template>
