import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, chmodSync } from 'node:fs'

const LIMITAI_DIR = join(homedir(), '.limitai')
const DB_PATH = join(LIMITAI_DIR, 'limitai.db')

let _db: Database | null = null

export function getDb(): Database {
  if (_db) return _db
  
  // Ensure directory exists with 0700
  mkdirSync(LIMITAI_DIR, { recursive: true, mode: 0o700 })
  
  _db = new Database(DB_PATH)
  
  // Set permissions on DB file
  chmodSync(DB_PATH, 0o600)
  
  // Enable WAL mode and performance pragmas
  _db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    PRAGMA cache_size=-64000;
    PRAGMA temp_store=memory;
  `)
  
  // Create schema
  _db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      window_id TEXT,
      used_percent REAL,
      window_minutes INTEGER,
      resets_at TEXT,
      plan_type TEXT,
      source_confidence TEXT,
      raw_payload TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_account_time 
      ON snapshots(account_id, captured_at);
    
    CREATE INDEX IF NOT EXISTS idx_window_id
      ON snapshots(account_id, window_id);
  `)

  // Migration: add secondary window columns if missing
  const cols = _db.prepare(`PRAGMA table_info(snapshots)`).all() as { name: string }[]
  const colNames = new Set(cols.map(c => c.name))
  if (!colNames.has('secondary_used_percent')) {
    _db.exec(`ALTER TABLE snapshots ADD COLUMN secondary_used_percent REAL`)
  }
  if (!colNames.has('secondary_resets_at')) {
    _db.exec(`ALTER TABLE snapshots ADD COLUMN secondary_resets_at TEXT`)
  }

  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
