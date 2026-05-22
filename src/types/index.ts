export interface Color {
  r: number // 0–255
  g: number
  b: number
  a: number // 0–255
}

export interface MeshPoint {
  /** Normalised grid position 0–1 */
  u: number
  v: number
  /** Computed canvas pixel coordinates */
  x: number
  y: number
  color: Color
  /** Whether the user has manually overridden this point's color */
  pinned: boolean
}

export interface MeshGrid {
  /** [row][col] */
  points: MeshPoint[][]
  cols: number
  rows: number
}

export interface PaletteStop {
  id: string
  color: Color
  /** Position 0–1 along the gradient */
  position: number
}

export interface GradientMapConfig {
  enabled: boolean
  stops: PaletteStop[]
  /**
   * Blend midpoint per segment between adjacent sorted stops.
   * Key: `${leftStopId}|${rightStopId}` — 0.05–0.95, default 0.5 (center = smooth).
   * Lower = sharper transition near the left stop; higher = sharper near the right.
   */
  midpoints: Record<string, number>
  /** -1 to 1 — spatial shift of the LUT across the mesh (U axis) */
  offset: number
}

export interface BlurConfig {
  /** 0–1 Gaussian blur strength (maps to ~0–6% of canvas size) */
  gaussian: number
  /** 0–1 directional motion blur length */
  motion: number
  /** Motion blur direction */
  motionAxis: 'horizontal' | 'vertical'
  /** 0–1 spin blur around the sphere center */
  rotation: number
  /** 0–1 film grain / visual noise overlay on the sphere */
  grain: number
}

/** Preview display scale relative to canvasSize (CSS sizing). */
export const DISPLAY_SCALE = 2.5

/** The 3-color palette used by the mesh gradient. */
export interface MeshPalette {
  /** Exactly three hue colors — each grid point snaps to one of these. */
  hues: [Color, Color, Color]
}

export interface MeshConfig {
  /** Number of vertical grid lines (columns) */
  cols: number
  /** Number of horizontal grid lines (rows) */
  rows: number
  /** Noise frequency — higher = more detailed pattern */
  noiseScale: number
  /** Seed drives the noise offset so patterns can be regenerated */
  noiseSeed: number
  /** Number of fBm octaves (1–5) */
  noiseOctaves: number
  /** How much sphere lighting is blended in (0–1) */
  sphereShading: number
  /** Ambient lift and shadow softness — higher = lighter overall (0–1) */
  sphereLightness: number
  /** Specular highlight size and intensity — higher = shinier (0–1) */
  sphereShininess: number
  /**
   * How sharply colors transition between adjacent points (0 = smooth, 1 = harsh).
   * Applies a contrast curve that pushes palette samples toward the extremes so
   * neighbouring points can snap to completely different hues.
   */
  colorContrast: number
  palette: MeshPalette
  gradientMap: GradientMapConfig
  blur: BlurConfig
  /** Rendered canvas size in logical pixels */
  canvasSize: number
}

export type ExportMode = 'raster' | 'vector' | 'png'
