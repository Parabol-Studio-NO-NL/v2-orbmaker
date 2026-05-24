import type { ExportMode, MeshGrid, MeshConfig } from '../types'
import { canvasToUv, sampleGridAtUV, uvToCanvas } from './mesh'
import { applyGradientMap } from './color'
import { DEFAULT_SVG_SHAPE_URL } from '../config/defaults'
import { createExportCanvas } from './render'
import { renderInWorker, shouldUseRenderWorker } from './renderWorker'
import type { ShapeDefinition } from './shapeDomain'
import {
  buildShapeMask,
  getShapeClipPathMarkup,
  getSphereClipPathMarkup,
  pixelToUv,
  scaleShapeForSize,
  sphereLayout,
  uvToCanvasBbox,
} from './shapeDomain'

// ---------------------------------------------------------------------------
// Export filenames
// ---------------------------------------------------------------------------

function exportTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

/** Base name for downloads — v2 logotype vs orb. */
export function getExportFilename(mode: ExportMode, renderMode: MeshConfig['renderMode']): string {
  const ts = exportTimestamp()
  const base = renderMode === 'svg' ? 'orbmaker-v2-type' : 'orbmaker-orb'
  switch (mode) {
    case 'png':
      return `${base}-${ts}.png`
    case 'vector':
      return `${base}-vector-${ts}.svg`
    case 'raster':
      return `${base}-${ts}.svg`
  }
}

// ---------------------------------------------------------------------------
// Raster SVG export — PNG embedded inside SVG with shape clip path
// ---------------------------------------------------------------------------

export async function exportRasterSVG(
  grid: MeshGrid,
  config: MeshConfig,
  size: number,
  shape?: ShapeDefinition | null,
  shapeUrl = DEFAULT_SVG_SHAPE_URL,
): Promise<string> {
  const isSvg = config.renderMode === 'svg' && shape
  const scaledShape = isSvg ? scaleShapeForSize(shape!, size) : null
  const canvas = await createExportCanvasAsync(
    grid,
    config,
    size,
    scaledShape ?? shape,
    shapeUrl,
  )
  const dataUrl = canvas.toDataURL('image/png')

  const clipId = isSvg ? 'shape-clip' : 'sphere-clip'
  const clipDefs = isSvg
    ? getShapeClipPathMarkup(scaledShape!, size, clipId)
    : getSphereClipPathMarkup(size, clipId)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    `     width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `  <defs>`,
    clipDefs,
    `  </defs>`,
    `  <image`,
    `    href="${dataUrl}"`,
    `    x="0" y="0"`,
    `    width="${size}" height="${size}"`,
    `    clip-path="url(#${clipId})"`,
    `  />`,
    `</svg>`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Vector SVG export — triangulated mesh polygons
// ---------------------------------------------------------------------------

export function exportVectorSVG(
  grid: MeshGrid,
  config: MeshConfig,
  subdivisions: number = 3,
  size: number = config.canvasSize,
  shape?: ShapeDefinition | null,
  shapeUrl = DEFAULT_SVG_SHAPE_URL,
): string {
  const isSvg = config.renderMode === 'svg' && shape
  const effectiveShape = isSvg ? scaleShapeForSize(shape!, size) : null
  const mask =
    isSvg && effectiveShape ? buildShapeMask(size, effectiveShape, shapeUrl) : null

  const { cx, cy, radius } = sphereLayout(size)

  const polys: string[] = []

  const totalCols = (grid.cols - 1) * subdivisions + 1
  const totalRows = (grid.rows - 1) * subdivisions + 1

  type LatticePoint = { x: number; y: number; r: number; g: number; b: number; inside: boolean }
  const lattice: LatticePoint[][] = []

  for (let row = 0; row < totalRows; row++) {
    const rowArr: LatticePoint[] = []
    for (let col = 0; col < totalCols; col++) {
      const u = col / (totalCols - 1)
      const v = row / (totalRows - 1)

      const { x, y } = isSvg
        ? uvToCanvasBbox(u, v, effectiveShape!.fit)
        : uvToCanvas(u, v, cx, cy, radius)

      let inside = false
      if (isSvg && mask) {
        const px = x | 0
        const py = y | 0
        if (px >= 0 && px < size && py >= 0 && py < size) {
          inside = mask[py * size + px] === 1
        }
      } else {
        const dx = x - cx
        const dy = y - cy
        inside = dx * dx + dy * dy <= radius * radius
      }

      let r = 0,
        g = 0,
        b = 0
      if (inside) {
        const su = isSvg
          ? pixelToUv(x, y, effectiveShape!.fit).u
          : canvasToUv(x, y, cx, cy, radius).u
        const sv = isSvg
          ? pixelToUv(x, y, effectiveShape!.fit).v
          : canvasToUv(x, y, cx, cy, radius).v
        const meshColor = sampleGridAtUV(su, sv, grid, config.renderMode)
        const c = applyGradientMap(meshColor, su, config.gradientMap)
        r = Math.round(c.r)
        g = Math.round(c.g)
        b = Math.round(c.b)
      }

      rowArr.push({ x, y, r, g, b, inside })
    }
    lattice.push(rowArr)
  }

  for (let row = 0; row < totalRows - 1; row++) {
    for (let col = 0; col < totalCols - 1; col++) {
      const tl = lattice[row][col]
      const tr = lattice[row][col + 1]
      const bl = lattice[row + 1][col]
      const br = lattice[row + 1][col + 1]

      const anyInside = [tl, tr, bl, br].some((p) => p.inside)
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

  const clipId = isSvg ? 'shape-clip' : 'sphere-clip'
  const clipDefs = isSvg
    ? getShapeClipPathMarkup(effectiveShape!, size, clipId)
    : getSphereClipPathMarkup(size, clipId)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `  <defs>`,
    clipDefs,
    `  </defs>`,
    `  <g clip-path="url(#${clipId})">`,
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
  shape?: ShapeDefinition | null,
  shapeUrl = DEFAULT_SVG_SHAPE_URL,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  if (shouldUseRenderWorker(size)) {
    const imageData = await renderInWorker(grid, config, size, shape, shapeUrl)
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.putImageData(imageData, 0, 0)
    return canvas
  }

  return createExportCanvas(grid, config, size, shape, shapeUrl)
}

export async function exportPNG(
  grid: MeshGrid,
  config: MeshConfig,
  size: number,
  shape?: ShapeDefinition | null,
  shapeUrl = DEFAULT_SVG_SHAPE_URL,
): Promise<void> {
  const filename = getExportFilename('png', config.renderMode)
  const canvas = await createExportCanvasAsync(grid, config, size, shape, shapeUrl)
  canvas.toBlob(
    (blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    },
    'image/png',
  )
}

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
