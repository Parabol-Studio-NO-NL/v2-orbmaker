import type { MeshConfig, MeshGrid, MeshPoint, Color, RenderMode } from '../types'
import { sampleWarpedNoise, sampleNoise } from './noise'
import { snapToNearestPaletteColor, applyContrast, rgb } from './color'
import type { ShapeDefinition } from './shapeDomain'
import { uvToCanvasBbox } from './shapeDomain'

// ---------------------------------------------------------------------------
// Grid generation
// ---------------------------------------------------------------------------

/**
 * Build a cols × rows mesh grid.
 * Each point has a normalised (u, v) position in [0, 1]² plus
 * its computed canvas (x, y) coordinate on the sphere.
 *
 * @param config       Full mesh configuration
 * @param existingGrid If provided, pinned point colors are preserved
 */
export function buildMeshGrid(
  config: MeshConfig,
  existingGrid?: MeshGrid,
  shape?: ShapeDefinition | null,
): MeshGrid {
  const { cols, rows, canvasSize, renderMode } = config

  const cx = canvasSize / 2
  const cy = canvasSize / 2
  const radius = canvasSize * 0.46

  const points: MeshPoint[][] = []

  for (let row = 0; row < rows; row++) {
    const rowPoints: MeshPoint[] = []

    for (let col = 0; col < cols; col++) {
      const u = cols === 1 ? 0.5 : col / (cols - 1)
      const v = rows === 1 ? 0.5 : row / (rows - 1)

      const { x, y } =
        renderMode === 'svg' && shape
          ? uvToCanvasBbox(u, v, shape.fit)
          : uvToCanvas(u, v, cx, cy, radius)

      const existing = existingGrid?.points[row]?.[col]
      if (existing?.pinned) {
        rowPoints.push({ u, v, x, y, color: existing.color, pinned: true })
        continue
      }

      // Each grid point snaps to one of the 3 solid palette colors.
      // Gradients are produced by bilinear interpolation between adjacent points.
      const noiseVal = sampleGridNoise(u, v, col, row, config)
      const color = snapToNearestPaletteColor(noiseVal, config.palette)

      rowPoints.push({ u, v, x, y, color, pinned: false })
    }

    points.push(rowPoints)
  }

  return { points, cols, rows }
}

// ---------------------------------------------------------------------------
// Noise sampling for grid points
// ---------------------------------------------------------------------------

/**
 * Sample noise for a single grid point, ensuring:
 *
 * 1. High effective frequency — adjacent grid points land in different noise
 *    "zones" so neighbouring points can get entirely different hues.
 *    We achieve this by scaling the UV sample position by the grid density so
 *    each grid step is always at least ~1 noise wavelength apart.
 *
 * 2. Color contrast — the raw noise value is sharpened with a contrast curve
 *    that pushes values toward 0 or 1, making colour jumps between points harsher.
 *
 * 3. A secondary noise channel (different seed offset) is blended in to break
 *    any monotonic drift across the sphere, giving better palette coverage.
 */
export function sampleGridNoise(
  u: number,
  v: number,
  col: number,
  row: number,
  config: MeshConfig,
): number {
  const { noiseSeed, noiseScale, noiseOctaves, colorContrast, cols, rows } = config

  // Scale noise frequency by grid density so each grid cell spans ~noiseScale noise units.
  // With noiseScale=1.4 and cols=5, effectiveScale = 1.4 * 4 = 5.6
  const density = Math.max(cols - 1, rows - 1, 1)
  const effectiveScale = noiseScale * density

  // Primary noise channel
  const primary = sampleWarpedNoise(u, v, noiseSeed, effectiveScale, noiseOctaves, 0.35)

  // Secondary noise channel (different seed) blended in to widen palette usage.
  // It samples at a lower frequency so it creates broad hue regions, while the
  // primary high-frequency noise creates sharp local transitions.
  const secondary = sampleNoise(u, v, noiseSeed + 9999, noiseScale * 0.8, 2)

  // Mix: 70% high-freq (sharp jumps) + 30% low-freq (broad regions)
  const mixed = primary * 0.7 + secondary * 0.3

  // Apply contrast curve to sharpen transitions toward 0/1
  return applyContrast(mixed, colorContrast)
}

// ---------------------------------------------------------------------------
// Sphere projection — stereographic hemisphere (more even, spherical feel)
// ---------------------------------------------------------------------------

/** Fits the UV square into the stereographic disk before orthographic display. */
const STEREO_UV_SCALE = 0.88

export function uvToStereographic(u: number, v: number): { sx: number; sy: number } {
  return {
    sx: (u * 2 - 1) * STEREO_UV_SCALE,
    sy: (v * 2 - 1) * STEREO_UV_SCALE,
  }
}

/** Map stereographic plane coords to a unit-sphere point (visible hemisphere, +Z). */
export function stereographicToUnitSphere(
  sx: number,
  sy: number,
): { x: number; y: number; z: number } {
  const rho2 = sx * sx + sy * sy
  const denom = 1 + rho2
  return {
    x: (2 * sx) / denom,
    y: (2 * sy) / denom,
    z: (1 - rho2) / denom,
  }
}

/** Normalised surface point for mesh UV (used for spherical color blending). */
export function uvToUnitSphere(u: number, v: number): { x: number; y: number; z: number } {
  const { sx, sy } = uvToStereographic(u, v)
  return stereographicToUnitSphere(sx, sy)
}

/**
 * Stereographic hemisphere → orthographic screen (view along +Z).
 * Grid lines bow toward the rim like latitude/longitude on a ball.
 */
export function uvToCanvas(
  u: number,
  v: number,
  cx: number,
  cy: number,
  radius: number,
): { x: number; y: number } {
  const { x, y } = uvToUnitSphere(u, v)
  return {
    x: cx + radius * x,
    y: cy + radius * y,
  }
}

// Keep the old name as an alias so export.ts still compiles
export { uvToCanvas as uvToCanvasEllipse }

/**
 * Inverse of uvToCanvas — maps a canvas pixel back to (u, v) ∈ [0, 1].
 * Pixels outside the visible hemisphere disk should be skipped by the caller.
 */
export function canvasToUv(
  px: number,
  py: number,
  cx: number,
  cy: number,
  radius: number,
): { u: number; v: number } {
  const x3 = (px - cx) / radius
  const y3 = (py - cy) / radius
  const z3 = Math.sqrt(Math.max(0, 1 - x3 * x3 - y3 * y3))
  const sx = x3 / (1 + z3)
  const sy = y3 / (1 + z3)
  return {
    u: sx / (2 * STEREO_UV_SCALE) + 0.5,
    v: sy / (2 * STEREO_UV_SCALE) + 0.5,
  }
}

/** Unit outward normal at a pixel on the orthographic sphere disk. */
export function canvasToSphereNormal(
  px: number,
  py: number,
  cx: number,
  cy: number,
  radius: number,
): { nx: number; ny: number; nz: number } {
  const nx = (px - cx) / radius
  const ny = (py - cy) / radius
  const r2 = nx * nx + ny * ny
  if (r2 > 1) return { nx: 0, ny: 0, nz: 1 }
  return { nx, ny, nz: Math.sqrt(1 - r2) }
}

// ---------------------------------------------------------------------------
// Pixel-level rendering helpers
// ---------------------------------------------------------------------------

export function sampleMeshAtPixel(
  px: number,
  py: number,
  grid: MeshGrid,
  cx: number,
  cy: number,
  radius: number,
): Color | null {
  const dx = px - cx
  const dy = py - cy
  if (dx * dx + dy * dy > radius * radius) return null

  const { u, v } = canvasToUv(px, py, cx, cy, radius)
  return sampleGridAtUV(u, v, grid)
}

function nlerpUnit(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  t: number,
): { x: number; y: number; z: number } {
  const x = a.x + (b.x - a.x) * t
  const y = a.y + (b.y - a.y) * t
  const z = a.z + (b.z - a.z) * t
  const len = Math.sqrt(x * x + y * y + z * z) || 1
  return { x: x / len, y: y / len, z: z / len }
}

function gridUv(col: number, row: number, cols: number, rows: number): { u: number; v: number } {
  return {
    u: cols === 1 ? 0.5 : col / (cols - 1),
    v: rows === 1 ? 0.5 : row / (rows - 1),
  }
}

function sampleGridAtUVFlat(u: number, v: number, grid: MeshGrid): Color {
  const { cols, rows, points } = grid
  const fCol = u * (cols - 1)
  const fRow = v * (rows - 1)
  const col0 = Math.floor(fCol)
  const row0 = Math.floor(fRow)
  const col1 = Math.min(col0 + 1, cols - 1)
  const row1 = Math.min(row0 + 1, rows - 1)
  const tu = fCol - col0
  const tv = fRow - row0
  const tl = points[row0][col0].color
  const tr = points[row0][col1].color
  const bl = points[row1][col0].color
  const br = points[row1][col1].color
  const r =
    (tl.r * (1 - tu) + tr.r * tu) * (1 - tv) + (bl.r * (1 - tu) + br.r * tu) * tv
  const g =
    (tl.g * (1 - tu) + tr.g * tu) * (1 - tv) + (bl.g * (1 - tu) + br.g * tu) * tv
  const b =
    (tl.b * (1 - tu) + tr.b * tu) * (1 - tv) + (bl.b * (1 - tu) + br.b * tu) * tv
  const a =
    (tl.a * (1 - tu) + tr.a * tu) * (1 - tv) + (bl.a * (1 - tu) + br.a * tu) * tv
  return rgb(r, g, b, a)
}

/**
 * Bilinear color sample — spherical nlerp in sphere mode, flat in svg mode.
 */
export function sampleGridAtUV(
  u: number,
  v: number,
  grid: MeshGrid,
  renderMode: RenderMode = 'sphere',
): Color {
  if (renderMode === 'svg') return sampleGridAtUVFlat(u, v, grid)

  const { cols, rows, points } = grid

  const fCol = u * (cols - 1)
  const fRow = v * (rows - 1)

  const col0 = Math.floor(fCol)
  const row0 = Math.floor(fRow)
  const col1 = Math.min(col0 + 1, cols - 1)
  const row1 = Math.min(row0 + 1, rows - 1)

  let tu = fCol - col0
  let tv = fRow - row0

  const tl = points[row0][col0].color
  const tr = points[row0][col1].color
  const bl = points[row1][col0].color
  const br = points[row1][col1].color

  const u0 = gridUv(col0, row0, cols, rows)
  const u1 = gridUv(col1, row0, cols, rows)
  const u2 = gridUv(col0, row1, cols, rows)
  const u3 = gridUv(col1, row1, cols, rows)

  const p00 = uvToUnitSphere(u0.u, u0.v)
  const p10 = uvToUnitSphere(u1.u, u1.v)
  const p01 = uvToUnitSphere(u2.u, u2.v)
  const p11 = uvToUnitSphere(u3.u, u3.v)
  const target = uvToUnitSphere(u, v)

  const top = nlerpUnit(p00, p10, tu)
  const bot = nlerpUnit(p01, p11, tu)
  const mid = nlerpUnit(top, bot, tv)

  const dotTop = top.x * target.x + top.y * target.y + top.z * target.z
  const dotBot = bot.x * target.x + bot.y * target.y + bot.z * target.z
  const dotMid = mid.x * target.x + mid.y * target.y + mid.z * target.z

  const spanV = Math.max(1e-4, dotBot - dotTop)
  tv = Math.max(0, Math.min(1, (dotMid - dotTop) / spanV))

  const rowMid = nlerpUnit(p00, p01, tv)
  const rowEnd = nlerpUnit(p10, p11, tv)
  const dotRowMid = rowMid.x * target.x + rowMid.y * target.y + rowMid.z * target.z
  const dotRowEnd = rowEnd.x * target.x + rowEnd.y * target.y + rowEnd.z * target.z
  const spanU = Math.max(1e-4, dotRowEnd - dotRowMid)
  tu = Math.max(0, Math.min(1, (dotMid - dotRowMid) / spanU))

  const r = (tl.r * (1 - tu) + tr.r * tu) * (1 - tv) + (bl.r * (1 - tu) + br.r * tu) * tv
  const g = (tl.g * (1 - tu) + tr.g * tu) * (1 - tv) + (bl.g * (1 - tu) + br.g * tu) * tv
  const b = (tl.b * (1 - tu) + tr.b * tu) * (1 - tv) + (bl.b * (1 - tu) + br.b * tu) * tv
  const a = (tl.a * (1 - tu) + tr.a * tu) * (1 - tv) + (bl.a * (1 - tu) + br.a * tu) * tv

  return rgb(r, g, b, a)
}

// ---------------------------------------------------------------------------
// Regenerate colors without touching positions
// ---------------------------------------------------------------------------

export function rerandomizeGrid(grid: MeshGrid, config: MeshConfig): MeshGrid {
  const newPoints = grid.points.map((rowArr, row) =>
    rowArr.map((pt, col) => {
      if (pt.pinned) return pt
      const noiseVal = sampleGridNoise(pt.u, pt.v, col, row, config)
      return { ...pt, color: snapToNearestPaletteColor(noiseVal, config.palette) }
    }),
  )
  return { ...grid, points: newPoints }
}
