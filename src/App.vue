<script setup lang="ts">
import MeshCanvas from './components/MeshCanvas.vue'
import ControlPanel from './components/ControlPanel.vue'
import { useMesh } from './composables/useMesh'
import type { Color, ExportMode, MeshGrid } from './types'

const {
  config,
  grid,
  selectedPoint,
  isRendering,
  renderingLabel,
  gradientRandomize,
  renderVersion,
  randomize,
  reset,
  selectPoint,
  deselectPoint,
  setPointColor,
  unpinPoint,
  setPaletteHue,
  setGradientMapEnabled,
  setGradientMapOffset,
  addGradientStop,
  removeGradientStop,
  moveGradientStop,
  setGradientMidpoint,
  setGradientStopColor,
  randomizeGradient,
  exportAs,
  setRenderMode,
  shapeDefinition,
  shapeLoadError,
} = useMesh()

function onExport(mode: ExportMode, size: number) {
  exportAs(mode, size)
}

function onPointColorChange(color: Color) {
  if (!selectedPoint.value) return
  setPointColor(selectedPoint.value.row, selectedPoint.value.col, color)
}

function onPointUnpin() {
  if (!selectedPoint.value) return
  unpinPoint(selectedPoint.value.row, selectedPoint.value.col)
}

// Click outside canvas deselects
function onBackdropClick() {
  deselectPoint()
}
</script>

<template>
  <div class="app" @click.self="onBackdropClick">
    <!-- Top bar -->
    <header class="topbar">
      <div class="topbar-brand">
        <svg class="brand-icon" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill="url(#brand-grad)"/>
          <defs>
            <radialGradient id="brand-grad" cx="35%" cy="30%">
              <stop offset="0%" stop-color="#FFD700"/>
              <stop offset="50%" stop-color="#E63946"/>
              <stop offset="100%" stop-color="#1D3461"/>
            </radialGradient>
          </defs>
        </svg>
        <span class="brand-name">Orbmaker</span>
      </div>

      <div class="topbar-meta">
        <span class="meta-pill">{{ config.cols }} × {{ config.rows }}</span>
        <span class="meta-pill">{{ config.cols * config.rows }} points</span>
      </div>
    </header>

    <div class="layout">
      <!-- Sidebar -->
      <ControlPanel
        :config="config"
        :grid="(grid as MeshGrid)"
        :selected-point="selectedPoint"
        :is-rendering="isRendering"
        :gradient-randomize="gradientRandomize"
        :shape-load-error="shapeLoadError"
        @randomize="randomize"
        @reset="reset"
        @update:render-mode="setRenderMode"
        @update:cols="config.cols = $event"
        @update:rows="config.rows = $event"
        @update:noiseScale="config.noiseScale = $event"
        @update:noiseSeed="config.noiseSeed = $event"
        @update:noiseOctaves="config.noiseOctaves = $event"
        @update:sphereShading="config.sphereShading = $event"
        @update:sphereLightness="config.sphereLightness = $event"
        @update:sphereShininess="config.sphereShininess = $event"
        @update:colorContrast="config.colorContrast = $event"
        @update:blur-gaussian="config.blur.gaussian = $event"
        @update:blur-motion="config.blur.motion = $event"
        @update:blur-motion-axis="config.blur.motionAxis = $event"
        @update:blur-rotation="config.blur.rotation = $event"
        @update:blur-grain="config.blur.grain = $event"
        @palette:hue="(idx: 0|1|2, c: Color) => setPaletteHue(idx, c)"
        @gradient:enabled="setGradientMapEnabled"
        @gradient:offset="setGradientMapOffset"
        @gradient:stop:add="(pos, c) => addGradientStop(pos, c)"
        @gradient:stop:remove="removeGradientStop"
        @gradient:stop:move="(id, pos) => moveGradientStop(id, pos)"
        @gradient:midpoint:move="(l, r, v) => setGradientMidpoint(l, r, v)"
        @gradient:stop:color="(id, c) => setGradientStopColor(id, c)"
        @gradient:randomize="randomizeGradient"
        @point:color="onPointColorChange"
        @point:unpin="onPointUnpin"
        @export="(mode: ExportMode, size: number) => onExport(mode, size)"
      />

      <!-- Canvas area -->
      <main class="canvas-area" @click.self="deselectPoint">
        <div class="canvas-stage">
          <MeshCanvas
            :grid="(grid as MeshGrid)"
            :config="config"
            :selected-point="selectedPoint"
            :render-version="renderVersion"
            :shape-definition="shapeDefinition"
            @point-click="selectPoint"
            @point-color-change="setPointColor"
          />
        </div>

        <!-- Rendering overlay -->
        <Transition name="fade">
          <div v-if="isRendering" class="rendering-overlay">
            <div class="spinner" />
            <span>{{ renderingLabel }}</span>
          </div>
        </Transition>
      </main>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: #0e0e14;
  color: #fff;
  overflow: hidden;
}

/* Top bar */
.topbar {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: rgba(12, 12, 18, 0.95);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  flex-shrink: 0;
  z-index: 20;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-icon {
  width: 26px;
  height: 26px;
}

.brand-name {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: rgba(255, 255, 255, 0.92);
}

.topbar-meta {
  display: flex;
  gap: 8px;
}

.meta-pill {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 2px 8px;
  border-radius: 20px;
}

/* Layout */
.layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Canvas area */
.canvas-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background:
    radial-gradient(ellipse 80% 80% at 50% 50%, rgba(37, 99, 235, 0.04) 0%, transparent 70%),
    repeating-conic-gradient(rgba(255,255,255,0.015) 0% 25%, transparent 0% 50%)
      0 0 / 28px 28px;
  overflow: auto;
  padding: 60px;
}

.canvas-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  /* 2.5× display scale (600px logical → 1500px max) */
  max-width: min(1500px, calc((100vw - 420px) * 2.5));
  max-height: min(1500px, calc((100vh - 100px) * 2.5));
  width: min(1500px, calc(600px * 2.5));
  aspect-ratio: 1;
}

/* Rendering overlay */
.rendering-overlay {
  position: absolute;
  inset: 0;
  background: rgba(10, 10, 16, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(4px);
}

.spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-top-color: rgba(255, 255, 255, 0.8);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
