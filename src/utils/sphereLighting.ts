/** Directional light (top-left, slightly forward). */
const LX = -0.35
const LY = -0.5
const LZ = 0.8

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Combined shading factor for a sphere surface point.
 * @param lightness 0 = deep shadows, 1 = lifted ambient / softer contrast
 * @param shininess 0 = matte diffuse, 1 = tight specular highlight
 */
export function computeSphereShadeFactor(
  nx: number,
  ny: number,
  lightness: number,
  shininess: number,
): number {
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
  const diffuse = clamp01(nx * LX + ny * LY + nz * LZ)

  const specExp = 4 + shininess * 120
  const specWeight = shininess * 0.72
  const reflect = 2 * diffuse
  const spec = Math.pow(clamp01(reflect * nz - LZ), specExp)

  const ambient = 0.08 + lightness * 0.42
  const diffuseWeight = 0.78 - shininess * 0.22

  return clamp01(ambient + diffuse * diffuseWeight + spec * specWeight)
}

/** Apply sphere lighting to an RGB triplet (allocation-free render path). */
export function applySphereLightingRgb(
  r: number,
  g: number,
  b: number,
  nx: number,
  ny: number,
  strength: number,
  lightness: number,
  shininess: number,
): { r: number; g: number; b: number } {
  if (strength <= 0) return { r, g, b }

  const shade = computeSphereShadeFactor(nx, ny, lightness, shininess)

  const shadowDepth = (0.8 - lightness * 0.45) * strength
  const highlightBoost =
    (0.12 + lightness * 0.14 + shininess * 0.22) * strength

  const shadowAmt = (1 - shade) * shadowDepth
  let sr = r * (1 - shadowAmt)
  let sg = g * (1 - shadowAmt)
  let sb = b * (1 - shadowAmt)

  const hiAmt = shade * highlightBoost
  sr = sr + (255 - sr) * hiAmt
  sg = sg + (255 - sg) * hiAmt
  sb = sb + (255 - sb) * hiAmt

  // Subtle rim along the lit edge for depth
  const rim = clamp01((shade - 0.55) * 2.2) * shininess * 0.06 * strength
  sr = sr + (255 - sr) * rim
  sg = sg + (255 - sg) * rim
  sb = sb + (255 - sb) * rim

  return { r: sr, g: sg, b: sb }
}
