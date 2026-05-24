import type { MeshConfig, MeshGrid } from '../types'
import type { WorkerRenderRequest, WorkerRenderResponse } from '../workers/render.worker'
import { finishImageData } from './render'
import { buildRenderPayload } from './renderCore'

let worker: Worker | null = null
let requestId = 0

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/render.worker.ts', import.meta.url), {
      type: 'module',
    })
  }
  return worker
}

const WORKER_THRESHOLD = 1200

/** Use worker for large exports to keep the UI responsive. */
export function shouldUseRenderWorker(size: number): boolean {
  return size >= WORKER_THRESHOLD && typeof Worker !== 'undefined'
}

export function renderInWorker(
  grid: MeshGrid,
  config: MeshConfig,
  size: number,
  shape?: import('./shapeDomain').ShapeDefinition | null,
  shapeUrl?: string,
): Promise<ImageData> {
  const w = getWorker()
  const id = ++requestId
  const payload = buildRenderPayload(grid, config, size, shape, shapeUrl)
  const maskForBlur = payload.mask ? new Uint8Array(payload.mask) : undefined
  const payloadForBlur = maskForBlur
    ? { ...payload, mask: maskForBlur }
    : payload

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<WorkerRenderResponse>) => {
      const msg = event.data
      if (msg.type !== 'render' || msg.id !== id) return
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)

      const data = new Uint8ClampedArray(msg.buffer)
      finishImageData(data, msg.width, config, payloadForBlur)
      resolve(new ImageData(data, msg.width, msg.height))
    }

    const onError = (err: ErrorEvent) => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      reject(err.error ?? new Error('Render worker failed'))
    }

    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)

    const request: WorkerRenderRequest = {
      type: 'render',
      id,
      payload,
    }

    const transfer: Transferable[] = [payload.colors.buffer]
    if (payload.gradientLut) transfer.push(payload.gradientLut.buffer)
    if (payload.mask) transfer.push(payload.mask.buffer)

    w.postMessage(request, transfer)
  })
}

export function terminateRenderWorker(): void {
  worker?.terminate()
  worker = null
}
