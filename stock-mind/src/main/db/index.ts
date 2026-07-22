import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'

let db: Database.Database

export function getDb(): Database.Database {
    return db
}

export function initDatabase(): void {
    const dbPath = join(app.getPath('userData'), 'stockmind.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    createTables()
    console.log(`Database initialized at ${dbPath}`)
}

function createTables(): void {
    db.exec(`
    CREATE TABLE IF NOT EXISTS holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      cost_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS investor_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      capital REAL,
      risk_level TEXT NOT NULL DEFAULT '平衡',
      preferred_types TEXT NOT NULL DEFAULT '',
      avoid_types TEXT NOT NULL DEFAULT '',
      preferred_sectors TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO investor_profile (id, capital, risk_level, preferred_types, avoid_types, preferred_sectors, notes)
    VALUES (1, 7000, '平衡', '宽基ETF、主板蓝筹', 'ST、北交所、高位追涨', '', '新手账户，优先控制仓位和回撤。');

    CREATE INDEX IF NOT EXISTS idx_holdings_code ON holdings(code);
    CREATE INDEX IF NOT EXISTS idx_ai_analyses_code ON ai_analyses(code);
  `)
}

// Holdings CRUD
export function getAllHoldings() {
    return db.prepare('SELECT * FROM holdings ORDER BY created_at DESC').all()
}

export function addHolding(code: string, name: string, costPrice: number, quantity: number) {
    return db
        .prepare('INSERT INTO holdings (code, name, cost_price, quantity) VALUES (?, ?, ?, ?)')
        .run(code, name, costPrice, quantity)
}

export function updateHolding(id: number, costPrice: number, quantity: number) {
    return db
        .prepare(
            "UPDATE holdings SET cost_price = ?, quantity = ?, updated_at = datetime('now') WHERE id = ?"
        )
        .run(costPrice, quantity, id)
}

export function deleteHolding(id: number) {
    return db.prepare('DELETE FROM holdings WHERE id = ?').run(id)
}

// Watchlist CRUD
export function getAllWatchlist() {
    return db.prepare('SELECT * FROM watchlist ORDER BY created_at DESC').all()
}

export function addToWatchlist(code: string, name: string, note?: string) {
    return db
        .prepare('INSERT OR IGNORE INTO watchlist (code, name, note) VALUES (?, ?, ?)')
        .run(code, name, note ?? '')
}

export function removeFromWatchlist(id: number) {
    return db.prepare('DELETE FROM watchlist WHERE id = ?').run(id)
}

// Settings
export function getSetting(key: string): string | null {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        | { value: string }
        | undefined
    return row?.value ?? null
}

export function setSetting(key: string, value: string) {
    return db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

export interface InvestorProfile {
    capital: number | null
    riskLevel: string
    preferredTypes: string
    avoidTypes: string
    preferredSectors: string
    notes: string
    updatedAt: string
}

export interface InvestorProfileInput {
    capital?: number | null
    riskLevel?: string
    preferredTypes?: string
    avoidTypes?: string
    preferredSectors?: string
    notes?: string
}

function mapInvestorProfile(row: {
    capital: number | null
    risk_level: string
    preferred_types: string
    avoid_types: string
    preferred_sectors: string
    notes: string
    updated_at: string
}): InvestorProfile {
    return {
        capital: row.capital,
        riskLevel: row.risk_level,
        preferredTypes: row.preferred_types,
        avoidTypes: row.avoid_types,
        preferredSectors: row.preferred_sectors,
        notes: row.notes,
        updatedAt: row.updated_at,
    }
}

export function getInvestorProfile(): InvestorProfile {
    const row = db
        .prepare(
            'SELECT capital, risk_level, preferred_types, avoid_types, preferred_sectors, notes, updated_at FROM investor_profile WHERE id = 1'
        )
        .get() as
        | {
              capital: number | null
              risk_level: string
              preferred_types: string
              avoid_types: string
              preferred_sectors: string
              notes: string
              updated_at: string
          }
        | undefined

    if (row) return mapInvestorProfile(row)

    db.prepare(
        `INSERT INTO investor_profile (id, capital, risk_level, preferred_types, avoid_types, preferred_sectors, notes)
    VALUES (1, 7000, '平衡', '宽基ETF、主板蓝筹', 'ST、北交所、高位追涨', '', '新手账户，优先控制仓位和回撤。')`
    ).run()
    return getInvestorProfile()
}

export function updateInvestorProfile(input: InvestorProfileInput): InvestorProfile {
    const current = getInvestorProfile()
    const next = {
        capital: input.capital === undefined ? current.capital : input.capital,
        riskLevel: input.riskLevel ?? current.riskLevel,
        preferredTypes: input.preferredTypes ?? current.preferredTypes,
        avoidTypes: input.avoidTypes ?? current.avoidTypes,
        preferredSectors: input.preferredSectors ?? current.preferredSectors,
        notes: input.notes ?? current.notes,
    }

    db.prepare(
        `UPDATE investor_profile
    SET capital = ?, risk_level = ?, preferred_types = ?, avoid_types = ?, preferred_sectors = ?, notes = ?, updated_at = datetime('now')
    WHERE id = 1`
    ).run(
        next.capital,
        next.riskLevel,
        next.preferredTypes,
        next.avoidTypes,
        next.preferredSectors,
        next.notes
    )

    return getInvestorProfile()
}

export function formatInvestorProfile(profile: InvestorProfile): string {
    return [
        `风险偏好：${profile.riskLevel || '平衡'}`,
        `偏好品种：${profile.preferredTypes || '未设置'}`,
        `回避品种：${profile.avoidTypes || '未设置'}`,
        `偏好板块：${profile.preferredSectors || '未设置'}`,
        `补充备注：${profile.notes || '无'}`,
    ].join('\n')
}

export function formatInvestorProfileFull(profile: InvestorProfile): string {
    return [
        `可用资金：${profile.capital && profile.capital > 0 ? `${profile.capital} 元` : '未设置'}`,
        `风险偏好：${profile.riskLevel || '平衡'}`,
        `偏好品种：${profile.preferredTypes || '未设置'}`,
        `回避品种：${profile.avoidTypes || '未设置'}`,
        `偏好板块：${profile.preferredSectors || '未设置'}`,
        `补充备注：${profile.notes || '无'}`,
    ].join('\n')
}

// AI analyses
export function saveAnalysis(code: string, model: string, prompt: string, result: string) {
    return db
        .prepare('INSERT INTO ai_analyses (code, model, prompt, result) VALUES (?, ?, ?, ?)')
        .run(code, model, prompt, result)
}

export function getAnalysesForStock(code: string) {
    return db
        .prepare('SELECT * FROM ai_analyses WHERE code = ? ORDER BY created_at DESC LIMIT 10')
        .all(code)
}
