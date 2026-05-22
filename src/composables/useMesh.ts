import { ref, reactive, watch, readonly, computed } from 'vue'
import type { MeshConfig, MeshGrid, MeshPoint, Color, ExportMode } from '../types'
import type { GradientRandomizeOptions } from '../utils/color'
import {
  DEFAULT_PALETTE,
  DEFAULT_GRADIENT_MAP,
  buildRandomGradientMap,
  addStopAt,
  moveStop,
  removeStop,
} from '../utils/color'
import { setSegmentMidpoint, syncMidpoints } from '../utils/gradientMidpoint'
import { buildMeshGrid, rerandomizeGrid } from '../utils/mesh'
import { exportRasterSVG, exportVectorSVG, exportPNG, downloadFile } from '../utils/export'

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: MeshConfig = {
  cols: 5,
  rows: 5,
  noiseScale: 1.4,
  noiseSeed: 42,
  noiseOctaves: 3,
  sphereShading: 0,
  sphereLightness: 0,
  sphereShininess: 0,
  colorContrast: 0.55,
  palette: DEFAULT_PALETTE,
  gradientMap: DEFAULT_GRADIENT_MAP,
  blur: { gaussian: 0, motion: 0, motionAxis: 'horizontal', rotation: 0, grain: 0.1 },
  canvasSize: 600,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export function useMesh() {
  const config = reactive<MeshConfig>({
    ...DEFAULT_CONFIG,
    palette: DEFAULT_PALETTE,
    gradientMap: {
      enabled: DEFAULT_GRADIENT_MAP.enabled,
      offset: DEFAULT_GRADIENT_MAP.offset,
      midpoints: syncMidpoints(DEFAULT_GRADIENT_MAP.stops, {}),
      stops: DEFAULT_GRADIENT_MAP.stops.map((s) => ({
        ...s,
        color: { ...s.color },
      })),
    },
    blur: { ...DEFAULT_CONFIG.blur },
  })

  // The current mesh grid — rebuilt whenever config changes
  const grid = ref<MeshGrid>(buildMeshGrid(config))

  // The selected mesh point for color editing
  const selectedPoint = ref<{ row: number; col: number } | null>(null)

  // Whether we are currently rendering (for loading indicator)
  const isRendering = ref(false)
  const exportMode = ref<ExportMode | null>(null)

  const gradientRandomize = reactive({
    reds: true,
    greens: true,
    blues: true,
  })

  const renderingLabel = computed(() => {
    switch (exportMode.value) {
      case 'png':
        return 'Generating PNG…'
      case 'vector':
        return 'Generating vector SVG…'
      case 'raster':
        return 'Generating SVG…'
      default:
        return 'Rendering…'
    }
  })

  /** Bumped when gradient-map UI changes (avoids deep watch on stops). */
  const renderVersion = ref(0)

  function bumpRender() {
    renderVersion.value++
  }

  // Debounce timer
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // ---------------------------------------------------------------------------
  // Grid rebuild
  // ---------------------------------------------------------------------------

  function rebuildGrid(preservePins = true) {
    const prev = preservePins ? grid.value : undefined
    grid.value = buildMeshGrid(config, prev)
  }

  /** Re-randomize only the noise seed, keeping pinned colors. */
  function randomize() {
    config.noiseSeed = Math.floor(Math.random() * 100000)
    grid.value = rerandomizeGrid(grid.value, config)
  }

  /** Full reset — clear all pins and rebuild. */
  function reset() {
    selectedPoint.value = null
    // Unpin all points
    grid.value.points.forEach((row) => row.forEach((pt) => (pt.pinned = false)))
    config.noiseSeed = Math.floor(Math.random() * 100000)
    rebuildGrid(false)
  }

  // ---------------------------------------------------------------------------
  // Watch config for reactive re-renders (debounced)
  // ---------------------------------------------------------------------------

  function scheduleRebuild() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      rebuildGrid(true)
    }, 120)
  }

  watch(
    () => [config.cols, config.rows],
    () => {
      // Grid dimension change: re-position all points (pins lose meaning)
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => rebuildGrid(false), 120)
    },
  )

  watch(
    () => [config.noiseScale, config.noiseSeed, config.noiseOctaves, config.colorContrast],
    scheduleRebuild,
  )

  watch(
    () => [config.palette.hues[0], config.palette.hues[1], config.palette.hues[2]],
    scheduleRebuild,
    { deep: true },
  )

  // ---------------------------------------------------------------------------
  // Point interaction
  // ---------------------------------------------------------------------------

  function selectPoint(row: number, col: number) {
    selectedPoint.value = { row, col }
  }

  function deselectPoint() {
    selectedPoint.value = null
  }

  function setPointColor(row: number, col: number, color: Color) {
    const pt = grid.value.points[row]?.[col]
    if (!pt) return
    pt.color = color
    pt.pinned = true
    // Trigger reactivity (grid is a ref, points array mutation needs nudge)
    grid.value = { ...grid.value, points: grid.value.points.map((r) => [...r]) }
  }

  function unpinPoint(row: number, col: number) {
    const pt = grid.value.points[row]?.[col]
    if (!pt) return
    pt.pinned = false
    // Re-compute noise color for this point
    const rebuiltGrid = rerandomizeGrid(grid.value, config)
    grid.value = rebuiltGrid
  }

  // ---------------------------------------------------------------------------
  // Palette helpers
  // ---------------------------------------------------------------------------

  function setPaletteHue(index: 0 | 1 | 2, color: Color) {
    config.palette.hues[index] = color
    scheduleRebuild()
  }

  // ---------------------------------------------------------------------------
  // Gradient map helpers (render-time only — no grid rebuild)
  // ---------------------------------------------------------------------------

  function setGradientMapEnabled(enabled: boolean) {
    config.gradientMap.enabled = enabled
    bumpRender()
  }

  function setGradientMapOffset(offset: number) {
    config.gradientMap.offset = offset
    bumpRender()
  }

  function addGradientStop(position: number, color: Color) {
    const stops = addStopAt(
      config.gradientMap.stops,
      position,
      color,
      config.gradientMap.midpoints,
    )
    config.gradientMap.stops = stops
    config.gradientMap.midpoints = syncMidpoints(stops, config.gradientMap.midpoints)
    bumpRender()
  }

  function removeGradientStop(id: string) {
    const stops = removeStop(config.gradientMap.stops, id)
    config.gradientMap.stops = stops
    config.gradientMap.midpoints = syncMidpoints(stops, config.gradientMap.midpoints)
    bumpRender()
  }

  function moveGradientStop(id: string, position: number) {
    const stops = moveStop(config.gradientMap.stops, id, position)
    config.gradientMap.stops = stops
    config.gradientMap.midpoints = syncMidpoints(stops, config.gradientMap.midpoints)
    bumpRender()
  }

  function setGradientMidpoint(leftId: string, rightId: string, value: number) {
    config.gradientMap.midpoints = setSegmentMidpoint(
      config.gradientMap.midpoints,
      leftId,
      rightId,
      value,
    )
    bumpRender()
  }

  function setGradientStopColor(id: string, color: Color) {
    const stop = config.gradientMap.stops.find((s) => s.id === id)
    if (!stop) return
    stop.color = color
    bumpRender()
  }

  /** Randomize gradient map stops, blend midpoints, and offset (4–7 stops). */
  function randomizeGradient() {
    const opts: GradientRandomizeOptions = {
      enabled: config.gradientMap.enabled,
      reds: gradientRandomize.reds,
      greens: gradientRandomize.greens,
      blues: gradientRandomize.blues,
    }
    const next = buildRandomGradientMap(opts)
    config.gradientMap.stops = next.stops.map((s) => ({
      ...s,
      color: { ...s.color },
    }))
    config.gradientMap.midpoints = { ...next.midpoints }
    config.gradientMap.offset = next.offset
    bumpRender()
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  function exportAs(mode: ExportMode = 'raster', exportSize: number = 1200) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

    exportMode.value = mode
    isRendering.value = true

    // Defer heavy work so the loading indicator has time to paint
    setTimeout(async () => {
      try {
        if (mode === 'png') {
          await exportPNG(grid.value, config, exportSize)
        } else if (mode === 'raster') {
          const svg = await exportRasterSVG(grid.value, config, exportSize)
          downloadFile(svg, `orbmaker-${timestamp}.svg`)
        } else {
          // Vector SVG: subdivisions scale with size for smoother output at 4K
          const subs = exportSize >= 2000 ? 6 : 4
          const svg = exportVectorSVG(grid.value, config, subs, exportSize)
          downloadFile(svg, `orbmaker-vector-${timestamp}.svg`)
        }
      } finally {
        isRendering.value = false
        exportMode.value = null
      }
    }, 20)
  }

  // ---------------------------------------------------------------------------
  // Exposed
  // ---------------------------------------------------------------------------

  return {
    config,
    grid: readonly(grid),
    selectedPoint: readonly(selectedPoint),
    isRendering: readonly(isRendering),
    renderingLabel,
    gradientRandomize,
    renderVersion: readonly(renderVersion),
    // Actions
    randomize,
    reset,
    selectPoint,
    deselectPoint,
    setPointColor,
    unpinPoint,
    setPaletteHue,
    setGradientMapEnabled,
    setGradientMapOffset,
    addGradientStop,
    removeGradientStop,
    moveGradientStop,
    setGradientMidpoint,
    setGradientStopColor,
    randomizeGradient,
    exportAs,
  }
}
