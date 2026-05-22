import type { MeshConfig, MeshGrid } from '../types'
import { applyPostProcessBlur } from './blur'
import { getGradientLut, invalidateUvCache, renderMeshPixels } from './renderCore'

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
): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) return

  const size = canvas.width
  if (size !== canvas.height) {
    invalidateUvCache()
  }

  getGradientLut(config.gradientMap)

  const imageData = ctx.createImageData(size, size)
  renderMeshPixels(imageData.data, size, grid, config)
  applyPostProcessBlur(imageData.data, size, config.blur, config.noiseSeed)
  ctx.putImageData(imageData, 0, 0)
}

/** Apply blur to raw RGBA buffer (export worker path). */
export function finishImageData(
  data: Uint8ClampedArray,
  size: number,
  config: MeshConfig,
): void {
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
): HTMLCanvasElement {
  invalidateUvCache()
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  renderMeshToCanvas(canvas, grid, config)
  invalidateUvCache()
  return canvas
}

export { invalidateGradientLut, invalidateUvCache } from './renderCore'
