import type { MeshGrid, MeshConfig } from '../types'
import { canvasToUv, sampleGridAtUV, uvToCanvas } from './mesh'
import { applyGradientMap } from './color'
import { createExportCanvas } from './render'
import { renderInWorker, shouldUseRenderWorker } from './renderWorker'

// ---------------------------------------------------------------------------
// Raster SVG export — clean PNG embedded inside SVG with circular clip path
// ---------------------------------------------------------------------------

/**
 * Render a fresh, overlay-free canvas at `size × size` pixels and embed it
 * as a PNG data URL inside an SVG `<image>` clipped to a circle.
 */
export async function exportRasterSVG(
  grid: MeshGrid,
  config: MeshConfig,
  size: number,
): Promise<string> {
  const canvas = await createExportCanvasAsync(grid, config, size)
  const dataUrl = canvas.toDataURL('image/png')
  const cx = size / 2
  const r = size * 0.46

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    `     width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `  <defs>`,
    `    <clipPath id="sphere-clip">`,
    `      <circle cx="${cx}" cy="${cx}" r="${r}"/>`,
    `    </clipPath>`,
    `  </defs>`,
    `  <image`,
    `    href="${dataUrl}"`,
    `    x="0" y="0"`,
    `    width="${size}" height="${size}"`,
    `    clip-path="url(#sphere-clip)"`,
    `  />`,
    `</svg>`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Vector SVG export — triangulated mesh polygons
// ---------------------------------------------------------------------------

/**
 * Export a pure-vector SVG by subdividing the mesh grid into triangles.
 */
export function exportVectorSVG(
  grid: MeshGrid,
  config: MeshConfig,
  subdivisions: number = 3,
  size: number = config.canvasSize,
): string {
  const cx = size / 2
  const cy = size / 2
  const radius = size * 0.46

  const polys: string[] = []

  const totalCols = (grid.cols - 1) * subdivisions + 1
  const totalRows = (grid.rows - 1) * subdivisions + 1

  type LatticePoint = { x: number; y: number; r: number; g: number; b: number }
  const lattice: LatticePoint[][] = []

  for (let row = 0; row < totalRows; row++) {
    const rowArr: LatticePoint[] = []
    for (let col = 0; col < totalCols; col++) {
      const u = col / (totalCols - 1)
      const v = row / (totalRows - 1)

      const { x, y } = uvToCanvas(u, v, cx, cy, radius)

      const dx = x - cx
      const dy = y - cy
      const inside = dx * dx + dy * dy <= radius * radius

      let r = 0,
        g = 0,
        b = 0
      if (inside) {
        const { u: su, v: sv } = canvasToUv(x, y, cx, cy, radius)
        const meshColor = sampleGridAtUV(su, sv, grid)
        const c = applyGradientMap(meshColor, su, config.gradientMap)
        r = Math.round(c.r)
        g = Math.round(c.g)
        b = Math.round(c.b)
      }

      rowArr.push({ x, y, r, g, b })
    }
    lattice.push(rowArr)
  }

  for (let row = 0; row < totalRows - 1; row++) {
    for (let col = 0; col < totalCols - 1; col++) {
      const tl = lattice[row][col]
      const tr = lattice[row][col + 1]
      const bl = lattice[row + 1][col]
      const br = lattice[row + 1][col + 1]

      const anyInside = [tl, tr, bl, br].some((p) => {
        const dx = p.x - cx
        const dy = p.y - cy
        return dx * dx + dy * dy <= radius * radius * 1.05
      })
      if (!anyInside) continue

      const c1r = Math.round((tl.r + tr.r + bl.r) / 3)
      const c1g = Math.round((tl.g + tr.g + bl.g) / 3)
      const c1b = Math.round((tl.b + tr.b + bl.b) / 3)
      polys.push(
        `<polygon points="${fmt(tl.x)},${fmt(tl.y)} ${fmt(tr.x)},${fmt(tr.y)} ${fmt(bl.x)},${fmt(bl.y)}" fill="rgb(${c1r},${c1g},${c1b})"/>`,
      )

      const c2r = Math.round((tr.r + br.r + bl.r) / 3)
      const c2g = Math.round((tr.g + br.g + bl.g) / 3)
      const c2b = Math.round((tr.b + br.b + bl.b) / 3)
      polys.push(
        `<polygon points="${fmt(tr.x)},${fmt(tr.y)} ${fmt(br.x)},${fmt(br.y)} ${fmt(bl.x)},${fmt(bl.y)}" fill="rgb(${c2r},${c2g},${c2b})"/>`,
      )
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `  <defs>`,
    `    <clipPath id="sphere-clip">`,
    `      <circle cx="${cx}" cy="${cy}" r="${radius}"/>`,
    `    </clipPath>`,
    `  </defs>`,
    `  <g clip-path="url(#sphere-clip)">`,
    ...polys.map((p) => `    ${p}`),
    `  </g>`,
    `</svg>`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// PNG export
// ---------------------------------------------------------------------------

async function createExportCanvasAsync(
  grid: MeshGrid,
  config: MeshConfig,
  size: number,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  if (shouldUseRenderWorker(size)) {
    const imageData = await renderInWorker(grid, config, size)
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.putImageData(imageData, 0, 0)
    return canvas
  }

  return createExportCanvas(grid, config, size)
}

/**
 * Render a clean export canvas at `size × size` and trigger a PNG download.
 */
export async function exportPNG(
  grid: MeshGrid,
  config: MeshConfig,
  size: number,
): Promise<void> {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const canvas = await createExportCanvasAsync(grid, config, size)
  canvas.toBlob(
    (blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `orbmaker-${timestamp}.png`
      a.click()
      URL.revokeObjectURL(url)
    },
    'image/png',
  )
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

export function downloadFile(content: string, filename: string, mimeType = 'image/svg+xml'): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function fmt(n: number): string {
  return n.toFixed(2)
}
