'use client'

import { useEffect, useRef } from 'react'

/**
 * The progress checks' shared rhythm: runs `check` every FAST_MS for the first minute (short jobs
 * feel as quick as before), then every SLOW_MS (long ones: exports, readings, editing copies). Not
 * while the tab is hidden: the moment it is shown again it checks at once. A check that is still
 * running is never started twice; one that fails just waits for the next.
 *
 * At thousands of people, many leave a tab open on a job that takes minutes: checking those every
 * 3 s was about half of the website's requests (2026-10-26 scaling plan, step 1.2).
 */
export const POLL_FAST_MS = 3000
export const POLL_SLOW_MS = 8000
export const POLL_FAST_FOR_MS = 60_000

/** The page as the rhythm sees it (the browser's document; a stand-in in tests) */
type Page = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>

/** Starts the rhythm; returns its stop */
export function startPolling(check: () => unknown, page: Page = document, now: () => number = Date.now): () => void {
  const started = now()
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let stopped = false

  const next = () => {
    if (stopped || page.hidden) return
    timer = setTimeout(run, now() - started < POLL_FAST_FOR_MS ? POLL_FAST_MS : POLL_SLOW_MS)
  }
  async function run() {
    timer = null
    if (running || stopped) return
    running = true
    try { await check() } catch { /* a failed check waits for the next one */ }
    running = false
    next()
  }
  const onVisibility = () => {
    if (page.hidden) {
      if (timer) clearTimeout(timer)
      timer = null
    } else if (!timer && !running) {
      run()
    }
  }

  page.addEventListener('visibilitychange', onVisibility)
  next()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    page.removeEventListener('visibilitychange', onVisibility)
  }
}

/** Runs `check` on the shared rhythm while `active` (it reads the latest state without restarting) */
export function usePolling(check: () => unknown, active: boolean) {
  const latest = useRef(check)
  latest.current = check
  useEffect(() => (active ? startPolling(() => latest.current()) : undefined), [active])
}
