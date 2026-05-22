<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { MeshGrid, MeshConfig, Color } from '../types'
import { renderMeshToCanvas } from '../utils/render'
import { uvToCanvas } from '../utils/mesh'

const props = defineProps<{
  grid: MeshGrid
  config: MeshConfig
  selectedPoint: { row: number; col: number } | null
  renderVersion: number
}>()

const emit = defineEmits<{
  pointClick: [row: number, col: number]
  pointColorChange: [row: number, col: number, color: Color]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayCanvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
let renderRaf: number | null = null

function scheduleRender() {
  if (renderRaf) cancelAnimationFrame(renderRaf)
  renderRaf = requestAnimationFrame(() => {
    renderRaf = null
    paintColorLayer()
    paintMeshOverlay()
  })
}

function paintColorLayer() {
  const canvas = canvasRef.value
  if (!canvas) return
  renderMeshToCanvas(canvas, props.grid, props.config)
}

function paintMeshOverlay() {
  const overlay = overlayCanvasRef.value
  if (!overlay) return
  const ctx = overlay.getContext('2d')
  if (!ctx) return

  const size = props.config.canvasSize
  ctx.clearRect(0, 0, size, size)

  if (!showMeshLines.value) return

  const { grid } = props
  const cx = size / 2
  const cy = size / 2
  const radius = size * 0.46
  const curveSteps = 8

  const colU = (col: number) =>
    grid.cols === 1 ? 0.5 : col / (grid.cols - 1)
  const rowV = (row: number) =>
    grid.rows === 1 ? 0.5 : row / (grid.rows - 1)

  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 0.5

  for (let row = 0; row < grid.rows; row++) {
    const v = rowV(row)
    ctx.beginPath()
    let started = false
    for (let col = 0; col < grid.cols - 1; col++) {
      const u0 = colU(col)
      const u1 = colU(col + 1)
      for (let s = 0; s <= curveSteps; s++) {
        const t = s / curveSteps
        const u = u0 + (u1 - u0) * t
        const { x, y } = uvToCanvas(u, v, cx, cy, radius)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else {
          ctx.lineTo(x, y)
        }
      }
    }
    ctx.stroke()
  }

  for (let col = 0; col < grid.cols; col++) {
    const u = colU(col)
    ctx.beginPath()
    let started = false
    for (let row = 0; row < grid.rows - 1; row++) {
      const v0 = rowV(row)
      const v1 = rowV(row + 1)
      for (let s = 0; s <= curveSteps; s++) {
        const t = s / curveSteps
        const v = v0 + (v1 - v0) * t
        const { x, y } = uvToCanvas(u, v, cx, cy, radius)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else {
          ctx.lineTo(x, y)
        }
      }
    }
    ctx.stroke()
  }

  ctx.restore()
}

const showMeshLines = ref(true)
const showPointHandles = ref(true)

onMounted(() => {
  scheduleRender()
})

watch(
  () => [
    props.grid,
    props.config.sphereShading,
    props.config.sphereLightness,
    props.config.sphereShininess,
    props.config.gradientMap.enabled,
    props.config.gradientMap.offset,
    props.config.blur.gaussian,
    props.config.blur.motion,
    props.config.blur.motionAxis,
    props.config.blur.rotation,
    props.config.blur.grain,
    props.renderVersion,
  ],
  scheduleRender,
)

watch(showMeshLines, () => {
  nextTick(paintMeshOverlay)
})

defineExpose({ showMeshLines, showPointHandles, canvas: canvasRef })

onUnmounted(() => {
  if (renderRaf) cancelAnimationFrame(renderRaf)
})

function onCanvasClick(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return

  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const px = (e.clientX - rect.left) * scaleX
  const py = (e.clientY - rect.top) * scaleY

  const size = props.config.canvasSize
  const cx = size / 2
  const cy = size / 2
  const radius = size * 0.46

  let closest: { row: number; col: number; dist: number } | null = null
  const THRESHOLD = radius * 0.1

  for (let row = 0; row < props.grid.rows; row++) {
    for (let col = 0; col < props.grid.cols; col++) {
      const pt = props.grid.points[row][col]
      const d = Math.hypot(pt.x - px, pt.y - py)
      if (d < THRESHOLD && (!closest || d < closest.dist)) {
        closest = { row, col, dist: d }
      }
    }
  }

  if (closest) {
    emit('pointClick', closest.row, closest.col)
  }
}
</script>

<template>
  <div ref="containerRef" class="canvas-wrapper">
    <canvas
      ref="canvasRef"
      :width="config.canvasSize"
      :height="config.canvasSize"
      class="mesh-canvas mesh-canvas--color"
      @click="onCanvasClick"
    />
    <canvas
      ref="overlayCanvasRef"
      :width="config.canvasSize"
      :height="config.canvasSize"
      class="mesh-canvas mesh-canvas--overlay"
    />

    <template v-if="showPointHandles" v-for="(row, rowIdx) in grid.points" :key="rowIdx">
      <button
        v-for="(pt, colIdx) in row"
        :key="colIdx"
        class="point-handle"
        :class="{
          'point-handle--selected': selectedPoint?.row === rowIdx && selectedPoint?.col === colIdx,
          'point-handle--pinned': pt.pinned,
        }"
        :style="{
          left: `${(pt.x / config.canvasSize) * 100}%`,
          top: `${(pt.y / config.canvasSize) * 100}%`,
          '--pt-color': `rgb(${Math.round(pt.color.r)},${Math.round(pt.color.g)},${Math.round(pt.color.b)})`,
        }"
        :title="`Point (${rowIdx},${colIdx}) — click to edit color`"
        @click.stop="emit('pointClick', rowIdx, colIdx)"
      />
    </template>

    <div class="canvas-toggles">
      <button
        class="toggle-btn"
        :class="{ active: showMeshLines }"
        title="Toggle mesh grid lines"
        @click="showMeshLines = !showMeshLines"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 3h12M1 7h12M1 11h12M3 1v12M7 1v12M11 1v12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      <button
        class="toggle-btn"
        :class="{ active: showPointHandles }"
        title="Toggle mesh point handles"
        @click="showPointHandles = !showPointHandles"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="3.5" cy="3.5" r="1.75" fill="currentColor"/>
          <circle cx="10.5" cy="3.5" r="1.75" fill="currentColor"/>
          <circle cx="7" cy="7" r="1.75" fill="currentColor"/>
          <circle cx="3.5" cy="10.5" r="1.75" fill="currentColor"/>
          <circle cx="10.5" cy="10.5" r="1.75" fill="currentColor"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.canvas-wrapper {
  position: relative;
  display: inline-block;
  border-radius: 50%;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.06),
    0 8px 40px rgba(0, 0, 0, 0.6),
    0 2px 8px rgba(0, 0, 0, 0.4);
  overflow: visible;
}

.mesh-canvas {
  display: block;
  border-radius: 50%;
  width: 100%;
  height: 100%;
}

.mesh-canvas--color {
  cursor: crosshair;
}

.mesh-canvas--overlay {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
}

.point-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.8);
  background: var(--pt-color, #fff);
  cursor: pointer;
  padding: 0;
  transition:
    transform 0.1s ease,
    border-color 0.1s ease,
    box-shadow 0.1s ease;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5), 0 1px 4px rgba(0, 0, 0, 0.6);
  z-index: 10;
}

.point-handle:hover {
  transform: translate(-50%, -50%) scale(1.4);
  border-color: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.8);
}

.point-handle--selected {
  transform: translate(-50%, -50%) scale(1.6);
  border-color: #fff;
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.9),
    0 0 0 4px rgba(0, 0, 0, 0.4),
    0 2px 8px rgba(0, 0, 0, 0.8);
}

.point-handle--pinned::after {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 220, 50, 0.85);
}

.canvas-toggles {
  position: absolute;
  bottom: -44px;
  right: 0;
  display: flex;
  gap: 6px;
  z-index: 11;
}

.toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(30, 30, 36, 0.85);
  color: rgba(255, 255, 255, 0.35);
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}

.toggle-btn:hover {
  background: rgba(50, 50, 60, 0.9);
  color: rgba(255, 255, 255, 0.65);
}

.toggle-btn.active {
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.28);
  background: rgba(50, 50, 58, 0.95);
}
</style>
