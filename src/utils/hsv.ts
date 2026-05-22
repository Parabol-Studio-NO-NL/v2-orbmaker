import type { Color } from '../types'
import { clamp, rgb } from './color'

export interface Hsv {
  h: number // 0–360
  s: number // 0–1
  v: number // 0–1
}

export function colorToHsv(c: Color): Hsv {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min

  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }

  const s = max === 0 ? 0 : d / max
  return { h, s, v: max }
}

export function hsvToColor(hsv: Hsv): Color {
  const h = ((hsv.h % 360) + 360) % 360
  const s = clamp(hsv.s, 0, 1)
  const v = clamp(hsv.v, 0, 1)

  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

  let r = 0
  let g = 0
  let b = 0

  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }

  return rgb(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  )
}
