import { getDb } from './db.ts'
import type { NormalizedSnapshot } from '../providers/types.ts'

export function insertSnapshot(snapshot: NormalizedSnapshot): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO snapshots (account_id, captured_at, provider, window_id, used_percent, window_minutes, resets_at, secondary_used_percent, secondary_resets_at, plan_type, source_confidence, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    snapshot.accountId,
    snapshot.capturedAt,
    snapshot.provider,
    snapshot.windowId,
    snapshot.usedPercent,
    snapshot.windowMinutes,
    snapshot.resetsAt,
    snapshot.secondaryUsedPercent,
    snapshot.secondaryResetsAt,
    snapshot.planType,
    snapshot.sourceConfidence,
    JSON.stringify(snapshot.rawPayload),
  )
}

export function getLatestSnapshots(accountId: string, limit: number = 10): NormalizedSnapshot[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT * FROM snapshots 
    WHERE account_id = ?
    ORDER BY captured_at DESC
    LIMIT ?
  `).all(accountId, limit) as Record<string, unknown>[]
  
  return rows.map(mapRowToSnapshot)
}

export function getSnapshotsByDateRange(
  accountId: string,
  startDate: string,
  endDate: string,
): NormalizedSnapshot[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT * FROM snapshots
    WHERE account_id = ? AND captured_at >= ? AND captured_at < ?
    ORDER BY captured_at ASC
  `).all(accountId, startDate, endDate) as Record<string, unknown>[]
  
  return rows.map(mapRowToSnapshot)
}

export function getWindowPeaks(
  accountId: string,
  startDate: string,
  endDate: string,
): NormalizedSnapshot[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT s.* FROM snapshots s
    INNER JOIN (
      SELECT window_id, MAX(captured_at) as max_time
      FROM snapshots
      WHERE account_id = ? AND captured_at >= ? AND captured_at < ? AND window_id IS NOT NULL
      GROUP BY window_id
    ) latest ON s.window_id = latest.window_id AND s.captured_at = latest.max_time
    WHERE s.account_id = ?
    ORDER BY s.captured_at ASC
  `).all(accountId, startDate, endDate, accountId) as Record<string, unknown>[]
  
  return rows.map(mapRowToSnapshot)
}

export function getAllAccounts(): { accountId: string; provider: string; planType: string | null; lastSeen: string }[] {
  const db = getDb()
  return db.prepare(`
    SELECT account_id as accountId, provider, plan_type as planType, MAX(captured_at) as lastSeen
    FROM snapshots
    GROUP BY account_id
    ORDER BY lastSeen DESC
  `).all() as { accountId: string; provider: string; planType: string | null; lastSeen: string }[]
}

export function purgeOldSnapshots(daysToKeep: number = 30): number {
  const db = getDb()
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString()
  const result = db.prepare(`DELETE FROM snapshots WHERE captured_at < ?`).run(cutoff)
  return result.changes
}

function mapRowToSnapshot(row: Record<string, unknown>): NormalizedSnapshot {
  return {
    accountId: row.account_id as string,
    capturedAt: row.captured_at as string,
    provider: row.provider as 'codex' | 'claude' | 'gemini',
    windowId: (row.window_id as string) ?? '',
    usedPercent: row.used_percent as number | null,
    windowMinutes: row.window_minutes as number | null,
    resetsAt: row.resets_at as string | null,
    secondaryUsedPercent: row.secondary_used_percent as number | null,
    secondaryResetsAt: row.secondary_resets_at as string | null,
    planType: row.plan_type as string | null,
    sourceConfidence: (row.source_confidence as 'direct' | 'estimated' | 'unknown') ?? 'unknown',
    rawPayload: row.raw_payload ? JSON.parse(row.raw_payload as string) : null,
  }
}
