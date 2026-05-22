import type { GradientMapConfig, PaletteStop } from '../types'
import { clamp, sortStops } from './color'

const MID_MIN = 0.05
const MID_MAX = 0.95

export function segmentKey(leftId: string, rightId: string): string {
  return `${leftId}|${rightId}`
}

/** Remap segment-local t ∈ [0,1] through a midpoint (Photoshop-style). */
export function applyMidpointCurve(localT: number, midpoint: number): number {
  const m = clamp(midpoint, MID_MIN, MID_MAX)
  if (localT <= 0) return 0
  if (localT >= 1) return 1
  if (localT < m) return 0.5 * (localT / m)
  return 0.5 + 0.5 * ((localT - m) / (1 - m))
}

/** Rebuild midpoint map for current stop order; preserve existing segment values. */
export function syncMidpoints(
  stops: PaletteStop[],
  existing: Record<string, number> = {},
): Record<string, number> {
  const sorted = sortStops(stops)
  const next: Record<string, number> = {}
  for (let i = 0; i < sorted.length - 1; i++) {
    const key = segmentKey(sorted[i].id, sorted[i + 1].id)
    next[key] = clamp(existing[key] ?? 0.5, MID_MIN, MID_MAX)
  }
  return next
}

export function getSegmentMidpoint(
  midpoints: Record<string, number>,
  leftId: string,
  rightId: string,
): number {
  return clamp(midpoints[segmentKey(leftId, rightId)] ?? 0.5, MID_MIN, MID_MAX)
}

export function setSegmentMidpoint(
  midpoints: Record<string, number>,
  leftId: string,
  rightId: string,
  value: number,
): Record<string, number> {
  return {
    ...midpoints,
    [segmentKey(leftId, rightId)]: clamp(value, MID_MIN, MID_MAX),
  }
}

/** Sorted segment descriptors for UI handles. */
export function listSegments(stops: PaletteStop[]): {
  left: PaletteStop
  right: PaletteStop
  midpoint: number
  key: string
}[] {
  const sorted = sortStops(stops)
  const out: ReturnType<typeof listSegments> = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i]
    const right = sorted[i + 1]
    out.push({
      left,
      right,
      key: segmentKey(left.id, right.id),
      midpoint: 0.5,
    })
  }
  return out
}

export function segmentsWithMidpoints(
  gradientMap: GradientMapConfig,
): ReturnType<typeof listSegments> {
  const sorted = sortStops(gradientMap.stops)
  const out: ReturnType<typeof listSegments> = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i]
    const right = sorted[i + 1]
    out.push({
      left,
      right,
      key: segmentKey(left.id, right.id),
      midpoint: getSegmentMidpoint(gradientMap.midpoints, left.id, right.id),
    })
  }
  return out
}
