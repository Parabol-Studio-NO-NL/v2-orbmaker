<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Color } from '../types'
import { colorToHex, hexToColor } from '../utils/color'

const props = defineProps<{
  color: Color
  label?: string
  size?: 'sm' | 'md'
}>()

const emit = defineEmits<{
  change: [color: Color]
}>()

const inputRef = ref<HTMLInputElement | null>(null)

const hex = computed(() => colorToHex(props.color))

function onInput(e: Event) {
  const val = (e.target as HTMLInputElement).value
  emit('change', hexToColor(val))
}

function openPicker() {
  inputRef.value?.click()
}
</script>

<template>
  <div
    class="color-swatch"
    :class="[`color-swatch--${size ?? 'md'}`]"
    :title="label"
    @click="openPicker"
  >
    <span class="swatch-dot" :style="{ background: hex }" />
    <span v-if="label" class="swatch-label">{{ label }}</span>
    <input
      ref="inputRef"
      type="color"
      :value="hex"
      class="color-input"
      tabindex="-1"
      @input="onInput"
    />
  </div>
</template>

<style scoped>
.color-swatch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  padding: 6px 10px;
  transition: background 0.15s, border-color 0.15s;
  position: relative;
}

.color-swatch:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.color-swatch--sm {
  padding: 4px 8px;
  gap: 6px;
}

.swatch-dot {
  display: block;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}

.color-swatch--md .swatch-dot {
  width: 18px;
  height: 18px;
}

.color-swatch--sm .swatch-dot {
  width: 14px;
  height: 14px;
}

.swatch-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  white-space: nowrap;
}

/* Hidden native color input — used only for the OS color picker */
.color-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
  border: none;
  padding: 0;
}
</style>
