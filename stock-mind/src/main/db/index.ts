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

    // 统一使用固定的 appId 路径，确保开发模式和生产模式使用同一个数据库文件
    const appId = 'com.stockmind.app'
    const appDataPath = app.getPath('appData')
    dbPath = join(appDataPath, appId, 'stockmind.db')

    // 确保数据库目录存在
    const dbDir = join(dbPath, '..')
    if (!existsSync(dbDir)) {
        require('fs').mkdirSync(dbDir, { recursive: true })
    }

    // 迁移逻辑：检查旧路径是否有数据需要迁移
    // 旧路径1：app.getPath('userData') 默认路径（开发模式下可能是 stock-mind）
    const oldDevPath = join(app.getPath('userData'), 'stockmind.db')
    // 旧路径2：com.stockmind.app 之前可能存储在 stock-mind 目录下
    const oldAppDataPath = join(appDataPath, 'stock-mind', 'stockmind.db')
    
    if (!existsSync(dbPath)) {
        // 优先检查旧的 userData 路径
        if (existsSync(oldDevPath)) {
            console.log(`Migrating database from ${oldDevPath} to ${dbPath}`)
            require('fs').copyFileSync(oldDevPath, dbPath)
        }
        // 然后检查旧的 appData/stock-mind 路径
        else if (existsSync(oldAppDataPath)) {
            console.log(`Migrating database from ${oldAppDataPath} to ${dbPath}`)
            require('fs').copyFileSync(oldAppDataPath, dbPath)
        }
    }

    if (existsSync(dbPath)) {
        console.log(`Loading existing database from ${dbPath}`)
        const fileBuffer = readFileSync(dbPath)
        db = new SQL.Database(fileBuffer)
    } else {
        console.log(`Creating new database at ${dbPath}`)
        db = new SQL.Database()
    }

    createTables()
    migrateTables()
    persist()
    console.log(`Database initialized at ${dbPath}`)
}

function persist(): void {
    const data = db.export()
    const dbDir = join(dbPath, '..')
    if (!existsSync(dbDir)) {
        require('fs').mkdirSync(dbDir, { recursive: true })
    }
    writeFileSync(dbPath, Buffer.from(data))
}

type SqlParam = string | number | null | Uint8Array

function run(sql: string, params: SqlParam[] = []): void {
    db.run(sql, params)
    persist()
}

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
      avg_cost_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS holding_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      holding_id INTEGER NOT NULL,
      trade_type TEXT NOT NULL CHECK(trade_type IN ('buy', 'sell')),
      cost_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      trade_date TEXT DEFAULT (datetime('now')),
      note TEXT,
      FOREIGN KEY (holding_id) REFERENCES holdings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_holding_trades_holding_id ON holding_trades(holding_id);

    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS watchlist_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS watchlist_item_groups (
      item_id INTEGER NOT NULL,
      group_name TEXT NOT NULL,
      PRIMARY KEY (item_id, group_name),
      FOREIGN KEY (item_id) REFERENCES watchlist(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_watchlist_item_groups_item ON watchlist_item_groups(item_id);
    CREATE INDEX IF NOT EXISTS idx_watchlist_item_groups_group ON watchlist_item_groups(group_name);

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

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);

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

// 数据库迁移：添加缺失的列
function migrateTables(): void {
    try {
        // 检查 holdings 表是否有 avg_cost_price 列
        const columns = all<{ name: string }>(
            "PRAGMA table_info(holdings)"
        )
        const hasAvgCostPrice = columns.some(c => c.name === 'avg_cost_price')
        
        if (!hasAvgCostPrice) {
            console.log('Migrating holdings table: adding avg_cost_price column')
            run('ALTER TABLE holdings ADD COLUMN avg_cost_price REAL')
            // 如果有 cost_price 列，复制值过去
            const hasCostPrice = columns.some(c => c.name === 'cost_price')
            if (hasCostPrice) {
                run('UPDATE holdings SET avg_cost_price = cost_price WHERE avg_cost_price IS NULL')
            }
        }

        // 检查 holdings 表是否有 updated_at 列
        const hasUpdatedAt = columns.some(c => c.name === 'updated_at')
        if (!hasUpdatedAt) {
            console.log('Migrating holdings table: adding updated_at column')
            run("ALTER TABLE holdings ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))")
        }

        // 检查 watchlist_groups 表是否存在
        const watchlistGroupsExists = all<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='watchlist_groups'"
        )
        if (watchlistGroupsExists.length === 0) {
            console.log('Migrating: creating watchlist_groups table')
            run(`
                CREATE TABLE watchlist_groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            `)
        }

        // 检查 watchlist_item_groups 表是否存在
        const watchlistItemGroupsExists = all<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='watchlist_item_groups'"
        )
        if (watchlistItemGroupsExists.length === 0) {
            console.log('Migrating: creating watchlist_item_groups table')
            run(`
                CREATE TABLE watchlist_item_groups (
                    item_id INTEGER NOT NULL,
                    group_name TEXT NOT NULL,
                    PRIMARY KEY (item_id, group_name),
                    FOREIGN KEY (item_id) REFERENCES watchlist(id) ON DELETE CASCADE
                )
            `)
        }

        console.log('Database migration completed')
    } catch (e) {
        console.error('Database migration error:', e)
    }
}

// Holdings CRUD
export interface HoldingTrade {
    id: number
    holding_id: number
    trade_type: 'buy' | 'sell'
    cost_price: number
    quantity: number
    trade_date: string
    note: string
}

export function getAllHoldings() {
    const holdings = all('SELECT * FROM holdings ORDER BY created_at DESC') as Array<{
        id: number
        code: string
        name: string
        avg_cost_price: number
        quantity: number
        created_at: string
        updated_at: string
    }>
    return holdings.map((h) => ({
        ...h,
        trades: all('SELECT * FROM holding_trades WHERE holding_id = ? ORDER BY trade_date DESC', [h.id]) as HoldingTrade[],
    }))
}

export function addHolding(code: string, name: string, costPrice: number, quantity: number) {
    // 兼容新旧表结构：同时插入 cost_price 和 avg_cost_price
    run('INSERT INTO holdings (code, name, cost_price, avg_cost_price, quantity) VALUES (?, ?, ?, ?, ?)', [
        code,
        name,
        costPrice,
        costPrice,
        quantity,
    ])
    const holding = get<{ id: number }>('SELECT last_insert_rowid() as id FROM holdings')
    if (holding) {
        run('INSERT INTO holding_trades (holding_id, trade_type, cost_price, quantity) VALUES (?, ?, ?, ?)', [
            holding.id,
            'buy',
            costPrice,
            quantity,
        ])
    }
}

export function updateHolding(id: number, costPrice: number, quantity: number) {
    // 兼容新旧表结构：同时更新 cost_price 和 avg_cost_price
    run(
        "UPDATE holdings SET cost_price = ?, avg_cost_price = ?, quantity = ?, updated_at = datetime('now') WHERE id = ?",
        [costPrice, costPrice, quantity, id]
    )
}

export function deleteHolding(id: number) {
    run('DELETE FROM holdings WHERE id = ?', [id])
}

export function addTrade(holdingId: number, tradeType: 'buy' | 'sell', costPrice: number, quantity: number, note?: string) {
    const holding = get<{
        id: number
        avg_cost_price: number
        quantity: number
    }>('SELECT id, avg_cost_price, quantity FROM holdings WHERE id = ?', [holdingId])
    
    if (!holding) throw new Error('持仓不存在')
    
    let newQuantity: number
    let newAvgCost: number
    
    if (tradeType === 'buy') {
        newQuantity = holding.quantity + quantity
        newAvgCost = ((holding.avg_cost_price * holding.quantity) + (costPrice * quantity)) / newQuantity
    } else {
        if (holding.quantity < quantity) throw new Error('持仓数量不足')
        newQuantity = holding.quantity - quantity
        newAvgCost = holding.avg_cost_price
    }
    
    run('INSERT INTO holding_trades (holding_id, trade_type, cost_price, quantity, note) VALUES (?, ?, ?, ?, ?)', [
        holdingId,
        tradeType,
        costPrice,
        quantity,
        note ?? '',
    ])
    
    // 兼容新旧表结构：同时更新 cost_price 和 avg_cost_price
    run(
        "UPDATE holdings SET cost_price = ?, avg_cost_price = ?, quantity = ?, updated_at = datetime('now') WHERE id = ?",
        [newAvgCost, newAvgCost, newQuantity, holdingId]
    )
    
    return { newQuantity, newAvgCost }
}

export function getHoldingTrades(holdingId: number): HoldingTrade[] {
    return all('SELECT * FROM holding_trades WHERE holding_id = ? ORDER BY trade_date DESC', [holdingId]) as HoldingTrade[]
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

// Watchlist Groups CRUD
export function getAllWatchlistGroups(): string[] {
    const rows = all<{ name: string }>('SELECT name FROM watchlist_groups ORDER BY created_at ASC')
    return rows.map((r) => r.name)
}

export function addWatchlistGroup(name: string): void {
    run('INSERT OR IGNORE INTO watchlist_groups (name) VALUES (?)', [name])
}

export function removeWatchlistGroup(name: string): void {
    runNoPersist('DELETE FROM watchlist_groups WHERE name = ?', [name])
    runNoPersist('DELETE FROM watchlist_item_groups WHERE group_name = ?', [name])
    flush()
}

export function setWatchlistItemGroup(itemId: number, groupName: string): void {
    if (groupName === '') {
        run('DELETE FROM watchlist_item_groups WHERE item_id = ?', [itemId])
    } else {
        run('INSERT OR REPLACE INTO watchlist_item_groups (item_id, group_name) VALUES (?, ?)', [
            itemId,
            groupName,
        ])
    }
}

export function getAllWatchlistItemGroups(): Map<number, string> {
    const rows = all<{ item_id: number; group_name: string }>(
        'SELECT item_id, group_name FROM watchlist_item_groups'
    )
    const map = new Map<number, string>()
    for (const row of rows) {
        map.set(row.item_id, row.group_name)
    }
    return map
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

// Chat sessions
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
    runNoPersist('DELETE FROM chat_sessions WHERE id = ?', [id])
    runNoPersist('DELETE FROM chat_messages WHERE session_id = ?', [id])
    runNoPersist('DELETE FROM chat_checkpoints WHERE thread_id = ?', [id])
    runNoPersist('DELETE FROM chat_writes WHERE thread_id = ?', [id])
    flush()
}

// Chat messages
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

// Chat checkpoints
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
