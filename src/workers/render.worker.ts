import type { RenderPayload } from '../utils/renderCore'
import { renderPayloadPixels } from '../utils/renderCore'

export interface WorkerRenderRequest {
  type: 'render'
  id: number
  payload: RenderPayload
}

export interface WorkerRenderResponse {
  type: 'render'
  id: number
  width: number
  height: number
  buffer: ArrayBuffer
}

self.onmessage = (event: MessageEvent<WorkerRenderRequest>) => {
  const msg = event.data
  if (msg.type !== 'render') return

  const { id, payload } = msg
  const data = renderPayloadPixels(payload)

  const buffer = data.buffer as ArrayBuffer

  const response: WorkerRenderResponse = {
    type: 'render',
    id,
    width: payload.size,
    height: payload.size,
    buffer,
  }

  self.postMessage(response, { transfer: [buffer] })
}
