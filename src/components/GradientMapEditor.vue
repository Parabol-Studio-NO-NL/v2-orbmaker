<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import type { Color, GradientMapConfig, PaletteStop } from '../types'
import { samplePalette, sortStops, stopsToCssGradient } from '../utils/color'
import { segmentsWithMidpoints } from '../utils/gradientMidpoint'
import ColorWheel from './ColorWheel.vue'

const props = defineProps<{
  gradientMap: GradientMapConfig
}>()

const emit = defineEmits<{
  'update:enabled': [v: boolean]
  'stop:add': [position: number, color: Color]
  'stop:remove': [id: string]
  'stop:move': [id: string, position: number]
  'stop:color': [id: string, color: Color]
  'midpoint:move': [leftId: string, rightId: string, value: number]
}>()

const trackRef = ref<HTMLDivElement | null>(null)
const selectedId = ref<string | null>(null)
const draggingId = ref<string | null>(null)
const draggingMidKey = ref<string | null>(null)

const pendingAddPosition = ref<number | null>(null)
const pendingAddColor = ref<Color | null>(null)

let pendingMove: { id: string; position: number } | null = null
let pendingMid: { leftId: string; rightId: string; value: number } | null = null
let moveRaf: number | null = null

function emitStopMoveThrottled(id: string, position: number) {
  pendingMove = { id, position }
  if (moveRaf !== null) return
  moveRaf = requestAnimationFrame(() => {
    moveRaf = null
    if (pendingMove) {
      emit('stop:move', pendingMove.id, pendingMove.position)
      pendingMove = null
    }
    if (pendingMid) {
      emit('midpoint:move', pendingMid.leftId, pendingMid.rightId, pendingMid.value)
      pendingMid = null
    }
  })
}

function emitMidMoveThrottled(leftId: string, rightId: string, value: number) {
  pendingMid = { leftId, rightId, value }
  if (moveRaf !== null) return
  moveRaf = requestAnimationFrame(() => {
    moveRaf = null
    if (pendingMove) {
      emit('stop:move', pendingMove.id, pendingMove.position)
      pendingMove = null
    }
    if (pendingMid) {
      emit('midpoint:move', pendingMid.leftId, pendingMid.rightId, pendingMid.value)
      pendingMid = null
    }
  })
}

const sortedStops = computed(() => sortStops(props.gradientMap.stops))
const segments = computed(() => segmentsWithMidpoints(props.gradientMap))
const trackGradient = computed(() =>
  stopsToCssGradient(props.gradientMap.stops, props.gradientMap.midpoints),
)

const selectedStop = computed(() =>
  sortedStops.value.find((s) => s.id === selectedId.value) ?? null,
)

const canDelete = computed(() => props.gradientMap.stops.length > 2)
const showAddPicker = computed(() => pendingAddPosition.value !== null)

function positionFromClientX(clientX: number): number {
  const track = trackRef.value
  if (!track) return 0.5
  const rect = track.getBoundingClientRect()
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
}

function midpointLeftPercent(left: PaletteStop, right: PaletteStop, mid: number): number {
  return (left.position + (right.position - left.position) * mid) * 100
}

function onTrackPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.stop-handle, .mid-handle, .add-picker')) return

  const pos = positionFromClientX(e.clientX)
  pendingAddPosition.value = pos
  pendingAddColor.value = samplePalette(
    props.gradientMap.stops,
    pos,
    props.gradientMap.midpoints,
  )
}

function confirmAddStop() {
  if (pendingAddPosition.value === null || !pendingAddColor.value) return
  emit('stop:add', pendingAddPosition.value, { ...pendingAddColor.value })
  cancelAddStop()
}

function cancelAddStop() {
  pendingAddPosition.value = null
  pendingAddColor.value = null
}

function onHandlePointerDown(e: PointerEvent, stop: PaletteStop) {
  e.stopPropagation()
  e.preventDefault()
  selectedId.value = stop.id
  draggingId.value = stop.id
  cancelAddStop()
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)

  const onMove = (ev: PointerEvent) => {
    if (draggingId.value !== stop.id) return
    emitStopMoveThrottled(stop.id, positionFromClientX(ev.clientX))
  }

  const onUp = () => {
    if (pendingMove && pendingMove.id === stop.id) {
      emit('stop:move', pendingMove.id, pendingMove.position)
      pendingMove = null
    }
    flushRaf()
    draggingId.value = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function onMidPointerDown(
  e: PointerEvent,
  seg: { left: PaletteStop; right: PaletteStop; key: string; midpoint: number },
) {
  e.stopPropagation()
  e.preventDefault()
  draggingMidKey.value = seg.key
  cancelAddStop()
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)

  const onMove = (ev: PointerEvent) => {
    if (draggingMidKey.value !== seg.key) return
    const track = trackRef.value
    if (!track) return
    const x = positionFromClientX(ev.clientX)
    const span = seg.right.position - seg.left.position
    if (span < 0.001) return
    const mid = Math.max(0.05, Math.min(0.95, (x - seg.left.position) / span))
    emitMidMoveThrottled(seg.left.id, seg.right.id, mid)
  }

  const onUp = () => {
    if (pendingMid && pendingMid.leftId === seg.left.id) {
      emit('midpoint:move', pendingMid.leftId, pendingMid.rightId, pendingMid.value)
      pendingMid = null
    }
    flushRaf()
    draggingMidKey.value = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function flushRaf() {
  if (moveRaf !== null) {
    cancelAnimationFrame(moveRaf)
    moveRaf = null
  }
}

function onHandleClick(stop: PaletteStop) {
  selectedId.value = stop.id
  cancelAddStop()
}

function onHandleDblClick(stop: PaletteStop) {
  if (!canDelete.value) return
  if (selectedId.value === stop.id) selectedId.value = null
  emit('stop:remove', stop.id)
}

function removeSelected() {
  if (!selectedStop.value || !canDelete.value) return
  const id = selectedStop.value.id
  selectedId.value = null
  emit('stop:remove', id)
}

onUnmounted(() => {
  draggingId.value = null
  draggingMidKey.value = null
  flushRaf()
})
</script>

<template>
  <div class="gradient-editor" :class="{ 'gradient-editor--disabled': !gradientMap.enabled }">
    <label class="enable-row">
      <input
        type="checkbox"
        :checked="gradientMap.enabled"
        class="enable-check"
        @change="emit('update:enabled', ($event.target as HTMLInputElement).checked)"
      />
      <span>Enable gradient map</span>
    </label>

    <div ref="trackRef" class="gradient-ramp">
      <!-- Midpoint handles (above bar) -->
      <div class="midpoint-row">
        <button
          v-for="seg in segments"
          :key="seg.key"
          type="button"
          class="mid-handle"
          :class="{ 'mid-handle--dragging': draggingMidKey === seg.key }"
          :style="{ left: `${midpointLeftPercent(seg.left, seg.right, seg.midpoint)}%` }"
          title="Drag to sharpen or soften the blend between colors"
          @pointerdown="onMidPointerDown($event, seg)"
        />
      </div>

      <!-- Color gradient bar + stop handles -->
      <div
        class="gradient-track"
        :style="{ background: trackGradient }"
        @pointerdown="onTrackPointerDown"
      >
        <button
          v-for="stop in sortedStops"
          :key="stop.id"
          type="button"
          class="stop-handle"
          :class="{
            'stop-handle--selected': selectedId === stop.id,
            'stop-handle--dragging': draggingId === stop.id,
          }"
          :style="{ left: `${stop.position * 100}%` }"
          :title="`Drag color stop · double-click to remove`"
          @pointerdown="onHandlePointerDown($event, stop)"
          @click.stop="onHandleClick(stop)"
          @dblclick.stop="onHandleDblClick(stop)"
        >
          <span
            class="stop-handle-inner"
            :style="{ background: `rgb(${stop.color.r},${stop.color.g},${stop.color.b})` }"
          />
        </button>
      </div>
    </div>

    <p class="gradient-hint">
      Click bar to add a color · drag dots to move · drag diamonds to sharpen blends
    </p>

    <!-- Add-stop color picker -->
    <div v-if="showAddPicker" class="add-picker">
      <p class="picker-title">New color stop</p>
      <ColorWheel
        v-if="pendingAddColor"
        :color="pendingAddColor"
        @change="pendingAddColor = $event"
      />
      <div class="picker-actions">
        <button type="button" class="btn btn--primary" @click="confirmAddStop">Add stop</button>
        <button type="button" class="btn btn--ghost" @click="cancelAddStop">Cancel</button>
      </div>
    </div>

    <!-- Selected stop editor -->
    <div v-else-if="selectedStop" class="stop-editor">
      <p class="picker-title">Edit stop</p>
      <ColorWheel
        :color="selectedStop.color"
        @change="emit('stop:color', selectedStop.id, $event)"
      />
      <button
        v-if="canDelete"
        type="button"
        class="btn-delete"
        title="Remove stop"
        @click="removeSelected"
      >
        Remove stop
      </button>
    </div>

  </div>
</template>

<style scoped>
.gradient-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.gradient-editor--disabled .gradient-ramp {
  opacity: 0.45;
}

.enable-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  user-select: none;
}

.enable-check {
  width: 14px;
  height: 14px;
  accent-color: rgba(147, 197, 253, 0.9);
  cursor: pointer;
}

.gradient-ramp {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 26px;
}

.midpoint-row {
  position: relative;
  height: 28px;
  touch-action: none;
}

.mid-handle {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%) rotate(45deg);
  width: 12px;
  height: 12px;
  padding: 0;
  border: 2px solid rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.35);
  cursor: ew-resize;
  z-index: 3;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  transition: transform 0.1s, background 0.1s;
}

.mid-handle:hover,
.mid-handle--dragging {
  background: rgba(255, 255, 255, 0.75);
  transform: translate(-50%, -50%) rotate(45deg) scale(1.15);
}

.gradient-track {
  position: relative;
  height: 48px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  cursor: crosshair;
  touch-action: none;
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.25);
}

.gradient-hint {
  margin: -4px 0 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.28);
  line-height: 1.5;
}

.stop-handle {
  position: absolute;
  top: 100%;
  transform: translate(-50%, 4px);
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: grab;
  z-index: 2;
}

.stop-handle:active,
.stop-handle--dragging {
  cursor: grabbing;
}

.stop-handle-inner {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.55);
  transition: transform 0.1s;
}

.stop-handle--selected .stop-handle-inner,
.stop-handle:hover .stop-handle-inner {
  transform: scale(1.15);
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.95),
    0 2px 8px rgba(0, 0, 0, 0.6);
}

.add-picker,
.stop-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.picker-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
}

.picker-actions {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background 0.15s;
}

.btn--primary {
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.btn--primary:hover {
  background: rgba(255, 255, 255, 0.22);
}

.btn--ghost {
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.btn--ghost:hover {
  color: rgba(255, 255, 255, 0.75);
}

.btn-delete {
  padding: 6px 10px;
  font-size: 11px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  align-self: flex-start;
}

.btn-delete:hover {
  background: rgba(220, 38, 38, 0.15);
  color: rgba(252, 165, 165, 0.9);
  border-color: rgba(220, 38, 38, 0.35);
}

.control-row {
  margin-bottom: 0;
}

.control-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  margin-bottom: 6px;
}

.control-value {
  color: rgba(255, 255, 255, 0.45);
  font-variant-numeric: tabular-nums;
}

.slider {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.slider:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}

.slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
</style>
