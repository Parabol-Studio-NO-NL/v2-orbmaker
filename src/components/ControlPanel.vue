<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MeshConfig, MeshGrid, Color, ExportMode, RenderMode } from '../types'
import ColorSwatch from './ColorSwatch.vue'
import GradientMapEditor from './GradientMapEditor.vue'

const props = defineProps<{
  config: MeshConfig
  grid: MeshGrid
  selectedPoint: { row: number; col: number } | null
  isRendering: boolean
  gradientRandomize: { reds: boolean; greens: boolean; blues: boolean }
  shapeLoadError?: string | null
}>()

const emit = defineEmits<{
  randomize: []
  reset: []
  'update:cols': [v: number]
  'update:rows': [v: number]
  'update:noiseScale': [v: number]
  'update:noiseSeed': [v: number]
  'update:noiseOctaves': [v: number]
  'update:sphereShading': [v: number]
  'update:sphereLightness': [v: number]
  'update:sphereShininess': [v: number]
  'update:colorContrast': [v: number]
  'update:blurGaussian': [v: number]
  'update:blurMotion': [v: number]
  'update:blurMotionAxis': [v: 'horizontal' | 'vertical']
  'update:blurRotation': [v: number]
  'update:blurGrain': [v: number]
  'palette:hue': [index: 0 | 1 | 2, color: Color]
  'gradient:enabled': [v: boolean]
  'gradient:offset': [v: number]
  'gradient:stop:add': [position: number, color: Color]
  'gradient:midpoint:move': [leftId: string, rightId: string, value: number]
  'gradient:stop:remove': [id: string]
  'gradient:stop:move': [id: string, position: number]
  'gradient:stop:color': [id: string, color: Color]
  'gradient:randomize': []
  'point:color': [color: Color]
  'point:unpin': []
  'export': [mode: ExportMode, size: number]
  'update:renderMode': [mode: RenderMode]
}>()

// ---------------------------------------------------------------------------
// Computed helpers
// ---------------------------------------------------------------------------

const selectedPt = computed(() => {
  if (!props.selectedPoint) return null
  return props.grid.points[props.selectedPoint.row]?.[props.selectedPoint.col] ?? null
})

// Labels
const hueLabels = ['Black', 'Grey', 'White']

// Export resolution
const exportSize = ref<1200 | 4000>(1200)

// ---------------------------------------------------------------------------
// Local slider model helpers (v-model with emit)
// ---------------------------------------------------------------------------

function numInput(key: 'cols' | 'rows' | 'noiseScale' | 'noiseSeed' | 'noiseOctaves' | 'sphereShading') {
  return {
    value: props.config[key],
    onInput: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value)
      emit(`update:${key}` as any, v)
    },
  }
}
</script>

<template>
  <aside class="panel">
    <div class="panel-header">
      <span class="panel-title">Controls</span>
    </div>

    <!-- ── Shape mode ── -->
    <section class="panel-section">
      <h3 class="section-title">Shape</h3>
      <div class="motion-axis-toggle">
        <button
          type="button"
          class="axis-btn"
          :class="{ 'axis-btn--active': config.renderMode === 'sphere' }"
          @click="emit('update:renderMode', 'sphere')"
        >
          Orb
        </button>
        <button
          type="button"
          class="axis-btn"
          :class="{ 'axis-btn--active': config.renderMode === 'svg' }"
          @click="emit('update:renderMode', 'svg')"
        >
          v2_ Logotype
        </button>
      </div>
      <p v-if="shapeLoadError" class="export-hint export-hint--warn">{{ shapeLoadError }}</p>
    </section>

    <!-- ── Mesh density ── -->
    <section class="panel-section">
      <h3 class="section-title">Mesh Density</h3>

      <div class="control-row">
        <label class="control-label">
          Columns
          <span class="control-value">{{ config.cols }}</span>
        </label>
        <input
          type="range" min="2" max="50" step="1"
          :value="config.cols"
          class="slider"
          @input="emit('update:cols', Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <div class="control-row">
        <label class="control-label">
          Rows
          <span class="control-value">{{ config.rows }}</span>
        </label>
        <input
          type="range" min="2" max="50" step="1"
          :value="config.rows"
          class="slider"
          @input="emit('update:rows', Number(($event.target as HTMLInputElement).value))"
        />
      </div>

    </section>

    <!-- ── Noise ── -->
    <section class="panel-section">
      <h3 class="section-title">Noise</h3>

      <div class="control-row">
        <label class="control-label">
          Scale
          <span class="control-value">{{ config.noiseScale.toFixed(2) }}</span>
        </label>
        <input
          type="range" min="0.2" max="4" step="0.05"
          :value="config.noiseScale"
          class="slider"
          @input="emit('update:noiseScale', Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <div class="control-row">
        <label class="control-label">
          Octaves
          <span class="control-value">{{ config.noiseOctaves }}</span>
        </label>
        <input
          type="range" min="1" max="6" step="1"
          :value="config.noiseOctaves"
          class="slider"
          @input="emit('update:noiseOctaves', Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <div class="control-row">
        <label class="control-label">
          Seed
          <span class="control-value">{{ config.noiseSeed }}</span>
        </label>
        <input
          type="range" min="0" max="99999" step="1"
          :value="config.noiseSeed"
          class="slider"
          @input="emit('update:noiseSeed', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </section>

    <!-- ── Lighting & appearance ── -->
    <section
      class="panel-section"
      :class="{ 'panel-section--disabled': config.renderMode === 'svg' }"
    >
      <h3 class="section-title">Lighting</h3>
      <p v-if="config.renderMode === 'svg'" class="export-hint">
        Lighting applies in Orb mode only.
      </p>
      <div class="control-row">
        <label class="control-label">
          Shading
          <span class="control-value">{{ Math.round(config.sphereShading * 100) }}%</span>
        </label>
        <input
          type="range" min="0" max="1" step="0.02"
          :value="config.sphereShading"
          class="slider"
          :disabled="config.renderMode === 'svg'"
          @input="emit('update:sphereShading', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <div class="control-row">
        <label class="control-label">
          Lightness
          <span class="control-value">{{ Math.round(config.sphereLightness * 100) }}%</span>
        </label>
        <input
          type="range" min="0" max="1" step="0.02"
          :value="config.sphereLightness"
          class="slider"
          :disabled="config.renderMode === 'svg'"
          @input="emit('update:sphereLightness', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <div class="control-row">
        <label class="control-label">
          Shininess
          <span class="control-value">{{ Math.round(config.sphereShininess * 100) }}%</span>
        </label>
        <input
          type="range" min="0" max="1" step="0.02"
          :value="config.sphereShininess"
          class="slider"
          :disabled="config.renderMode === 'svg'"
          @input="emit('update:sphereShininess', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </section>

    <!-- ── Gradient map ── -->
    <section class="panel-section">
      <div class="section-heading">
        <h3 class="section-title">Gradient Map</h3>
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          title="Randomize gradient using enabled hue groups (4–7 stops)"
          @click="emit('gradient:randomize')"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="16 3 21 3 21 8"/>
            <line x1="4" y1="20" x2="21" y2="3"/>
            <polyline points="21 16 21 21 16 21"/>
            <line x1="15" y1="15" x2="21" y2="21"/>
          </svg>
          Randomize
        </button>
      </div>
      <div class="randomize-options">
        <label class="randomize-check">
          <input
            v-model="gradientRandomize.reds"
            type="checkbox"
            class="enable-check"
          />
          <span>Reds</span>
        </label>
        <label class="randomize-check">
          <input
            v-model="gradientRandomize.greens"
            type="checkbox"
            class="enable-check"
          />
          <span>Greens</span>
        </label>
        <label class="randomize-check">
          <input
            v-model="gradientRandomize.blues"
            type="checkbox"
            class="enable-check"
          />
          <span>Blues</span>
        </label>
      </div>
      <p class="randomize-hint">
        Stops are grouped by hue (~⅓ each when all three are on).
      </p>
      <GradientMapEditor
        :gradient-map="config.gradientMap"
        @update:enabled="emit('gradient:enabled', $event)"
        @stop:add="(pos, c) => emit('gradient:stop:add', pos, c)"
        @stop:remove="emit('gradient:stop:remove', $event)"
        @stop:move="(id, pos) => emit('gradient:stop:move', id, pos)"
        @stop:color="(id, c) => emit('gradient:stop:color', id, c)"
        @midpoint:move="(l, r, v) => emit('gradient:midpoint:move', l, r, v)"
      />

      <div class="gradient-tuning">
        <div class="control-row">
          <label class="control-label">
            Color Contrast
            <span class="control-value">{{ Math.round(config.colorContrast * 100) }}%</span>
          </label>
          <input
            type="range" min="0" max="1" step="0.02"
            :value="config.colorContrast"
            class="slider slider--contrast"
            @input="emit('update:colorContrast', Number(($event.target as HTMLInputElement).value))"
          />
        </div>
        <div class="control-row">
          <label class="control-label">
            Offset
            <span class="control-value">{{ config.gradientMap.offset.toFixed(2) }}</span>
          </label>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            :value="config.gradientMap.offset"
            class="slider"
            :disabled="!config.gradientMap.enabled"
            @input="emit('gradient:offset', Number(($event.target as HTMLInputElement).value))"
          />
        </div>
      </div>
    </section>

    <!-- ── Effects ── -->
    <section class="panel-section">
      <h3 class="section-title">Effects</h3>

      <div class="control-row">
        <label class="control-label">
          Gaussian Blur
          <span class="control-value">{{ Math.round(config.blur.gaussian * 100) }}%</span>
        </label>
        <input
          type="range" min="0" max="1" step="0.01"
          :value="config.blur.gaussian"
          class="slider"
          @input="emit('update:blurGaussian', Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <div class="control-row">
        <label class="control-label">
          Motion Blur
          <span class="control-value">{{ Math.round(config.blur.motion * 100) }}%</span>
        </label>
        <input
          type="range" min="0" max="1" step="0.01"
          :value="config.blur.motion"
          class="slider"
          @input="emit('update:blurMotion', Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <div v-if="config.blur.motion > 0" class="motion-axis-toggle">
        <button
          type="button"
          class="axis-btn"
          :class="{ 'axis-btn--active': config.blur.motionAxis === 'horizontal' }"
          @click="emit('update:blurMotionAxis', 'horizontal')"
        >
          Horizontal
        </button>
        <button
          type="button"
          class="axis-btn"
          :class="{ 'axis-btn--active': config.blur.motionAxis === 'vertical' }"
          @click="emit('update:blurMotionAxis', 'vertical')"
        >
          Vertical
        </button>
      </div>

      <div class="control-row">
        <label class="control-label">
          Rotational Blur
          <span class="control-value">{{ Math.round(config.blur.rotation * 100) }}%</span>
        </label>
        <input
          type="range" min="0" max="1" step="0.01"
          :value="config.blur.rotation"
          class="slider"
          @input="emit('update:blurRotation', Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <div class="control-row">
        <label class="control-label">
          Grain
          <span class="control-value">{{ Math.round(config.blur.grain * 100) }}%</span>
        </label>
        <input
          type="range" min="0" max="1" step="0.01"
          :value="config.blur.grain"
          class="slider"
          @input="emit('update:blurGrain', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </section>

    <!-- ── Color palette ── -->
    <section class="panel-section">
      <h3 class="section-title">Color Palette</h3>

      <div class="palette-grid palette-grid--3">
        <ColorSwatch
          v-for="(hue, i) in (config.palette.hues as [Color, Color, Color])"
          :key="i"
          :color="hue"
          :label="hueLabels[i]"
          size="sm"
          @change="emit('palette:hue', (i as 0|1|2), $event)"
        />
      </div>
    </section>

    <!-- ── Selected point editor ── -->
    <section v-if="selectedPt" class="panel-section point-editor">
      <h3 class="section-title">
        Point ({{ selectedPoint!.row }}, {{ selectedPoint!.col }})
        <span v-if="selectedPt.pinned" class="pinned-badge">pinned</span>
      </h3>

      <div class="point-color-row">
        <ColorSwatch
          :color="selectedPt.color"
          label="Color"
          @change="emit('point:color', $event)"
        />
        <button
          v-if="selectedPt.pinned"
          class="btn btn--ghost btn--sm"
          title="Remove pin and restore noise color"
          @click="emit('point:unpin')"
        >
          Restore
        </button>
      </div>
    </section>

    <!-- ── Actions ── -->
    <section class="panel-section actions">
      <h3 class="section-title">Actions</h3>

      <div class="action-row">
        <button class="btn btn--primary" @click="emit('randomize')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="16 3 21 3 21 8"/>
            <line x1="4" y1="20" x2="21" y2="3"/>
            <polyline points="21 16 21 21 16 21"/>
            <line x1="15" y1="15" x2="21" y2="21"/>
          </svg>
          Randomize
        </button>
        <button class="btn btn--ghost" @click="emit('reset')">
          Reset
        </button>
      </div>
    </section>

    <!-- ── Export ── -->
    <section class="panel-section">
      <h3 class="section-title">Export</h3>

      <!-- Resolution toggle -->
      <div class="res-toggle">
        <button
          class="res-btn"
          :class="{ 'res-btn--active': exportSize === 1200 }"
          @click="exportSize = 1200"
        >1200 px</button>
        <button
          class="res-btn"
          :class="{ 'res-btn--active': exportSize === 4000 }"
          @click="exportSize = 4000"
        >4K · 4000 px</button>
      </div>

      <div class="action-row">
        <button
          class="btn btn--export btn--export-png"
          :disabled="isRendering"
          @click="emit('export', 'png', exportSize)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 21V9"/>
          </svg>
          PNG
        </button>
        <button
          class="btn btn--export"
          :disabled="isRendering"
          @click="emit('export', 'raster', exportSize)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          SVG
        </button>
        <button
          class="btn btn--export btn--export-vector"
          :disabled="isRendering"
          @click="emit('export', 'vector', exportSize)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
          </svg>
          Vector
        </button>
      </div>
      <p class="export-hint">
        PNG · SVG (PNG-in-SVG) · Vector (pure paths, Illustrator-ready)<br>
        <span v-if="exportSize === 4000" class="export-hint--warn">4K renders may take a few seconds.</span>
      </p>
    </section>
  </aside>
</template>

<style scoped>
.panel {
  width: 400px;
  flex-shrink: 0;
  background: rgba(18, 18, 24, 0.92);
  border-right: 1px solid rgba(255, 255, 255, 0.07);
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.panel-header {
  padding: 20px 20px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.panel-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.35);
}

/* Section */
.panel-section {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.section-heading .section-title {
  margin-bottom: 0;
}

.randomize-options {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-bottom: 8px;
}

.randomize-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  user-select: none;
}

.randomize-check input {
  accent-color: #3b82f6;
}

.randomize-hint {
  margin: 0 0 12px;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.35);
}

.gradient-tuning {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Controls */
.control-row {
  margin-bottom: 10px;
}

.control-row:last-child {
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

/* Slider */
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

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  cursor: pointer;
  transition: transform 0.1s;
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
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

/* Palette */
.palette-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.palette-grid--3 {
  grid-template-columns: 1fr 1fr 1fr;
}

/* Point editor */
.point-editor {
  background: rgba(255, 255, 255, 0.02);
}

.point-color-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pinned-badge {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 220, 50, 0.8);
  border: 1px solid rgba(255, 220, 50, 0.35);
  padding: 1px 6px;
  border-radius: 4px;
}

/* Actions */
.actions {}

.action-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
  white-space: nowrap;
}

.btn--primary {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.btn--primary:hover {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.25);
}

.btn--ghost {
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.75);
}

.btn--sm {
  padding: 5px 10px;
  font-size: 11px;
}

.btn--export {
  flex: 1;
  justify-content: center;
  background: rgba(37, 99, 235, 0.2);
  color: rgba(147, 197, 253, 0.9);
  border: 1px solid rgba(37, 99, 235, 0.35);
}

.btn--export:hover:not(:disabled) {
  background: rgba(37, 99, 235, 0.35);
  border-color: rgba(37, 99, 235, 0.6);
}

.btn--export-png {
  background: rgba(16, 185, 129, 0.2);
  color: rgba(110, 231, 183, 0.9);
  border-color: rgba(16, 185, 129, 0.35);
}

.btn--export-png:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.35);
  border-color: rgba(16, 185, 129, 0.6);
}

.btn--export-vector {
  background: rgba(124, 58, 237, 0.2);
  color: rgba(196, 181, 253, 0.9);
  border-color: rgba(124, 58, 237, 0.35);
}

.btn--export-vector:hover:not(:disabled) {
  background: rgba(124, 58, 237, 0.35);
  border-color: rgba(124, 58, 237, 0.6);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.export-hint {
  margin-top: 10px;
  font-size: 10.5px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.28);
}

.export-hint--warn {
  color: rgba(251, 191, 36, 0.6);
}

/* Resolution toggle */
.motion-axis-toggle {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}

.axis-btn {
  flex: 1;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}

.axis-btn:hover {
  color: rgba(255, 255, 255, 0.65);
}

.axis-btn--active {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.22);
}

.panel-section--disabled .slider:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.res-toggle {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 3px;
}

.res-btn {
  flex: 1;
  padding: 5px 6px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.res-btn:hover {
  color: rgba(255, 255, 255, 0.65);
}

.res-btn--active {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
</style>
