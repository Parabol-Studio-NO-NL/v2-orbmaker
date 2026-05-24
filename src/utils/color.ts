import type { Color, GradientMapConfig, MeshPalette, PaletteStop } from '../types'
import { applyMidpointCurve, segmentKey } from './gradientMidpoint'
import { hsvToColor } from './hsv'
import { applySphereLightingRgb, computeSphereShadeFactor } from './sphereLighting'

// ---------------------------------------------------------------------------
// Basic constructors
// ---------------------------------------------------------------------------

export function rgb(r: number, g: number, b: number, a = 255): Color {
  return { r, g, b, a }
}

export const BLACK: Color = rgb(0, 0, 0)
export const WHITE: Color = rgb(255, 255, 255)

let stopIdCounter = 0
export function newStopId(): string {
  return `stop-${++stopIdCounter}`
}


// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/** Parse a CSS hex string (#RRGGBB or #RGB) into a Color. */
export function hexToColor(hex: string): Color {
  const h = hex.replace('#', '')
  if (h.length === 3) {
    return rgb(
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    )
  }
  return rgb(
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  )
}

/** Convert a Color to a CSS #RRGGBB hex string. */
export function colorToHex(c: Color): string {
  return (
    '#' +
    [c.r, c.g, c.b]
      .map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'))
      .join('')
  )
}

/** Convert a Color to a CSS rgba() string. */
export function colorToCss(c: Color): string {
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${(c.a / 255).toFixed(3)})`
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** Smooth-step easing for [0, 1] */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Smoother step (Ken Perlin's 6t^5 - 15t^4 + 10t^3) */
export function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

// ---------------------------------------------------------------------------
// Color interpolation
// ---------------------------------------------------------------------------

/** Linear interpolate between two colors by t ∈ [0, 1]. */
export function lerpColor(a: Color, b: Color, t: number): Color {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  }
}

/** Smooth-step lerp — softer transitions between palette stops. */
export function smoothLerpColor(a: Color, b: Color, t: number): Color {
  return lerpColor(a, b, smootherstep(t))
}

/** Bilinear interpolation across a 2×2 colour quad.
 *  tu and tv are both in [0, 1] within the cell.
 *  Order: tl = top-left, tr = top-right, bl = bottom-left, br = bottom-right */
export function bilerp(
  tl: Color,
  tr: Color,
  bl: Color,
  br: Color,
  tu: number,
  tv: number,
): Color {
  const top = lerpColor(tl, tr, tu)
  const bot = lerpColor(bl, br, tu)
  return lerpColor(top, bot, tv)
}

// ---------------------------------------------------------------------------
// Palette sampling
// ---------------------------------------------------------------------------

/**
 * Build a sorted array of PaletteStops from a MeshPalette.
 * Three stops evenly spaced at 0, 0.5, 1.
 */
export function buildPaletteStops(palette: MeshPalette): PaletteStop[] {
  return [
    { id: newStopId(), color: palette.hues[0], position: 0.0 },
    { id: newStopId(), color: palette.hues[1], position: 0.5 },
    { id: newStopId(), color: palette.hues[2], position: 1.0 },
  ]
}

/**
 * Snap a noise value in [0, 1] to the nearest solid palette color.
 *
 * The noise range is divided into equal thirds:
 *   [0,   0.33) → hues[0]
 *   [0.33, 0.67) → hues[1]
 *   [0.67, 1.0]  → hues[2]
 *
 * Grid points therefore always carry one of exactly 3 pure colors.
 * Gradients emerge from the bilinear interpolation between adjacent points
 * during pixel rendering — no mixing happens at the point level itself.
 */
export function snapToNearestPaletteColor(noiseValue: number, palette: MeshPalette): Color {
  const n = palette.hues.length
  const idx = Math.min(Math.floor(noiseValue * n), n - 1)
  return { ...palette.hues[idx] }
}

/**
 * Sample the palette at position t ∈ [0, 1].
 * Uses smooth interpolation between adjacent stops.
 */
export function sortStops(stops: PaletteStop[]): PaletteStop[] {
  return [...stops].sort((a, b) => a.position - b.position)
}

/** Sample pre-sorted stops at t (no sort — for UI / LUT build). */
export function samplePaletteSorted(
  sorted: PaletteStop[],
  t: number,
  midpoints: Record<string, number> = {},
): Color {
  if (sorted.length === 0) return BLACK
  if (sorted.length === 1) return { ...sorted[0].color }

  t = clamp(t, 0, 1)

  let lo = sorted[0]
  let hi = sorted[sorted.length - 1]
  let segMid = 0.5

  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].position && t <= sorted[i + 1].position) {
      lo = sorted[i]
      hi = sorted[i + 1]
      const key = `${lo.id}|${hi.id}`
      segMid = clamp(midpoints[key] ?? 0.5, 0.05, 0.95)
      break
    }
  }

  const range = hi.position - lo.position
  const localT = range === 0 ? 0 : (t - lo.position) / range
  const curved = applyMidpointCurve(localT, segMid)

  return smoothLerpColor(lo.color, hi.color, curved)
}

export function samplePalette(
  stops: PaletteStop[],
  t: number,
  midpoints: Record<string, number> = {},
): Color {
  if (stops.length === 0) return BLACK
  if (stops.length === 1) return { ...stops[0].color }
  return samplePaletteSorted(sortStops(stops), t, midpoints)
}

const MIN_STOP_GAP = 0.02

/** Clamp stop position between neighbors with a minimum gap. */
export function clampStopPosition(
  stops: PaletteStop[],
  id: string,
  position: number,
): number {
  const sorted = sortStops(stops)
  const idx = sorted.findIndex((s) => s.id === id)
  if (idx < 0) return clamp(position, 0, 1)

  const minPos = idx === 0 ? 0 : sorted[idx - 1].position + MIN_STOP_GAP
  const maxPos = idx === sorted.length - 1 ? 1 : sorted[idx + 1].position - MIN_STOP_GAP
  return clamp(position, minPos, maxPos)
}

export function addStopAt(
  stops: PaletteStop[],
  position: number,
  color?: Color,
  midpoints: Record<string, number> = {},
): PaletteStop[] {
  const t = clamp(position, 0, 1)
  const c = color ?? samplePalette(stops, t, midpoints)
  const next = [...stops, { id: newStopId(), color: { ...c }, position: t }]
  return sortStops(next)
}

export function removeStop(stops: PaletteStop[], id: string): PaletteStop[] {
  if (stops.length <= 2) return stops
  return stops.filter((s) => s.id !== id)
}

export function moveStop(
  stops: PaletteStop[],
  id: string,
  position: number,
): PaletteStop[] {
  const clamped = clampStopPosition(stops, id, position)
  return sortStops(
    stops.map((s) => (s.id === id ? { ...s, position: clamped } : s)),
  )
}

const GRADIENT_STOP_COUNT_MIN = 4
const GRADIENT_STOP_COUNT_MAX = 7
const MIDPOINT_RANDOM_MIN = 0.08
const MIDPOINT_RANDOM_MAX = 0.92

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export type HueFamily = 'red' | 'green' | 'blue'

export interface GradientRandomizeOptions {
  enabled?: boolean
  reds?: boolean
  greens?: boolean
  blues?: boolean
}

const HUE_FAMILY_CENTER: Record<HueFamily, number> = {
  red: 0,
  green: 120,
  blue: 220,
}

function randomColorInHueFamily(family: HueFamily): Color {
  const base = HUE_FAMILY_CENTER[family]
  return hsvToColor({
    h: base + randomInRange(-28, 28),
    s: randomInRange(0.55, 1),
    v: randomInRange(0.35, 0.95),
  })
}

function activeHueFamilies(options: GradientRandomizeOptions): HueFamily[] {
  const families: HueFamily[] = []
  if (options.reds !== false) families.push('red')
  if (options.greens !== false) families.push('green')
  if (options.blues !== false) families.push('blue')
  return families.length > 0 ? families : ['red', 'green', 'blue']
}

/** Split stop indices across families (~equal thirds when all three are on). */
function familyForStopIndex(
  index: number,
  count: number,
  families: HueFamily[],
): HueFamily {
  const slot = Math.min(Math.floor((index / count) * families.length), families.length - 1)
  return families[slot]
}

function buildRandomStopColors(count: number, options: GradientRandomizeOptions): Color[] {
  const families = activeHueFamilies(options)
  return Array.from({ length: count }, (_, i) =>
    randomColorInHueFamily(familyForStopIndex(i, count, families)),
  )
}

/** Evenly spaced stop positions with jitter, respecting MIN_STOP_GAP. */
function buildRandomStopPositions(count: number): number[] {
  const positions: number[] = [0]
  let prev = 0
  for (let i = 1; i < count - 1; i++) {
    const remaining = count - i - 1
    const minPos = prev + MIN_STOP_GAP
    const maxPos = 1 - remaining * MIN_STOP_GAP
    const pos = randomInRange(minPos, maxPos)
    positions.push(pos)
    prev = pos
  }
  positions.push(1)
  return positions
}

/** Random gradient map: 4–7 stops, hue-grouped colors, varied positions and blend midpoints. */
export function buildRandomGradientMap(
  options: GradientRandomizeOptions = {},
): GradientMapConfig {
  const count =
    GRADIENT_STOP_COUNT_MIN +
    Math.floor(Math.random() * (GRADIENT_STOP_COUNT_MAX - GRADIENT_STOP_COUNT_MIN + 1))
  const positions = buildRandomStopPositions(count)
  const colors = buildRandomStopColors(count, options)
  const stops: PaletteStop[] = positions.map((position, i) => ({
    id: newStopId(),
    color: colors[i],
    position,
  }))
  const sorted = sortStops(stops)
  const midpoints: Record<string, number> = {}
  for (let i = 0; i < sorted.length - 1; i++) {
    const key = segmentKey(sorted[i].id, sorted[i + 1].id)
    midpoints[key] = clamp(
      randomInRange(MIDPOINT_RANDOM_MIN, MIDPOINT_RANDOM_MAX),
      0.05,
      0.95,
    )
  }
  return {
    enabled: options.enabled ?? true,
    offset: randomInRange(-0.75, 0.75),
    stops: sorted,
    midpoints,
  }
}

/** Relative luminance of a color, normalised to [0, 1]. */
export function colorLuminance(c: Color): number {
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255
}

/** Remap mesh color through the gradient map LUT (Photoshop-style). */
export function applyGradientMap(
  meshColor: Color,
  u: number,
  gradientMap: GradientMapConfig,
): Color {
  if (!gradientMap.enabled || gradientMap.stops.length < 2) return meshColor

  const luma = colorLuminance(meshColor)
  const spatial = gradientMap.offset * (u * 2 - 1)
  const mapT = clamp(luma + spatial, 0, 1)
  return samplePalette(gradientMap.stops, mapT, gradientMap.midpoints)
}

/** CSS linear-gradient string for previewing stops in the UI (midpoint-aware). */
export function stopsToCssGradient(
  stops: PaletteStop[],
  midpoints: Record<string, number> = {},
  samples = 24,
): string {
  const sorted = sortStops(stops)
  if (sorted.length === 0) return 'linear-gradient(to right, #000, #fff)'
  if (sorted.length === 1) {
    const hex = colorToHex(sorted[0].color)
    return `linear-gradient(to right, ${hex}, ${hex})`
  }

  const parts: string[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const c = samplePaletteSorted(sorted, t, midpoints)
    parts.push(`${colorToHex(c)} ${(t * 100).toFixed(1)}%`)
  }
  return `linear-gradient(to right, ${parts.join(', ')})`
}

/**
 * Given a noise value (already in [0, 1]) sample the palette.
 * The noise value is slightly remapped so the base color appears more at
 * the edges (low noise) and hue colours towards the centre.
 */
export function noiseToColor(noiseValue: number, stops: PaletteStop[]): Color {
  return samplePalette(stops, noiseValue)
}

// ---------------------------------------------------------------------------
// Color contrast sharpening
// ---------------------------------------------------------------------------

/**
 * Push a normalised value t ∈ [0,1] away from 0.5 toward the extremes.
 *
 * contrast = 0 → identity (no change)
 * contrast = 1 → extreme: values cluster near 0 or 1 (harsh colour jumps)
 *
 * Uses a signed-power curve: sign(s) * |s|^exponent where s = t*2-1.
 * As contrast increases the exponent drops below 1, which flattens the mid-range
 * and steepens the transition.
 */
export function applyContrast(t: number, contrast: number): number {
  if (contrast <= 0) return t
  const s = t * 2 - 1
  const exponent = Math.max(0.04, 1 - contrast * 0.92)
  const contrasted = Math.sign(s) * Math.pow(Math.abs(s), exponent)
  return (contrasted + 1) / 2
}

// ---------------------------------------------------------------------------
// Sphere shading overlay
// ---------------------------------------------------------------------------

/**
 * Shading factor for a sphere surface point (1 = highlight, 0 = shadow).
 * @param lightness 0–1 ambient lift / shadow softness
 * @param shininess 0–1 specular intensity
 */
export function sphereShading(
  nx: number,
  ny: number,
  lightness = 0.4,
  shininess = 0.35,
): number {
  return computeSphereShadeFactor(nx, ny, lightness, shininess)
}

/** Blend a mesh color with sphere lighting. */
export function applySphereShading(
  meshColor: Color,
  nx: number,
  ny: number,
  strength: number,
  lightness = 0.4,
  shininess = 0.35,
): Color {
  if (strength <= 0) return meshColor
  const lit = applySphereLightingRgb(
    meshColor.r,
    meshColor.g,
    meshColor.b,
    nx,
    ny,
    strength,
    lightness,
    shininess,
  )
  return rgb(lit.r, lit.g, lit.b, meshColor.a)
}
