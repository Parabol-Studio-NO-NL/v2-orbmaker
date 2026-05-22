import { createNoise2D } from 'simplex-noise'
import type { NoiseFunction2D } from 'simplex-noise'

/**
 * A seeded pseudo-random number generator (mulberry32) used to deterministically
 * seed the simplex noise so results are reproducible given the same seed value.
 */
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Cache noise functions keyed by seed so we don't recreate them every frame */
const noiseCache = new Map<number, NoiseFunction2D>()

function getNoise(seed: number): NoiseFunction2D {
  if (!noiseCache.has(seed)) {
    noiseCache.set(seed, createNoise2D(mulberry32(seed)))
  }
  return noiseCache.get(seed)!
}

/**
 * Sample fractal Brownian Motion (fBm) noise at (x, y).
 * Returns a value in [0, 1].
 *
 * @param x        World-space X
 * @param y        World-space Y
 * @param seed     Integer seed — different seeds produce completely different patterns
 * @param scale    Frequency of the base octave
 * @param octaves  Number of fBm layers (1–6)
 * @param lacunarity  Frequency multiplier per octave (default 2.0)
 * @param gain        Amplitude multiplier per octave (default 0.5)
 */
export function sampleNoise(
  x: number,
  y: number,
  seed: number,
  scale: number,
  octaves: number = 3,
  lacunarity: number = 2.0,
  gain: number = 0.5,
): number {
  const noise = getNoise(seed)

  let value = 0
  let amplitude = 1
  let frequency = scale
  let maxValue = 0

  for (let i = 0; i < octaves; i++) {
    value += noise(x * frequency, y * frequency) * amplitude
    maxValue += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }

  // Normalise from [-maxValue, maxValue] → [0, 1]
  return (value / maxValue) * 0.5 + 0.5
}

/**
 * Returns a domain-warped noise value that produces more organic, swirling shapes.
 * The position itself is offset by two additional noise samples before the final lookup.
 */
export function sampleWarpedNoise(
  x: number,
  y: number,
  seed: number,
  scale: number,
  octaves: number = 3,
  warpStrength: number = 0.4,
): number {
  const noise = getNoise(seed)

  // Two domain offsets for warp (use different seeds via offset)
  const noise2 = getNoise(seed + 1)

  const wx = noise(x * scale * 0.7, y * scale * 0.7) * warpStrength
  const wy = noise2(x * scale * 0.7 + 5.2, y * scale * 0.7 + 1.3) * warpStrength

  return sampleNoise(x + wx, y + wy, seed + 2, scale, octaves)
}

/** Clear the noise cache (call when memory is a concern or seed pool grows large) */
export function clearNoiseCache(): void {
  noiseCache.clear()
}
