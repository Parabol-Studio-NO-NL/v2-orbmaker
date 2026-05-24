import { ref, reactive, watch, readonly, computed, onMounted } from 'vue'
import type { MeshConfig, MeshGrid, MeshPoint, Color, ExportMode, RenderMode } from '../types'
import type { GradientRandomizeOptions } from '../utils/color'
import { buildRandomGradientMap, addStopAt, moveStop, removeStop } from '../utils/color'
import {
  DEFAULT_PALETTE,
  DEFAULT_GRADIENT_MAP,
  DEFAULT_GRADIENT_RANDOMIZE,
  DEFAULT_MESH_CONFIG,
  DEFAULT_SVG_SHAPE_URL,
} from '../config/defaults'
import { setSegmentMidpoint, syncMidpoints } from '../utils/gradientMidpoint'
import { buildMeshGrid, rerandomizeGrid } from '../utils/mesh'
import {
  exportRasterSVG,
  exportVectorSVG,
  exportPNG,
  downloadFile,
  getExportFilename,
} from '../utils/export'
import { invalidateUvCache } from '../utils/renderCore'
import {
  invalidateShapeMaskCache,
  loadSvgShape,
  type ShapeDefinition,
} from '../utils/shapeDomain'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export function useMesh() {
  const config = reactive<MeshConfig>({
    ...DEFAULT_MESH_CONFIG,
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
    blur: { ...DEFAULT_MESH_CONFIG.blur },
  })

  // The current mesh grid — rebuilt whenever config changes
  const grid = ref<MeshGrid>(buildMeshGrid(config))

  // The selected mesh point for color editing
  const selectedPoint = ref<{ row: number; col: number } | null>(null)

  // Whether we are currently rendering (for loading indicator)
  const isRendering = ref(false)
  const exportMode = ref<ExportMode | null>(null)

  const gradientRandomize = reactive({ ...DEFAULT_GRADIENT_RANDOMIZE })

  const shapeDefinition = ref<ShapeDefinition | null>(null)
  const shapeLoadError = ref<string | null>(null)
  let shapeLoading: Promise<void> | null = null

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

  async function ensureShapeLoaded(): Promise<ShapeDefinition | null> {
    if (config.renderMode !== 'svg') return null
    if (shapeDefinition.value) return shapeDefinition.value
    if (shapeLoading) {
      await shapeLoading
      return shapeDefinition.value
    }
    shapeLoading = (async () => {
      try {
        shapeLoadError.value = null
        shapeDefinition.value = await loadSvgShape(
          DEFAULT_SVG_SHAPE_URL,
          config.canvasSize,
        )
        invalidateShapeMaskCache()
      } catch (e) {
        shapeLoadError.value =
          e instanceof Error ? e.message : 'Failed to load shape SVG'
        shapeDefinition.value = null
      } finally {
        shapeLoading = null
      }
    })()
    await shapeLoading
    return shapeDefinition.value
  }

  function rebuildGrid(preservePins = true) {
    const prev = preservePins ? grid.value : undefined
    const shape = config.renderMode === 'svg' ? shapeDefinition.value : null
    grid.value = buildMeshGrid(config, prev, shape)
  }

  async function setRenderMode(mode: RenderMode) {
    if (config.renderMode === mode) return
    config.renderMode = mode
    invalidateUvCache()
    invalidateShapeMaskCache()
    if (mode === 'svg') {
      await ensureShapeLoaded()
    }
    rebuildGrid(false)
    bumpRender()
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
    exportMode.value = mode
    isRendering.value = true

    // Defer heavy work so the loading indicator has time to paint
    setTimeout(async () => {
      try {
        let shape =
          config.renderMode === 'svg' ? await ensureShapeLoaded() : null
        if (config.renderMode === 'svg' && !shape) {
          console.error('SVG shape not loaded — export aborted')
          return
        }

        if (mode === 'png') {
          await exportPNG(grid.value, config, exportSize, shape)
        } else if (mode === 'raster') {
          const svg = await exportRasterSVG(grid.value, config, exportSize, shape)
          downloadFile(svg, getExportFilename('raster', config.renderMode))
        } else {
          const subs = exportSize >= 2000 ? 6 : 4
          const svg = exportVectorSVG(grid.value, config, subs, exportSize, shape)
          downloadFile(svg, getExportFilename('vector', config.renderMode))
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

  onMounted(() => {
    if (config.renderMode === 'svg') {
      ensureShapeLoaded().then(() => rebuildGrid(false))
    }
  })

  return {
    config,
    grid: readonly(grid),
    selectedPoint: readonly(selectedPoint),
    isRendering: readonly(isRendering),
    renderingLabel,
    gradientRandomize,
    renderVersion: readonly(renderVersion),
    shapeDefinition: readonly(shapeDefinition),
    shapeLoadError: readonly(shapeLoadError),
    // Actions
    setRenderMode,
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
