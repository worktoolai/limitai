const MIN_INTERVAL = 60_000
const NEAR_RESET_INTERVAL = 60_000
const MID_INTERVAL = 180_000
const DEFAULT_INTERVAL = 300_000
const MAX_BACKOFF = 1_800_000

export function calculatePollInterval(
  resetsAt: string | null,
  consecutiveFailures: number = 0,
): number {
  if (consecutiveFailures > 0) {
    const backoff = Math.min(
      MIN_INTERVAL * Math.pow(2, consecutiveFailures),
      MAX_BACKOFF,
    )
    const jitter = backoff * 0.1 * (Math.random() * 2 - 1)
    return Math.round(backoff + jitter)
  }
  
  if (!resetsAt) return DEFAULT_INTERVAL
  
  const now = Date.now()
  const resetTime = new Date(resetsAt).getTime()
  const timeToReset = resetTime - now
  
  if (timeToReset <= 0) return MIN_INTERVAL
  if (timeToReset <= 5 * 60_000) return NEAR_RESET_INTERVAL
  if (timeToReset <= 30 * 60_000) return MID_INTERVAL
  
  return DEFAULT_INTERVAL
}
