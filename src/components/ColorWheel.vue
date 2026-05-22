<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import type { Color } from '../types'
import { colorToHex } from '../utils/color'
import { colorToHsv, hsvToColor, type Hsv } from '../utils/hsv'

const props = defineProps<{
  color: Color
}>()

const emit = defineEmits<{
  change: [color: Color]
}>()

const hsv = ref<Hsv>(colorToHsv(props.color))
const wheelRef = ref<HTMLCanvasElement | null>(null)
const wheelSize = 140
const draggingWheel = ref(false)

watch(
  () => props.color,
  (c) => {
    hsv.value = colorToHsv(c)
    drawWheel()
  },
  { deep: true },
)

function emitColor() {
  emit('change', hsvToColor(hsv.value))
}

function drawWheel() {
  const canvas = wheelRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const { width, height } = canvas
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(cx, cy) - 2

  const image = ctx.createImageData(width, height)
  const data = image.data

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const dx = px - cx
      const dy = py - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const idx = (py * width + px) * 4

      if (dist > radius) {
        data[idx + 3] = 0
        continue
      }

      const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 180
      const sat = dist / radius
      const c = hsvToColor({ h: angle, s: sat, v: 1 })
      data[idx] = c.r
      data[idx + 1] = c.g
      data[idx + 2] = c.b
      data[idx + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)

  const selAngle = ((hsv.value.h * Math.PI) / 180) - Math.PI
  const selR = hsv.value.s * radius
  const sx = cx + Math.cos(selAngle) * selR
  const sy = cy + Math.sin(selAngle) * selR

  ctx.beginPath()
  ctx.arc(sx, sy, 6, 0, Math.PI * 2)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(sx, sy, 5, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.lineWidth = 1
  ctx.stroke()
}

function pickFromWheel(clientX: number, clientY: number) {
  const canvas = wheelRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const px = (clientX - rect.left) * scaleX
  const py = (clientY - rect.top) * scaleY
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const radius = Math.min(cx, cy) - 2

  const dx = px - cx
  const dy = py - cy
  const dist = Math.min(Math.sqrt(dx * dx + dy * dy), radius)
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 180

  hsv.value = {
    h: angle,
    s: dist / radius,
    v: hsv.value.v,
  }
  drawWheel()
  emitColor()
}

function onWheelPointerDown(e: PointerEvent) {
  draggingWheel.value = true
  pickFromWheel(e.clientX, e.clientY)
  ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)

  const onMove = (ev: PointerEvent) => pickFromWheel(ev.clientX, ev.clientY)
  const onUp = () => {
    draggingWheel.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function onValueInput(e: Event) {
  hsv.value = { ...hsv.value, v: Number((e.target as HTMLInputElement).value) }
  drawWheel()
  emitColor()
}

onMounted(() => drawWheel())
onUnmounted(() => {
  draggingWheel.value = false
})
</script>

<template>
  <div class="color-wheel">
    <canvas
      ref="wheelRef"
      class="wheel-canvas"
      :width="wheelSize"
      :height="wheelSize"
      @pointerdown="onWheelPointerDown"
    />
    <div class="wheel-controls">
      <div
        class="preview-swatch"
        :style="{ background: colorToHex(hsvToColor(hsv)) }"
      />
      <div class="value-row">
        <label class="value-label">Brightness</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="hsv.v"
          class="value-slider"
          @input="onValueInput"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.color-wheel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.wheel-canvas {
  display: block;
  border-radius: 50%;
  cursor: crosshair;
  touch-action: none;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
}

.wheel-controls {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.preview-swatch {
  width: 100%;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.value-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.value-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.45);
}

.value-slider {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: linear-gradient(to right, #000, #fff);
  border-radius: 2px;
  cursor: pointer;
}

.value-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
</style>
