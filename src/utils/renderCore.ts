import type { GradientMapConfig, MeshConfig, MeshGrid, RenderMode } from '../types'
import { canvasToUv, canvasToSphereNormal } from './mesh'
import { applySphereLightingRgb } from './sphereLighting'
import {
  buildGradientLut,
  gradientLutKey,
  LUT_SIZE,
  sampleGradientLut,
} from './gradientLut'
import type { ShapeDefinition, ShapeFit } from './shapeDomain'
import { buildShapeMask, pixelToUv, scaleShapeForSize, sphereLayout } from './shapeDomain'
import { DEFAULT_SVG_SHAPE_URL } from '../config/defaults'

// ---------------------------------------------------------------------------
// UV cache (per canvas size + mode)
// ---------------------------------------------------------------------------

let uvCacheKey = ''
let uCache: Float32Array | null = null
let vCache: Float32Array | null = null
let maskCacheKey = ''
let maskCacheArr: Uint8Array | null = null

function uvCacheId(
  size: number,
  mode: RenderMode,
  cx: number,
  cy: number,
  radius: number,
  fit?: ShapeFit,
): string {
  if (mode === 'svg' && fit) {
    return `svg:${size}:${fit.bx}:${fit.by}:${fit.bw}:${fit.bh}`
  }
  return `sphere:${size}:${cx}:${cy}:${radius}`
}

function getSphereUvCache(size: number, cx: number, cy: number, radius: number) {
  const key = uvCacheId(size, 'sphere', cx, cy, radius)
  if (uvCacheKey === key && uCache && vCache) {
    return { u: uCache, v: vCache }
  }

  const n = size * size
  uCache = new Float32Array(n)
  vCache = new Float32Array(n)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = py * size + px
      const { u, v } = canvasToUv(px, py, cx, cy, radius)
      uCache[idx] = u
      vCache[idx] = v
    }
  }

  uvCacheKey = key
  return { u: uCache, v: vCache }
}

function getSvgUvCache(size: number, fit: ShapeFit, mask: Uint8Array) {
  const key = uvCacheId(size, 'svg', 0, 0, 0, fit)
  if (uvCacheKey === key && uCache && vCache) {
    return { u: uCache, v: vCache }
  }

  const n = size * size
  uCache = new Float32Array(n)
  vCache = new Float32Array(n)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = py * size + px
      if (!mask[idx]) {
        uCache[idx] = 0
        vCache[idx] = 0
        continue
      }
      const { u, v } = pixelToUv(px, py, fit)
      uCache[idx] = u
      vCache[idx] = v
    }
  }

  uvCacheKey = key
  return { u: uCache, v: vCache }
}

export function invalidateUvCache(): void {
  uvCacheKey = ''
  uCache = null
  vCache = null
  maskCacheKey = ''
  maskCacheArr = null
}

// ---------------------------------------------------------------------------
// Gradient LUT cache
// ---------------------------------------------------------------------------

let cachedLut: Uint8Array | null = null
let cachedLutKey = ''

export function getGradientLut(gradientMap: GradientMapConfig): Uint8Array | null {
  if (!gradientMap.enabled || gradientMap.stops.length < 2) {
    cachedLut = null
    cachedLutKey = ''
    return null
  }

  const key = gradientLutKey(gradientMap)
  if (cachedLut && key === cachedLutKey) return cachedLut

  cachedLut = buildGradientLut(gradientMap)
  cachedLutKey = key
  return cachedLut
}

export function invalidateGradientLut(): void {
  cachedLut = null
  cachedLutKey = ''
}

// ---------------------------------------------------------------------------
// Serializable payload for Web Worker export
// ---------------------------------------------------------------------------

export interface RenderPayload {
  size: number
  cols: number
  rows: number
  colors: Float32Array
  renderMode: RenderMode
  sphereShading: number
  sphereLightness: number
  sphereShininess: number
  gradientEnabled: boolean
  gradientOffset: number
  gradientLut: Uint8Array | null
  /** SVG mode */
  mask?: Uint8Array
  fit?: ShapeFit
  blurCx?: number
  blurCy?: number
}

export function buildRenderPayload(
  grid: MeshGrid,
  config: MeshConfig,
  size: number,
  shape?: ShapeDefinition | null,
  shapeUrl = DEFAULT_SVG_SHAPE_URL,
): RenderPayload {
  const svgShape =
    config.renderMode === 'svg' && shape
      ? size === config.canvasSize
        ? shape
        : scaleShapeForSize(shape, size)
      : null
  const { cols, rows, points } = grid
  const colors = new Float32Array(cols * rows * 3)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = points[row][col].color
      const i = (row * cols + col) * 3
      colors[i] = c.r
      colors[i + 1] = c.g
      colors[i + 2] = c.b
    }
  }

  const lut = getGradientLut(config.gradientMap)

  const base: RenderPayload = {
    size,
    cols,
    rows,
    colors,
    renderMode: config.renderMode,
    sphereShading: config.sphereShading,
    sphereLightness: config.sphereLightness,
    sphereShininess: config.sphereShininess,
    gradientEnabled: config.gradientMap.enabled && config.gradientMap.stops.length >= 2,
    gradientOffset: config.gradientMap.offset,
    gradientLut: lut ? new Uint8Array(lut) : null,
  }

  if (svgShape) {
    const mask = buildShapeMask(size, svgShape, shapeUrl)
    base.mask = mask
    base.fit = { ...svgShape.fit }
    base.blurCx = svgShape.cx
    base.blurCy = svgShape.cy
  }

  return base
}

// ---------------------------------------------------------------------------
// Fused allocation-free pixel loop
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function sampleBilinear(
  colors: Float32Array,
  cols: number,
  rows: number,
  u: number,
  v: number,
): { r: number; g: number; b: number } {
  const fCol = u * (cols - 1)
  const fRow = v * (rows - 1)

  const col0 = fCol | 0
  const row0 = fRow | 0
  const col1 = col0 + 1 < cols ? col0 + 1 : cols - 1
  const row1 = row0 + 1 < rows ? row0 + 1 : rows - 1

  const tu = fCol - col0
  const tv = fRow - row0

  const i00 = (row0 * cols + col0) * 3
  const i10 = (row0 * cols + col1) * 3
  const i01 = (row1 * cols + col0) * 3
  const i11 = (row1 * cols + col1) * 3

  const r0 = colors[i00] * (1 - tu) + colors[i10] * tu
  const r1 = colors[i01] * (1 - tu) + colors[i11] * tu
  const g0 = colors[i00 + 1] * (1 - tu) + colors[i10 + 1] * tu
  const g1 = colors[i01 + 1] * (1 - tu) + colors[i11 + 1] * tu
  const b0 = colors[i00 + 2] * (1 - tu) + colors[i10 + 2] * tu
  const b1 = colors[i01 + 2] * (1 - tu) + colors[i11 + 2] * tu

  return {
    r: r0 * (1 - tv) + r1 * tv,
    g: g0 * (1 - tv) + g1 * tv,
    b: b0 * (1 - tv) + b1 * tv,
  }
}

/** Write rendered pixels into `data` (RGBA, length = size² × 4). */
export function renderPixelsFused(
  data: Uint8ClampedArray,
  payload: RenderPayload,
  useUvCache: boolean,
): void {
  const {
    size,
    cols,
    rows,
    colors,
    renderMode,
    sphereShading,
    sphereLightness,
    sphereShininess,
    gradientEnabled,
    gradientOffset,
    gradientLut,
    mask,
    fit,
  } = payload

  const lutOut = { r: 0, g: 0, b: 0 }
  const isSvg = renderMode === 'svg' && mask && fit

  if (isSvg) {
    const uv = useUvCache ? getSvgUvCache(size, fit, mask) : null

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const pidx = py * size + px
        if (!mask[pidx]) continue

        let u: number
        let v: number
        if (uv) {
          u = uv.u[pidx]
          v = uv.v[pidx]
        } else {
          const uvPair = pixelToUv(px, py, fit)
          u = uvPair.u
          v = uvPair.v
        }

        const mesh = sampleBilinear(colors, cols, rows, u, v)
        let r = mesh.r
        let g = mesh.g
        let b = mesh.b

        if (gradientEnabled && gradientLut) {
          const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
          const mapT = clamp01(luma + gradientOffset * (u * 2 - 1))
          sampleGradientLut(gradientLut, mapT, lutOut)
          r = lutOut.r
          g = lutOut.g
          b = lutOut.b
        }

        const idx = pidx * 4
        data[idx] = r + 0.5 | 0
        data[idx + 1] = g + 0.5 | 0
        data[idx + 2] = b + 0.5 | 0
        data[idx + 3] = 255
      }
    }
    return
  }

  const { cx, cy, radius, radius2 } = sphereLayout(size)
  const uv = useUvCache ? getSphereUvCache(size, cx, cy, radius) : null

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px - cx
      const dy = py - cy
      const dist2 = dx * dx + dy * dy

      if (dist2 > radius2) continue

      const pidx = py * size + px
      let u: number
      let v: number

      if (uv) {
        u = uv.u[pidx]
        v = uv.v[pidx]
      } else {
        const uvPair = canvasToUv(px, py, cx, cy, radius)
        u = uvPair.u
        v = uvPair.v
      }

      const mesh = sampleBilinear(colors, cols, rows, u, v)
      let r = mesh.r
      let g = mesh.g
      let b = mesh.b

      if (gradientEnabled && gradientLut) {
        const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        const mapT = clamp01(luma + gradientOffset * (u * 2 - 1))
        sampleGradientLut(gradientLut, mapT, lutOut)
        r = lutOut.r
        g = lutOut.g
        b = lutOut.b
      }

      const { nx, ny } = canvasToSphereNormal(px, py, cx, cy, radius)
      const shaded = applySphereLightingRgb(
        r,
        g,
        b,
        nx,
        ny,
        sphereShading,
        sphereLightness,
        sphereShininess,
      )

      const idx = pidx * 4
      data[idx] = shaded.r + 0.5 | 0
      data[idx + 1] = shaded.g + 0.5 | 0
      data[idx + 2] = shaded.b + 0.5 | 0
      data[idx + 3] = 255
    }
  }
}

/** Render from live MeshGrid + MeshConfig. */
export function renderMeshPixels(
  data: Uint8ClampedArray,
  size: number,
  grid: MeshGrid,
  config: MeshConfig,
  shape?: ShapeDefinition | null,
  shapeUrl = DEFAULT_SVG_SHAPE_URL,
): void {
  const svgShape =
    config.renderMode === 'svg' && shape
      ? size === config.canvasSize
        ? shape
        : scaleShapeForSize(shape, size)
      : null
  const payload = buildRenderPayload(grid, config, size, svgShape ?? shape, shapeUrl)
  renderPixelsFused(data, payload, true)
}

/** Render from worker payload (no UV cache — fresh arrays per export size). */
export function renderPayloadPixels(payload: RenderPayload): Uint8ClampedArray {
  const { size } = payload
  const data = new Uint8ClampedArray(size * size * 4)
  renderPixelsFused(data, payload, false)
  return data
}

// Re-export LUT_SIZE for tests
export { LUT_SIZE }
