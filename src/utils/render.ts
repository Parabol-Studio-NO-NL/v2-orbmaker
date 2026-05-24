import type { MeshConfig, MeshGrid } from '../types'
import { applyPostProcessBlur } from './blur'
import { DEFAULT_SVG_SHAPE_URL } from '../config/defaults'
import { getGradientLut, invalidateUvCache, renderMeshPixels } from './renderCore'
import type { ShapeDefinition } from './shapeDomain'
import { buildShapeMask, scaleShapeForSize } from './shapeDomain'

/**
 * Render a mesh gradient into any HTMLCanvasElement.
 *
 * Uses the canvas's own pixel dimensions — not config.canvasSize — so the same
 * function works for both the 600px live preview and any hi-res export canvas.
 * No overlay (grid lines, point handles) is drawn here; the caller is responsible
 * for adding UI chrome on top if needed.
 */
export function renderMeshToCanvas(
  canvas: HTMLCanvasElement,
  grid: MeshGrid,
  config: MeshConfig,
  shape?: ShapeDefinition | null,
  shapeUrl = DEFAULT_SVG_SHAPE_URL,
): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) return

  const size = canvas.width
  if (size !== canvas.height) {
    invalidateUvCache()
  }

  getGradientLut(config.gradientMap)

  const svgShape =
    config.renderMode === 'svg' && shape
      ? size === config.canvasSize
        ? shape
        : scaleShapeForSize(shape, size)
      : null

  const imageData = ctx.createImageData(size, size)
  renderMeshPixels(imageData.data, size, grid, config, svgShape ?? shape, shapeUrl)

  let mask: Uint8Array | undefined
  let blurCx: number | undefined
  let blurCy: number | undefined
  if (config.renderMode === 'svg' && svgShape) {
    mask = buildShapeMask(size, svgShape, shapeUrl)
    blurCx = svgShape.cx
    blurCy = svgShape.cy
  }

  applyPostProcessBlur(
    imageData.data,
    size,
    config.blur,
    config.noiseSeed,
    mask,
    blurCx,
    blurCy,
  )
  ctx.putImageData(imageData, 0, 0)
}

/** Apply blur to raw RGBA buffer (export worker path). */
export function finishImageData(
  data: Uint8ClampedArray,
  size: number,
  config: MeshConfig,
  payload?: import('./renderCore').RenderPayload,
): void {
  if (payload?.renderMode === 'svg' && payload.mask) {
    applyPostProcessBlur(
      data,
      size,
      config.blur,
      config.noiseSeed,
      payload.mask,
      payload.blurCx,
      payload.blurCy,
    )
    return
  }
  applyPostProcessBlur(data, size, config.blur, config.noiseSeed)
}

/**
 * Create a standalone, overlay-free HTMLCanvasElement at any pixel size.
 * Safe to call off the main render path (e.g. inside a setTimeout for large sizes).
 */
export function createExportCanvas(
  grid: MeshGrid,
  config: MeshConfig,
  size: number,
  shape?: ShapeDefinition | null,
  shapeUrl = DEFAULT_SVG_SHAPE_URL,
): HTMLCanvasElement {
  invalidateUvCache()
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  renderMeshToCanvas(canvas, grid, config, shape, shapeUrl)
  invalidateUvCache()
  return canvas
}

export { invalidateGradientLut, invalidateUvCache } from './renderCore'
