/**
 * Orbmaker — application defaults
 *
 * Edit values in this file to change startup defaults across the app.
 * Restart the dev server after saving.
 */

import type { BlurConfig, GradientMapConfig, MeshConfig, MeshPalette, RenderMode } from '../types'
import { rgb, newStopId } from '../utils/color'

// ---------------------------------------------------------------------------
// Mesh & canvas
// ---------------------------------------------------------------------------

export const DEFAULT_MESH = {
  cols: 25,
  rows: 25,
  canvasSize: 600,
} as const

export const DEFAULT_RENDER_MODE: RenderMode = 'sphere'
export const DEFAULT_SVG_SHAPE_URL = '/shapes/v2-type.svg'

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

export const DEFAULT_NOISE = {
  noiseScale: 1.4,
  noiseSeed: 42,
  noiseOctaves: 3,
} as const

// ---------------------------------------------------------------------------
// Lighting (0 = off)
// ---------------------------------------------------------------------------

export const DEFAULT_LIGHTING = {
  sphereShading: 0,
  sphereLightness: 0,
  sphereShininess: 0,
} as const

// ---------------------------------------------------------------------------
// Gradient map & mesh color
// ---------------------------------------------------------------------------

export const DEFAULT_APPEARANCE = {
  colorContrast: 0.55,
} as const

/** Three mesh palette swatches (black, grey, white). */
export const DEFAULT_PALETTE_HUES = [
  { r: 0, g: 0, b: 0 },
  { r: 128, g: 128, b: 128 },
  { r: 255, g: 255, b: 255 },
] as const

export const DEFAULT_GRADIENT_MAP_SETTINGS = {
  enabled: true,
  offset: 0,
  /** Stop colors and positions along the gradient (0–1). */
  stops: [
    { color: { r: 0, g: 0, b: 0 }, position: 0 },
    { color: { r: 220, g: 38, b: 38 }, position: 0.25 },
    { color: { r: 234, g: 179, b: 8 }, position: 0.5 },
    { color: { r: 37, g: 99, b: 235 }, position: 0.75 },
    { color: { r: 255, g: 255, b: 255 }, position: 1 },
  ],
} as const

// ---------------------------------------------------------------------------
// Effects (blur & grain)
// ---------------------------------------------------------------------------

export const DEFAULT_EFFECTS = {
  gaussian: 0,
  motion: 0,
  motionAxis: 'horizontal' as const,
  /** Rotational blur amount at startup (0.03 = 3%). */
  rotation: 0.03,
  grain: 0.1,
} as const

/** Gradient randomize checkboxes (Reds / Greens / Blues). */
export const DEFAULT_GRADIENT_RANDOMIZE = {
  reds: true,
  greens: true,
  blues: true,
} as const

// ---------------------------------------------------------------------------
// Blur renderer tuning (internal — affects quality, not UI sliders)
// ---------------------------------------------------------------------------

export const BLUR_RENDER_TUNING = {
  gaussianSizeScale: 0.06,
  motionSizeScale: 0.2,
  motionMinPixels: 2,
  rotational: {
    /** Apply rotational blur when slider is above this (0.03 passes at 3%). */
    minStrength: 0.005,
    /** Max arc sweep in radians at slider = 100% (lower = finer per %). */
    angleSpanAtFull: Math.PI / 5,
    minSampleSteps: 14,
    /** Sample count scales with strength × this value. */
    sampleStepsScale: 80,
    arcOffsetJitter: 0.45,
    radiusJitterPx: 0.2,
    weightFalloff: 1.15,
  },
} as const

// ---------------------------------------------------------------------------
// Built config objects (used by the app)
// ---------------------------------------------------------------------------

export function createDefaultPalette(): MeshPalette {
  const hues = DEFAULT_PALETTE_HUES.map((c) => rgb(c.r, c.g, c.b)) as [
    ReturnType<typeof rgb>,
    ReturnType<typeof rgb>,
    ReturnType<typeof rgb>,
  ]
  return { hues }
}

export const DEFAULT_PALETTE = createDefaultPalette()

export function createDefaultGradientMap(): GradientMapConfig {
  return {
    enabled: DEFAULT_GRADIENT_MAP_SETTINGS.enabled,
    offset: DEFAULT_GRADIENT_MAP_SETTINGS.offset,
    midpoints: {},
    stops: DEFAULT_GRADIENT_MAP_SETTINGS.stops.map((s) => ({
      id: newStopId(),
      color: rgb(s.color.r, s.color.g, s.color.b),
      position: s.position,
    })),
  }
}

export const DEFAULT_GRADIENT_MAP = createDefaultGradientMap()

export function createDefaultBlurConfig(): BlurConfig {
  return { ...DEFAULT_EFFECTS }
}

export function createDefaultMeshConfig(): MeshConfig {
  return {
    ...DEFAULT_MESH,
    ...DEFAULT_NOISE,
    ...DEFAULT_LIGHTING,
    ...DEFAULT_APPEARANCE,
    palette: DEFAULT_PALETTE,
    gradientMap: DEFAULT_GRADIENT_MAP,
    blur: createDefaultBlurConfig(),
    renderMode: DEFAULT_RENDER_MODE,
  }
}

export const DEFAULT_MESH_CONFIG = createDefaultMeshConfig()
