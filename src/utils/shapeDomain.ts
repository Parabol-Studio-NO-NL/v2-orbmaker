// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShapeViewBox {
  x: number
  y: number
  w: number
  h: number
}

export interface ShapeFit {
  bx: number
  by: number
  bw: number
  bh: number
  scale: number
}

export interface ShapeDefinition {
  viewBox: ShapeViewBox
  paths: readonly Path2D[]
  /** Original path `d` strings for SVG export clip */
  pathDs: readonly string[]
  fit: ShapeFit
  /** Blur / rotation pivot (bbox center on canvas) */
  cx: number
  cy: number
}

const maskCache = new Map<string, Uint8Array>()

function maskCacheKey(url: string, size: number, shape: ShapeDefinition): string {
  const { fit } = shape
  return `${url}@${size}@${fit.bx}|${fit.by}|${fit.bw}|${fit.bh}|${fit.scale}`
}

// ---------------------------------------------------------------------------
// SVG load & parse
// ---------------------------------------------------------------------------

function parseViewBox(svg: SVGSVGElement): ShapeViewBox {
  const vb = svg.viewBox?.baseVal
  if (vb && vb.width > 0 && vb.height > 0) {
    return { x: vb.x, y: vb.y, w: vb.width, h: vb.height }
  }
  const w = parseFloat(svg.getAttribute('width') ?? '0') || 100
  const h = parseFloat(svg.getAttribute('height') ?? '0') || 100
  return { x: 0, y: 0, w, h }
}

function polygonToPathD(pointsAttr: string): string {
  const nums = pointsAttr
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
  if (nums.length < 4) return ''
  let d = `M ${nums[0]} ${nums[1]}`
  for (let i = 2; i < nums.length; i += 2) {
    d += ` L ${nums[i]} ${nums[i + 1]}`
  }
  return `${d} Z`
}

function collectPaths(svg: SVGSVGElement): { paths: Path2D[]; pathDs: string[] } {
  const paths: Path2D[] = []
  const pathDs: string[] = []

  const addD = (d: string | null) => {
    if (!d?.trim()) return
    paths.push(new Path2D(d))
    pathDs.push(d)
  }

  for (const el of svg.querySelectorAll('path')) {
    addD(el.getAttribute('d'))
  }
  for (const el of svg.querySelectorAll('polygon')) {
    const d = polygonToPathD(el.getAttribute('points') ?? '')
    addD(d)
  }
  for (const el of svg.querySelectorAll('polyline')) {
    const pts = el.getAttribute('points') ?? ''
    const nums = pts.trim().split(/[\s,]+/).map(Number)
    if (nums.length >= 4) {
      let d = `M ${nums[0]} ${nums[1]}`
      for (let i = 2; i < nums.length; i += 2) d += ` L ${nums[i]} ${nums[i + 1]}`
      addD(d)
    }
  }
  for (const el of svg.querySelectorAll('rect')) {
    const x = parseFloat(el.getAttribute('x') ?? '0')
    const y = parseFloat(el.getAttribute('y') ?? '0')
    const w = parseFloat(el.getAttribute('width') ?? '0')
    const h = parseFloat(el.getAttribute('height') ?? '0')
    if (w > 0 && h > 0) addD(`M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`)
  }
  for (const el of svg.querySelectorAll('circle')) {
    const cx = parseFloat(el.getAttribute('cx') ?? '0')
    const cy = parseFloat(el.getAttribute('cy') ?? '0')
    const r = parseFloat(el.getAttribute('r') ?? '0')
    if (r > 0) addD(`M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`)
  }

  return { paths, pathDs }
}

export function fitShapeToCanvas(
  viewBox: ShapeViewBox,
  canvasSize: number,
  paddingRatio = 0.04,
): ShapeFit {
  const pad = paddingRatio * canvasSize
  const avail = canvasSize - 2 * pad
  const scale = Math.min(avail / viewBox.w, avail / viewBox.h)
  const bw = viewBox.w * scale
  const bh = viewBox.h * scale
  const bx = (canvasSize - bw) / 2
  const by = (canvasSize - bh) / 2
  return { bx, by, bw, bh, scale }
}

export async function loadSvgShape(url: string, canvasSize: number): Promise<ShapeDefinition> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load shape SVG: ${url}`)
  const text = await res.text()
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const svg = doc.documentElement as unknown as SVGSVGElement
  const viewBox = parseViewBox(svg)
  const { paths, pathDs } = collectPaths(svg)
  if (paths.length === 0) throw new Error('SVG contains no drawable paths')

  const fit = fitShapeToCanvas(viewBox, canvasSize)
  return {
    viewBox,
    paths,
    pathDs,
    fit,
    cx: fit.bx + fit.bw / 2,
    cy: fit.by + fit.bh / 2,
  }
}

// ---------------------------------------------------------------------------
// Mask
// ---------------------------------------------------------------------------

export function buildShapeMask(
  size: number,
  shape: ShapeDefinition,
  url = '',
): Uint8Array {
  const key = maskCacheKey(url || 'default', size, shape)
  const cached = maskCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create mask canvas')

  const { viewBox, paths, fit } = shape
  ctx.fillStyle = '#fff'
  ctx.save()
  ctx.translate(fit.bx, fit.by)
  ctx.scale(fit.scale, fit.scale)
  ctx.translate(-viewBox.x, -viewBox.y)
  for (const path of paths) {
    ctx.fill(path, 'evenodd')
  }
  ctx.restore()

  const img = ctx.getImageData(0, 0, size, size)
  const mask = new Uint8Array(size * size)
  for (let i = 0; i < size * size; i++) {
    mask[i] = img.data[i * 4 + 3] > 8 ? 1 : 0
  }

  maskCache.set(key, mask)
  return mask
}

export function invalidateShapeMaskCache(): void {
  maskCache.clear()
}

// ---------------------------------------------------------------------------
// UV / canvas mapping (bbox-linear)
// ---------------------------------------------------------------------------

export function uvToCanvasBbox(
  u: number,
  v: number,
  fit: ShapeFit,
): { x: number; y: number } {
  return {
    x: fit.bx + u * fit.bw,
    y: fit.by + v * fit.bh,
  }
}

export function pixelToUv(
  px: number,
  py: number,
  fit: ShapeFit,
): { u: number; v: number } {
  return {
    u: fit.bw > 0 ? (px - fit.bx) / fit.bw : 0.5,
    v: fit.bh > 0 ? (py - fit.by) / fit.bh : 0.5,
  }
}

// ---------------------------------------------------------------------------
// Export clip path
// ---------------------------------------------------------------------------

export function getShapeClipPathMarkup(
  shape: ShapeDefinition,
  size: number,
  id = 'shape-clip',
): string {
  const { viewBox, pathDs, fit } = shape
  const tx = fit.bx - viewBox.x * fit.scale
  const ty = fit.by - viewBox.y * fit.scale
  const paths = pathDs
    .map((d) => `      <path d="${escapeAttr(d)}" transform="translate(${fmt(tx)},${fmt(ty)}) scale(${fmt(fit.scale)})"/>`)
    .join('\n')
  return [
    `    <clipPath id="${id}" clipPathUnits="userSpaceOnUse">`,
    paths,
    `    </clipPath>`,
  ].join('\n')
}

export function getSphereClipPathMarkup(size: number, id = 'sphere-clip'): string {
  const cx = size / 2
  const r = size * 0.46
  return [
    `    <clipPath id="${id}">`,
    `      <circle cx="${cx}" cy="${cx}" r="${r}"/>`,
    `    </clipPath>`,
  ].join('\n')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function fmt(n: number): string {
  return n.toFixed(4)
}

/** Sphere layout constants for a square canvas. */
export function sphereLayout(size: number) {
  const cx = size / 2
  const cy = size / 2
  const radius = size * 0.46
  return { cx, cy, radius, radius2: radius * radius }
}

/** Recompute fit for a different square canvas size (export resolution). */
export function scaleShapeForSize(shape: ShapeDefinition, size: number): ShapeDefinition {
  const fit = fitShapeToCanvas(shape.viewBox, size)
  return {
    ...shape,
    fit,
    cx: fit.bx + fit.bw / 2,
    cy: fit.by + fit.bh / 2,
  }
}
