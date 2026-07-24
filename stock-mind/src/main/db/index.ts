import { join } from 'path'
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import initSqlJs, { Database, SqlJsStatic } from 'sql.js'

let db: Database
let SQL: SqlJsStatic
let dbPath: string

export async function initDatabase(): Promise<void> {
    const wasmPath = join(__dirname, '..', '..', 'resources', 'sql-wasm.wasm')
    SQL = await initSqlJs({ locateFile: () => wasmPath })

    dbPath = join(app.getPath('userData'), 'stockmind.db')

    if (existsSync(dbPath)) {
        const fileBuffer = readFileSync(dbPath)
        db = new SQL.Database(fileBuffer)
    } else {
        db = new SQL.Database()
    }

    createTables()
    persist()
    console.log(`Database initialized at ${dbPath}`)
}

function persist(): void {
    const data = db.export()
    writeFileSync(dbPath, Buffer.from(data))
}

type SqlParam = string | number | null | Uint8Array

function run(sql: string, params: SqlParam[] = []): void {
    db.run(sql, params)
    persist()
}

// 批量写入时避免每一次都 persist 到磁盘，交易结束再统一 flush
function runNoPersist(sql: string, params: SqlParam[] = []): void {
    db.run(sql, params)
}

export function flush(): void {
    persist()
}

function all<T>(sql: string, params: SqlParam[] = []): T[] {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const rows: T[] = []
    while (stmt.step()) {
        rows.push(stmt.getAsObject() as T)
    }
    stmt.free()
    return rows
}

function get<T>(sql: string, params: SqlParam[] = []): T | undefined {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const result = stmt.step() ? (stmt.getAsObject() as T) : undefined
    stmt.free()
    return result
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

    -- 会话元数据（UI 侧的会话列表）
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- UI 侧的消息展示表（与 checkpointer 是两条独立的持久化路径：
    -- checkpointer 存 Agent 状态用于续跑，这张表存展示用的用户可见消息）
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);

    -- LangGraph checkpoint 持久化（对应 MemorySaver.storage）
    CREATE TABLE IF NOT EXISTS chat_checkpoints (
      thread_id TEXT NOT NULL,
      checkpoint_ns TEXT NOT NULL DEFAULT '',
      checkpoint_id TEXT NOT NULL,
      parent_id TEXT,
      checkpoint BLOB NOT NULL,
      metadata BLOB NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
    );

    -- LangGraph 中间写入持久化（对应 MemorySaver.writes）
    CREATE TABLE IF NOT EXISTS chat_writes (
      thread_id TEXT NOT NULL,
      checkpoint_ns TEXT NOT NULL DEFAULT '',
      checkpoint_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      channel TEXT NOT NULL,
      value BLOB NOT NULL,
      PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_checkpoints_thread ON chat_checkpoints(thread_id, checkpoint_ns, checkpoint_id);
    CREATE INDEX IF NOT EXISTS idx_chat_writes_thread ON chat_writes(thread_id, checkpoint_ns, checkpoint_id);
  `)
}

// Holdings CRUD
export function getAllHoldings() {
    return all('SELECT * FROM holdings ORDER BY created_at DESC')
}

export function addHolding(code: string, name: string, costPrice: number, quantity: number) {
    run('INSERT INTO holdings (code, name, cost_price, quantity) VALUES (?, ?, ?, ?)', [
        code,
        name,
        costPrice,
        quantity,
    ])
}

export function updateHolding(id: number, costPrice: number, quantity: number) {
    run(
        "UPDATE holdings SET cost_price = ?, quantity = ?, updated_at = datetime('now') WHERE id = ?",
        [costPrice, quantity, id]
    )
}

export function deleteHolding(id: number) {
    run('DELETE FROM holdings WHERE id = ?', [id])
}

// Watchlist CRUD
export function getAllWatchlist() {
    return all('SELECT * FROM watchlist ORDER BY created_at DESC')
}

export function addToWatchlist(code: string, name: string, note?: string) {
    run('INSERT OR IGNORE INTO watchlist (code, name, note) VALUES (?, ?, ?)', [
        code,
        name,
        note ?? '',
    ])
}

export function removeFromWatchlist(id: number) {
    run('DELETE FROM watchlist WHERE id = ?', [id])
}

// Settings
export function getSetting(key: string): string | null {
    const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
    return row?.value ?? null
}

export function setSetting(key: string, value: string) {
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
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
    const row = get<{
        capital: number | null
        risk_level: string
        preferred_types: string
        avoid_types: string
        preferred_sectors: string
        notes: string
        updated_at: string
    }>(
        'SELECT capital, risk_level, preferred_types, avoid_types, preferred_sectors, notes, updated_at FROM investor_profile WHERE id = 1'
    )

    if (row) return mapInvestorProfile(row)

    run(
        `INSERT INTO investor_profile (id, capital, risk_level, preferred_types, avoid_types, preferred_sectors, notes)
    VALUES (1, 7000, '平衡', '宽基ETF、主板蓝筹', 'ST、北交所、高位追涨', '', '新手账户，优先控制仓位和回撤。')`
    )
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

    run(
        `UPDATE investor_profile
    SET capital = ?, risk_level = ?, preferred_types = ?, avoid_types = ?, preferred_sectors = ?, notes = ?, updated_at = datetime('now')
    WHERE id = 1`,
        [
            next.capital,
            next.riskLevel,
            next.preferredTypes,
            next.avoidTypes,
            next.preferredSectors,
            next.notes,
        ]
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
    run('INSERT INTO ai_analyses (code, model, prompt, result) VALUES (?, ?, ?, ?)', [
        code,
        model,
        prompt,
        result,
    ])
}

export function getAnalysesForStock(code: string) {
    return all('SELECT * FROM ai_analyses WHERE code = ? ORDER BY created_at DESC LIMIT 10', [code])
}

// ─── Chat sessions（UI 侧的会话列表） ─────────────────────────────────────────
export interface ChatSessionRow {
    id: string
    title: string
    created_at: string
    updated_at: string
}

export function listChatSessions(): ChatSessionRow[] {
    return all<ChatSessionRow>(
        'SELECT id, title, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC'
    )
}

export function createChatSession(id: string, title: string): ChatSessionRow {
    run('INSERT INTO chat_sessions (id, title) VALUES (?, ?)', [id, title])
    return get<ChatSessionRow>(
        'SELECT id, title, created_at, updated_at FROM chat_sessions WHERE id = ?',
        [id]
    )!
}

export function renameChatSession(id: string, title: string): void {
    run(
        "UPDATE chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?",
        [title, id]
    )
}

export function touchChatSession(id: string): void {
    run("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?", [id])
}

export function deleteChatSession(id: string): void {
    // 事务性删掉四张表里的所有相关记录，最后统一 flush
    runNoPersist('DELETE FROM chat_sessions WHERE id = ?', [id])
    runNoPersist('DELETE FROM chat_messages WHERE session_id = ?', [id])
    runNoPersist('DELETE FROM chat_checkpoints WHERE thread_id = ?', [id])
    runNoPersist('DELETE FROM chat_writes WHERE thread_id = ?', [id])
    flush()
}

// ─── Chat messages（UI 展示用） ───────────────────────────────────────────────
export interface ChatMessageRow {
    id: number
    session_id: string
    role: string
    content: string
    tool_calls: string | null
    created_at: string
}

export function listChatMessages(sessionId: string): ChatMessageRow[] {
    return all<ChatMessageRow>(
        'SELECT id, session_id, role, content, tool_calls, created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC',
        [sessionId]
    )
}

export function appendChatMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    toolCalls?: unknown
): void {
    run(
        'INSERT INTO chat_messages (session_id, role, content, tool_calls) VALUES (?, ?, ?, ?)',
        [sessionId, role, content, toolCalls ? JSON.stringify(toolCalls) : null]
    )
}

// ─── Chat checkpoints（LangGraph checkpointer 底层存储） ──────────────────────
export interface CheckpointRow {
    thread_id: string
    checkpoint_ns: string
    checkpoint_id: string
    parent_id: string | null
    checkpoint: Uint8Array
    metadata: Uint8Array
}

export interface WriteRow {
    thread_id: string
    checkpoint_ns: string
    checkpoint_id: string
    task_id: string
    idx: number
    channel: string
    value: Uint8Array
}

export function loadAllCheckpoints(): CheckpointRow[] {
    return all<CheckpointRow>(
        'SELECT thread_id, checkpoint_ns, checkpoint_id, parent_id, checkpoint, metadata FROM chat_checkpoints ORDER BY thread_id, checkpoint_ns, checkpoint_id'
    )
}

export function loadAllWrites(): WriteRow[] {
    return all<WriteRow>(
        'SELECT thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value FROM chat_writes'
    )
}

export function upsertCheckpoint(row: CheckpointRow): void {
    run(
        `INSERT OR REPLACE INTO chat_checkpoints
        (thread_id, checkpoint_ns, checkpoint_id, parent_id, checkpoint, metadata)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
            row.thread_id,
            row.checkpoint_ns,
            row.checkpoint_id,
            row.parent_id,
            row.checkpoint,
            row.metadata,
        ]
    )
}

export function upsertWrite(row: WriteRow): void {
    run(
        `INSERT OR REPLACE INTO chat_writes
        (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            row.thread_id,
            row.checkpoint_ns,
            row.checkpoint_id,
            row.task_id,
            row.idx,
            row.channel,
            row.value,
        ]
    )
}

export function clearThreadState(threadId: string): void {
    runNoPersist('DELETE FROM chat_checkpoints WHERE thread_id = ?', [threadId])
    runNoPersist('DELETE FROM chat_writes WHERE thread_id = ?', [threadId])
    flush()
}
