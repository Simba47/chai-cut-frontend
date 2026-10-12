/**
 * The frame on screen: its own time in the video (ms), each time a new frame is shown
 * (requestVideoFrameCallback's mediaTime). The playhead's time can fall anywhere inside a frame,
 * and the player's clock can be a little off the frame being drawn; a view change placed at a
 * camera cut, and the preview drawing that cut, both need the frame itself. Returns a stop function.
 */
export function trackPresentedFrame(video: HTMLVideoElement, onFrame: (mediaMs: number) => void): () => void {
  type Vfc = (cb: (now: number, meta: { mediaTime: number }) => void) => number
  const el = video as HTMLVideoElement & { requestVideoFrameCallback?: Vfc; cancelVideoFrameCallback?: (h: number) => void }
  if (typeof el.requestVideoFrameCallback !== 'function') return () => {}
  let handle = 0
  let stopped = false
  const cb = (_now: number, meta: { mediaTime: number }) => {
    if (stopped) return
    onFrame(meta.mediaTime * 1000)
    handle = el.requestVideoFrameCallback!(cb)
  }
  handle = el.requestVideoFrameCallback(cb)
  return () => { stopped = true; el.cancelVideoFrameCallback?.(handle) }
}
