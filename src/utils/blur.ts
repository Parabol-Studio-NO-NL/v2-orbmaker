import type { BlurConfig } from '../types'
import { mulberry32 } from './noise'

function buildSphereMask(
  size: number,
  cx: number,
  cy: number,
  radius2: number,
): Uint8Array {
  const mask = new Uint8Array(size * size)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px - cx
      const dy = py - cy
      if (dx * dx + dy * dy <= radius2) mask[py * size + px] = 1
    }
  }
  return mask
}

function makeGaussianKernel(radiusPx: number): Float32Array {
  const radius = Math.max(1, Math.min(40, Math.round(radiusPx)))
  const sigma = Math.max(0.5, radius / 3)
  const size = radius * 2 + 1
  const kernel = new Float32Array(size)
  let sum = 0
  for (let i = 0; i < size; i++) {
    const x = i - radius
    const w = Math.exp(-(x * x) / (2 * sigma * sigma))
    kernel[i] = w
    sum += w
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum
  return kernel
}

function sampleRgb(
  src: Uint8ClampedArray,
  size: number,
  px: number,
  py: number,
): [number, number, number, number] {
  const x = Math.max(0, Math.min(size - 1, px))
  const y = Math.max(0, Math.min(size - 1, py))
  const i = (y * size + x) * 4
  return [src[i], src[i + 1], src[i + 2], src[i + 3]]
}

/** Separable Gaussian blur on RGBA; only pixels in mask are written. */
function gaussianBlur(
  src: Uint8ClampedArray,
  size: number,
  radiusPx: number,
  mask: Uint8Array,
): Uint8ClampedArray {
  const kernel = makeGaussianKernel(radiusPx)
  const radius = (kernel.length - 1) >> 1
  const tmp = new Uint8ClampedArray(src.length)
  const out = new Uint8ClampedArray(src.length)

  // Horizontal
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const pidx = py * size + px
      if (!mask[pidx]) continue

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let wsum = 0

      for (let k = -radius; k <= radius; k++) {
        const [sr, sg, sb, sa] = sampleRgb(src, size, px + k, py)
        const w = kernel[k + radius]
        r += sr * w
        g += sg * w
        b += sb * w
        a += sa * w
        wsum += w
      }

      const o = pidx * 4
      tmp[o] = r / wsum + 0.5 | 0
      tmp[o + 1] = g / wsum + 0.5 | 0
      tmp[o + 2] = b / wsum + 0.5 | 0
      tmp[o + 3] = a / wsum + 0.5 | 0
    }
  }

  // Vertical
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const pidx = py * size + px
      if (!mask[pidx]) continue

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let wsum = 0

      for (let k = -radius; k <= radius; k++) {
        const [sr, sg, sb, sa] = sampleRgb(tmp, size, px, py + k)
        const w = kernel[k + radius]
        r += sr * w
        g += sg * w
        b += sb * w
        a += sa * w
        wsum += w
      }

      const o = pidx * 4
      out[o] = r / wsum + 0.5 | 0
      out[o + 1] = g / wsum + 0.5 | 0
      out[o + 2] = b / wsum + 0.5 | 0
      out[o + 3] = a / wsum + 0.5 | 0
    }
  }

  // Restore outside mask from source
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) continue
    const o = i * 4
    out[o] = 0
    out[o + 1] = 0
    out[o + 2] = 0
    out[o + 3] = 0
  }

  return out
}

/** Locked motion-blur angles: 0° = horizontal (right), 90° = vertical (down). */
function motionAxisToAngle(axis: 'horizontal' | 'vertical'): number {
  return axis === 'vertical' ? 90 : 0
}

/** Directional motion blur along angle (degrees); length in pixels. */
function motionBlur(
  src: Uint8ClampedArray,
  size: number,
  lengthPx: number,
  angleDeg: number,
  mask: Uint8Array,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  const steps = Math.max(2, Math.round(lengthPx))
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  const half = (steps - 1) / 2

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const pidx = py * size + px
      const o = pidx * 4

      if (!mask[pidx]) {
        out[o] = 0
        out[o + 1] = 0
        out[o + 2] = 0
        out[o + 3] = 0
        continue
      }

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0

      for (let s = 0; s < steps; s++) {
        const t = s - half
        const sx = px + dx * t
        const sy = py + dy * t
        const x = Math.round(sx)
        const y = Math.round(sy)
        if (x < 0 || x >= size || y < 0 || y >= size) continue
        const si = y * size + x
        if (!mask[si]) continue
        const i = si * 4
        r += src[i]
        g += src[i + 1]
        b += src[i + 2]
        a += src[i + 3]
        count++
      }

      if (count === 0) {
        out[o] = src[o]
        out[o + 1] = src[o + 1]
        out[o + 2] = src[o + 2]
        out[o + 3] = src[o + 3]
      } else {
        out[o] = r / count + 0.5 | 0
        out[o + 1] = g / count + 0.5 | 0
        out[o + 2] = b / count + 0.5 | 0
        out[o + 3] = a / count + 0.5 | 0
      }
    }
  }

  return out
}

/** Rotational blur — average samples along an arc around the sphere center. */
function rotationalBlur(
  src: Uint8ClampedArray,
  size: number,
  strength: number,
  mask: Uint8Array,
  cx: number,
  cy: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  const angleSpan = strength * (Math.PI / 2.5)
  const steps = Math.max(3, Math.round(strength * 28))

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const pidx = py * size + px
      const o = pidx * 4

      if (!mask[pidx]) {
        out[o] = 0
        out[o + 1] = 0
        out[o + 2] = 0
        out[o + 3] = 0
        continue
      }

      const dx = px - cx
      const dy = py - cy
      const dist = Math.hypot(dx, dy)

      if (dist < 1.5) {
        out[o] = src[o]
        out[o + 1] = src[o + 1]
        out[o + 2] = src[o + 2]
        out[o + 3] = src[o + 3]
        continue
      }

      const baseAngle = Math.atan2(dy, dx)
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0

      for (let s = 0; s < steps; s++) {
        const t = steps === 1 ? 0 : (s / (steps - 1) - 0.5) * 2
        const theta = baseAngle + t * (angleSpan * 0.5)
        const x = Math.round(cx + dist * Math.cos(theta))
        const y = Math.round(cy + dist * Math.sin(theta))
        if (x < 0 || x >= size || y < 0 || y >= size) continue
        const si = y * size + x
        if (!mask[si]) continue
        const i = si * 4
        r += src[i]
        g += src[i + 1]
        b += src[i + 2]
        a += src[i + 3]
        count++
      }

      if (count === 0) {
        out[o] = src[o]
        out[o + 1] = src[o + 1]
        out[o + 2] = src[o + 2]
        out[o + 3] = src[o + 3]
      } else {
        out[o] = r / count + 0.5 | 0
        out[o + 1] = g / count + 0.5 | 0
        out[o + 2] = b / count + 0.5 | 0
        out[o + 3] = a / count + 0.5 | 0
      }
    }
  }

  return out
}

function applyFilmGrain(
  data: Uint8ClampedArray,
  size: number,
  amount: number,
  seed: number,
  mask: Uint8Array,
): void {
  if (amount <= 0) return

  const rng = mulberry32(seed + 424242)
  const strength = amount * 42

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const o = i * 4
    const n = (rng() - 0.5) * 2 * strength
    data[o] = Math.max(0, Math.min(255, data[o] + n))
    data[o + 1] = Math.max(0, Math.min(255, data[o + 1] + n))
    data[o + 2] = Math.max(0, Math.min(255, data[o + 2] + n))
  }
}

/** Apply blur and grain post-processing on rendered sphere ImageData. */
export function applyPostProcessBlur(
  data: Uint8ClampedArray,
  size: number,
  blur: BlurConfig,
  noiseSeed = 0,
): void {
  const gaussPx = blur.gaussian * size * 0.06
  const motionPx = blur.motion * size * 0.2
  const hasRotation = blur.rotation > 0.02
  const hasBlur = gaussPx >= 0.5 || motionPx >= 2 || hasRotation
  const hasGrain = blur.grain > 0

  if (!hasBlur && !hasGrain) return

  const cx = size / 2
  const cy = size / 2
  const radius2 = (size * 0.46) ** 2
  const mask = buildSphereMask(size, cx, cy, radius2)

  let work = data

  if (gaussPx >= 0.5) {
    work = gaussianBlur(work, size, gaussPx, mask)
  }

  if (motionPx >= 2) {
    work = motionBlur(work, size, motionPx, motionAxisToAngle(blur.motionAxis), mask)
  }

  if (hasRotation) {
    work = rotationalBlur(work, size, blur.rotation, mask, cx, cy)
  }

  data.set(work)

  if (hasGrain) {
    applyFilmGrain(data, size, blur.grain, noiseSeed, mask)
  }
}
