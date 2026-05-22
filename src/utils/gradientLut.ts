import type { GradientMapConfig, PaletteStop } from '../types'
import { sortStops, smootherstep } from './color'
import { applyMidpointCurve, getSegmentMidpoint } from './gradientMidpoint'

export const LUT_SIZE = 256

/** Pre-sorted stop data for fast LUT building and sampling. */
export interface SortedStopData {
  positions: Float32Array
  r: Float32Array
  g: Float32Array
  b: Float32Array
  midpoints: Float32Array
  count: number
}

export function packSortedStops(
  stops: PaletteStop[],
  midpoints: Record<string, number> = {},
): SortedStopData {
  const sorted = sortStops(stops)
  const count = sorted.length
  const positions = new Float32Array(count)
  const r = new Float32Array(count)
  const g = new Float32Array(count)
  const b = new Float32Array(count)
  const mids = new Float32Array(Math.max(0, count - 1))

  for (let i = 0; i < count; i++) {
    positions[i] = sorted[i].position
    r[i] = sorted[i].color.r
    g[i] = sorted[i].color.g
    b[i] = sorted[i].color.b
  }

  for (let i = 0; i < count - 1; i++) {
    mids[i] = getSegmentMidpoint(midpoints, sorted[i].id, sorted[i + 1].id)
  }

  return { positions, r, g, b, midpoints: mids, count }
}

/** Sample sorted stops at t without allocations (smootherstep lerp + midpoint). */
export function sampleSortedStopsAt(
  data: SortedStopData,
  t: number,
): { r: number; g: number; b: number } {
  if (data.count === 0) return { r: 0, g: 0, b: 0 }
  if (data.count === 1) {
    return { r: data.r[0], g: data.g[0], b: data.b[0] }
  }

  t = t < 0 ? 0 : t > 1 ? 1 : t

  let lo = 0
  let hi = data.count - 1

  for (let i = 0; i < data.count - 1; i++) {
    if (t >= data.positions[i] && t <= data.positions[i + 1]) {
      lo = i
      hi = i + 1
      break
    }
  }

  const range = data.positions[hi] - data.positions[lo]
  const localT = range === 0 ? 0 : (t - data.positions[lo]) / range
  const mid = data.midpoints[lo] ?? 0.5
  const curved = applyMidpointCurve(localT, mid)
  const st = smootherstep(curved)

  return {
    r: data.r[lo] + (data.r[hi] - data.r[lo]) * st,
    g: data.g[lo] + (data.g[hi] - data.g[lo]) * st,
    b: data.b[lo] + (data.b[hi] - data.b[lo]) * st,
  }
}

/** Build a 256-entry RGB LUT (interleaved r,g,b per entry). */
export function buildGradientLut(gradientMap: GradientMapConfig): Uint8Array {
  const data = packSortedStops(gradientMap.stops, gradientMap.midpoints)
  const lut = new Uint8Array(LUT_SIZE * 3)
  const denom = LUT_SIZE - 1

  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / denom
    const { r, g, b } = sampleSortedStopsAt(data, t)
    const o = i * 3
    lut[o] = Math.round(r)
    lut[o + 1] = Math.round(g)
    lut[o + 2] = Math.round(b)
  }

  return lut
}

/** Cache key for gradient LUT invalidation. */
export function gradientLutKey(gradientMap: GradientMapConfig): string {
  const sorted = sortStops(gradientMap.stops)
  const stopPart = sorted
    .map((s) => `${s.position.toFixed(4)}:${s.color.r}|${s.color.g}|${s.color.b}`)
    .join(';')
  const midPart = Object.entries(gradientMap.midpoints)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v.toFixed(4)}`)
    .join(';')
  return `${stopPart}::${midPart}`
}

/** Sample LUT at mapT ∈ [0, 1] with linear interpolation between bins. */
export function sampleGradientLut(
  lut: Uint8Array,
  mapT: number,
  out: { r: number; g: number; b: number },
): void {
  const maxIdx = LUT_SIZE - 1
  const idx = mapT * maxIdx
  const i0 = idx | 0
  const i1 = i0 < maxIdx ? i0 + 1 : maxIdx
  const frac = idx - i0

  const o0 = i0 * 3
  const o1 = i1 * 3

  out.r = lut[o0] * (1 - frac) + lut[o1] * frac
  out.g = lut[o0 + 1] * (1 - frac) + lut[o1 + 1] * frac
  out.b = lut[o0 + 2] * (1 - frac) + lut[o1 + 2] * frac
}
