import type { BlurConfig } from '../types'
import { BLUR_RENDER_TUNING } from '../config/defaults'
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

/** Deterministic per-pixel hash in [0, 1) — breaks aligned blur banding. */
function pixelHash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Bilinear RGBA sample (mask-aware, renormalizes in-mask corners). */
function sampleRgbBilinear(
  src: Uint8ClampedArray,
  size: number,
  fx: number,
  fy: number,
  mask: Uint8Array,
): [number, number, number, number] | null {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  if (x0 < 0 || y0 < 0 || x0 >= size - 1 || y0 >= size - 1) {
    const x = Math.max(0, Math.min(size - 1, Math.round(fx)))
    const y = Math.max(0, Math.min(size - 1, Math.round(fy)))
    const pi = y * size + x
    if (!mask[pi]) return null
    return sampleRgb(src, size, x, y)
  }

  const x1 = x0 + 1
  const y1 = y0 + 1
  const tx = fx - x0
  const ty = fy - y0
  const corners = [
    { x: x0, y: y0, w: (1 - tx) * (1 - ty) },
    { x: x1, y: y0, w: tx * (1 - ty) },
    { x: x0, y: y1, w: (1 - tx) * ty },
    { x: x1, y: y1, w: tx * ty },
  ]

  let r = 0
  let g = 0
  let b = 0
  let a = 0
  let wsum = 0

  for (const c of corners) {
    const pi = c.y * size + c.x
    if (!mask[pi]) continue
    const i = pi * 4
    r += src[i] * c.w
    g += src[i + 1] * c.w
    b += src[i + 2] * c.w
    a += src[i + 3] * c.w
    wsum += c.w
  }

  if (wsum < 1e-6) return null
  return [r / wsum, g / wsum, b / wsum, a / wsum]
}

function writeSample(
  out: Uint8ClampedArray,
  o: number,
  sample: [number, number, number, number],
): void {
  out[o] = sample[0] + 0.5 | 0
  out[o + 1] = sample[1] + 0.5 | 0
  out[o + 2] = sample[2] + 0.5 | 0
  out[o + 3] = sample[3] + 0.5 | 0
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
  jitterSeed: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  const steps = Math.max(4, Math.round(lengthPx * 1.15))
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  const perpX = -dy
  const perpY = dx

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

      const subJitter = (pixelHash(px, py, jitterSeed) - 0.5) * 0.65
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let wsum = 0

      for (let s = 0; s < steps; s++) {
        const strat = (s + pixelHash(px, py, jitterSeed + s * 31)) / steps
        const along = (strat - 0.5) * lengthPx
        const across = (pixelHash(px, py, jitterSeed + s * 53) - 0.5) * subJitter
        const sx = px + dx * along + perpX * across
        const sy = py + dy * along + perpY * across
        const sample = sampleRgbBilinear(src, size, sx, sy, mask)
        if (!sample) continue

        const wt = 1 - Math.abs(strat - 0.5) * 1.6
        r += sample[0] * wt
        g += sample[1] * wt
        b += sample[2] * wt
        a += sample[3] * wt
        wsum += wt
      }

      if (wsum < 1e-6) {
        out[o] = src[o]
        out[o + 1] = src[o + 1]
        out[o + 2] = src[o + 2]
        out[o + 3] = src[o + 3]
      } else {
        writeSample(out, o, [r / wsum, g / wsum, b / wsum, a / wsum])
      }
    }
  }

  return out
}

/** Rotational blur — jittered arc samples around the sphere center. */
function rotationalBlur(
  src: Uint8ClampedArray,
  size: number,
  strength: number,
  mask: Uint8Array,
  cx: number,
  cy: number,
  jitterSeed: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  const t = BLUR_RENDER_TUNING.rotational
  const angleSpan = strength * t.angleSpanAtFull
  const steps = Math.max(t.minSampleSteps, Math.round(strength * t.sampleStepsScale))

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
      const arcOffset = (pixelHash(px, py, jitterSeed + 7) - 0.5) * angleSpan * t.arcOffsetJitter
      const radiusJitter = (pixelHash(px, py, jitterSeed + 11) - 0.5) * t.radiusJitterPx

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let wsum = 0

      for (let s = 0; s < steps; s++) {
        const strat = (s + pixelHash(px, py, jitterSeed + s * 47)) / steps
        const delta = (strat - 0.5) * angleSpan
        const theta = baseAngle + arcOffset + delta
        const rSample = dist + radiusJitter
        const sx = cx + rSample * Math.cos(theta)
        const sy = cy + rSample * Math.sin(theta)
        const sample = sampleRgbBilinear(src, size, sx, sy, mask)
        if (!sample) continue

        const wt = 1 - Math.abs(strat - 0.5) * t.weightFalloff
        r += sample[0] * wt
        g += sample[1] * wt
        b += sample[2] * wt
        a += sample[3] * wt
        wsum += wt
      }

      if (wsum < 1e-6) {
        out[o] = src[o]
        out[o + 1] = src[o + 1]
        out[o + 2] = src[o + 2]
        out[o + 3] = src[o + 3]
      } else {
        writeSample(out, o, [r / wsum, g / wsum, b / wsum, a / wsum])
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

/** Apply blur and grain post-processing on rendered ImageData. */
export function applyPostProcessBlur(
  data: Uint8ClampedArray,
  size: number,
  blur: BlurConfig,
  noiseSeed = 0,
  mask?: Uint8Array,
  blurCx?: number,
  blurCy?: number,
): void {
  const gaussPx = blur.gaussian * size * BLUR_RENDER_TUNING.gaussianSizeScale
  const motionPx = blur.motion * size * BLUR_RENDER_TUNING.motionSizeScale
  const hasRotation = blur.rotation > BLUR_RENDER_TUNING.rotational.minStrength
  const hasBlur =
    gaussPx >= 0.5 || motionPx >= BLUR_RENDER_TUNING.motionMinPixels || hasRotation
  const hasGrain = blur.grain > 0

  if (!hasBlur && !hasGrain) return

  const cx = blurCx ?? size / 2
  const cy = blurCy ?? size / 2
  const radius2 = (size * 0.46) ** 2
  const effectiveMask = mask ?? buildSphereMask(size, size / 2, size / 2, radius2)

  let work = data

  if (gaussPx >= 0.5) {
    work = gaussianBlur(work, size, gaussPx, effectiveMask)
  }

  if (motionPx >= 2) {
    work = motionBlur(
      work,
      size,
      motionPx,
      motionAxisToAngle(blur.motionAxis),
      effectiveMask,
      noiseSeed + 12001,
    )
  }

  if (hasRotation) {
    work = rotationalBlur(work, size, blur.rotation, effectiveMask, cx, cy, noiseSeed + 24002)
  }

  data.set(work)

  if (hasGrain) {
    applyFilmGrain(data, size, blur.grain, noiseSeed, effectiveMask)
  }
}
