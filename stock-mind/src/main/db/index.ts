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
    seedDefaultData()
    persist()
    console.log(`Database initialized at ${dbPath}`)
}

function seedDefaultData(): void {
    const defaultHoldings = [
        { code: '600519', name: '贵州茅台', cost: 1580, qty: 50, sector: '消费', subSector: '白酒' },
        { code: '002594', name: '比亚迪', cost: 235, qty: 100, sector: '新能源', subSector: '汽车整车' },
        { code: '600036', name: '招商银行', cost: 37, qty: 300, sector: '金融', subSector: '银行' },
        { code: '300750', name: '宁德时代', cost: 185, qty: 200, sector: '新能源', subSector: '电池' },
        { code: '601318', name: '中国平安', cost: 45, qty: 200, sector: '金融', subSector: '保险' },
        { code: '000858', name: '五粮液', cost: 138, qty: 100, sector: '消费', subSector: '白酒' },
        { code: '601012', name: '隆基绿能', cost: 22, qty: 500, sector: '新能源', subSector: '光伏' },
        { code: '002415', name: '海康威视', cost: 32, qty: 200, sector: '科技', subSector: '安防' },
        { code: '603259', name: '药明康德', cost: 82, qty: 100, sector: '医药', subSector: 'CXO' },
        { code: '300760', name: '迈瑞医疗', cost: 285, qty: 50, sector: '医药', subSector: '医疗器械' },
        { code: '601728', name: '中国电信', cost: 7.2, qty: 1000, sector: '通信', subSector: '电信运营' },
    ]
    const defaultWatchlist = [
        { code: '600519', name: '贵州茅台', note: '白酒龙头', sector: '消费', subSector: '白酒' },
        { code: '002594', name: '比亚迪', note: '新能源车', sector: '新能源', subSector: '汽车整车' },
        { code: '600036', name: '招商银行', note: '银行蓝筹', sector: '金融', subSector: '银行' },
        { code: '300750', name: '宁德时代', note: '电池龙头', sector: '新能源', subSector: '电池' },
        { code: '601318', name: '中国平安', note: '金融保险', sector: '金融', subSector: '保险' },
        { code: '000858', name: '五粮液', note: '白酒', sector: '消费', subSector: '白酒' },
        { code: '601012', name: '隆基绿能', note: '光伏', sector: '新能源', subSector: '光伏' },
        { code: '002415', name: '海康威视', note: '安防龙头', sector: '科技', subSector: '安防' },
        { code: '603259', name: '药明康德', note: '医药CXO', sector: '医药', subSector: 'CXO' },
        { code: '300760', name: '迈瑞医疗', note: '医疗器械', sector: '医药', subSector: '医疗器械' },
    ]

    // 持仓：使用 INSERT OR IGNORE 避免重复代码冲突
    let addedHoldings = 0
    for (const h of defaultHoldings) {
        const existing = get<{ id: number }>('SELECT id FROM holdings WHERE code = ?', [h.code])
        if (!existing) {
            runNoPersist(
                'INSERT INTO holdings (code, name, sector, sub_sector, cost_price, avg_cost_price, quantity) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [h.code, h.name, h.sector, h.subSector, h.cost, h.cost, h.qty]
            )
            const row = get<{ id: number }>('SELECT last_insert_rowid() as id')
            if (row) {
                runNoPersist(
                    'INSERT INTO holding_trades (holding_id, trade_type, cost_price, quantity) VALUES (?, ?, ?, ?)',
                    [row.id, 'buy', h.cost, h.qty]
                )
                addedHoldings++
            }
        }
    }
    if (addedHoldings > 0) {
        console.log(`Seeded ${addedHoldings} default holdings`)
    }

    // 观察列表
    let addedWatchlist = 0
    for (const w of defaultWatchlist) {
        const existing = get<{ id: number }>('SELECT id FROM watchlist WHERE code = ?', [w.code])
        if (!existing) {
            runNoPersist(
                'INSERT INTO watchlist (code, name, sector, sub_sector, note) VALUES (?, ?, ?, ?, ?)',
                [w.code, w.name, w.sector, w.subSector, w.note]
            )
            addedWatchlist++
        }
    }
    if (addedWatchlist > 0) {
        console.log(`Seeded ${addedWatchlist} default watchlist items`)
    }
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
      sector TEXT NOT NULL DEFAULT '',
      sub_sector TEXT NOT NULL DEFAULT '',
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
      sector TEXT NOT NULL DEFAULT '',
      sub_sector TEXT NOT NULL DEFAULT '',
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
      images TEXT,
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

    CREATE TABLE IF NOT EXISTS decision_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_date TEXT NOT NULL,
      market_context TEXT NOT NULL DEFAULT '',
      decision_text TEXT NOT NULL DEFAULT '',
      structured_decision TEXT,
      diagnostics TEXT,
      capital REAL,
      risk_level TEXT,
      review_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(decision_date)
    );

    CREATE INDEX IF NOT EXISTS idx_decision_history_date ON decision_history(decision_date DESC);
    CREATE INDEX IF NOT EXISTS idx_decision_history_status ON decision_history(review_status);

    CREATE TABLE IF NOT EXISTS decision_pick_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      priority INTEGER,
      action TEXT,
      aggressive_entry REAL,
      conservative_entry REAL,
      stop_loss REAL,
      take_profit REAL,
      position_amount REAL,
      status TEXT NOT NULL DEFAULT 'pending',
      review_date TEXT,
      entry_triggered INTEGER NOT NULL DEFAULT 0,
      entry_type TEXT,
      entry_price REAL,
      entry_date TEXT,
      exit_reason TEXT,
      exit_price REAL,
      exit_date TEXT,
      return_pct REAL,
      pnl_amount REAL,
      kline_snapshot TEXT,
      error_msg TEXT,
      reviewed_at TEXT,
      FOREIGN KEY (decision_id) REFERENCES decision_history(id) ON DELETE CASCADE,
      UNIQUE(decision_id, code)
    );

    CREATE INDEX IF NOT EXISTS idx_pick_reviews_decision ON decision_pick_reviews(decision_id);
    CREATE INDEX IF NOT EXISTS idx_pick_reviews_status ON decision_pick_reviews(status);
    CREATE INDEX IF NOT EXISTS idx_pick_reviews_code ON decision_pick_reviews(code);
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

        // 检查 holdings 表是否有 sector / sub_sector 列
        if (!columns.some(c => c.name === 'sector')) {
            console.log('Migrating holdings table: adding sector column')
            run("ALTER TABLE holdings ADD COLUMN sector TEXT NOT NULL DEFAULT ''")
        }
        if (!columns.some(c => c.name === 'sub_sector')) {
            console.log('Migrating holdings table: adding sub_sector column')
            run("ALTER TABLE holdings ADD COLUMN sub_sector TEXT NOT NULL DEFAULT ''")
        }

        // 检查 watchlist 表是否有 sector / sub_sector 列
        const watchlistCols = all<{ name: string }>("PRAGMA table_info(watchlist)")
        if (!watchlistCols.some(c => c.name === 'sector')) {
            console.log('Migrating watchlist table: adding sector column')
            run("ALTER TABLE watchlist ADD COLUMN sector TEXT NOT NULL DEFAULT ''")
        }
        if (!watchlistCols.some(c => c.name === 'sub_sector')) {
            console.log('Migrating watchlist table: adding sub_sector column')
            run("ALTER TABLE watchlist ADD COLUMN sub_sector TEXT NOT NULL DEFAULT ''")
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

        // 检查 chat_messages 表是否有 images 列
        const chatColumns = all<{ name: string }>(
            "PRAGMA table_info(chat_messages)"
        )
        const hasImagesColumn = chatColumns.some(c => c.name === 'images')
        if (!hasImagesColumn) {
            console.log('Migrating chat_messages table: adding images column')
            run("ALTER TABLE chat_messages ADD COLUMN images TEXT")
        }

        // 检查 decision_history 表是否有 market_regime 列（市场状态判断 #2）
        const decisionCols = all<{ name: string }>(
            "PRAGMA table_info(decision_history)"
        )
        if (decisionCols.length > 0 && !decisionCols.some(c => c.name === 'market_regime')) {
            console.log('Migrating decision_history table: adding market_regime column')
            run("ALTER TABLE decision_history ADD COLUMN market_regime TEXT")
        }

        // 合并旧库残留数据（每次启动都检查，避免数据库分裂导致数据丢失）
        mergeLegacyDatabases()

        console.log('Database migration completed')
    } catch (e) {
        console.error('Database migration error:', e)
    }
}

// 合并历史遗留的旧数据库：dev 模式 appId 未统一前，数据曾写入 stock-mind 目录的库。
// 每次启动都检查，发现旧库则按表 INSERT OR IGNORE 合并到当前库，合并后重命名旧库为 .merged.bak。
function mergeLegacyDatabases(): void {
    const appDataPath = app.getPath('appData')
    const legacyPaths = [
        // 旧路径1：setName 生效后等于 dbPath，会被 oldPath === dbPath 跳过
        join(app.getPath('userData'), 'stockmind.db'),
        // 旧路径2：dev 模式 appId 未统一时的库
        join(appDataPath, 'stock-mind', 'stockmind.db'),
    ]

    for (const oldPath of legacyPaths) {
        if (oldPath === dbPath) continue
        if (!existsSync(oldPath)) continue
        try {
            console.log(`[migration] Merging legacy database from ${oldPath}`)
            const oldDb = new SQL.Database(readFileSync(oldPath))
            mergeOldDbTables(oldDb)
            oldDb.close()
            const bakPath = oldPath + '.merged.bak'
            require('fs').renameSync(oldPath, bakPath)
            console.log(`[migration] Legacy db merged and renamed to ${bakPath}`)
        } catch (e) {
            console.error(`[migration] Failed to merge legacy db ${oldPath}:`, e)
        }
    }
}

function oldAll<T>(oldDb: Database, sql: string): T[] {
    const stmt = oldDb.prepare(sql)
    const rows: T[] = []
    while (stmt.step()) rows.push(stmt.getAsObject() as T)
    stmt.free()
    return rows
}

function mergeOldDbTables(oldDb: Database): void {
    const tables = new Set(
        oldAll<{ name: string }>(
            oldDb,
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).map((r) => r.name)
    )
    const oldCols = (table: string): string[] =>
        oldAll<{ name: string }>(oldDb, `PRAGMA table_info(${table})`).map((r) => r.name)

    // holdings：旧库可能只有 cost_price 而无 avg_cost_price
    if (tables.has('holdings')) {
        const cols = oldCols('holdings')
        const priceCol = cols.includes('avg_cost_price')
            ? 'avg_cost_price'
            : cols.includes('cost_price')
                ? 'cost_price'
                : null
        const selectSql = priceCol
            ? `SELECT code, name, ${priceCol} AS price, quantity, created_at, updated_at FROM holdings`
            : 'SELECT code, name, quantity, created_at FROM holdings'
        for (const r of oldAll<any>(oldDb, selectSql)) {
            runNoPersist(
                'INSERT OR IGNORE INTO holdings (code, name, avg_cost_price, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
                [r.code, r.name, r.price ?? 0, r.quantity, r.created_at, r.updated_at ?? r.created_at]
            )
        }
    }

    // holding_trades：旧库可能没有此表
    if (tables.has('holding_trades')) {
        for (const r of oldAll<any>(
            oldDb,
            'SELECT holding_id, trade_type, cost_price, quantity, trade_date, note FROM holding_trades'
        )) {
            runNoPersist(
                'INSERT INTO holding_trades (holding_id, trade_type, cost_price, quantity, trade_date, note) VALUES (?, ?, ?, ?, ?, ?)',
                [r.holding_id, r.trade_type, r.cost_price, r.quantity, r.trade_date, r.note ?? '']
            )
        }
    }

    // watchlist
    if (tables.has('watchlist')) {
        for (const r of oldAll<any>(oldDb, 'SELECT code, name, note, created_at FROM watchlist')) {
            runNoPersist(
                'INSERT OR IGNORE INTO watchlist (code, name, note, created_at) VALUES (?, ?, ?, ?)',
                [r.code, r.name, r.note ?? '', r.created_at]
            )
        }
    }

    // watchlist_groups
    if (tables.has('watchlist_groups')) {
        for (const r of oldAll<any>(oldDb, 'SELECT name, created_at FROM watchlist_groups')) {
            runNoPersist('INSERT OR IGNORE INTO watchlist_groups (name, created_at) VALUES (?, ?)', [
                r.name,
                r.created_at,
            ])
        }
    }

    // watchlist_item_groups
    if (tables.has('watchlist_item_groups')) {
        for (const r of oldAll<any>(
            oldDb,
            'SELECT item_id, group_name FROM watchlist_item_groups'
        )) {
            runNoPersist(
                'INSERT OR REPLACE INTO watchlist_item_groups (item_id, group_name) VALUES (?, ?)',
                [r.item_id, r.group_name]
            )
        }
    }

    // settings：INSERT OR IGNORE，保留新库已有值
    if (tables.has('settings')) {
        for (const r of oldAll<any>(oldDb, 'SELECT key, value FROM settings')) {
            runNoPersist('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [r.key, r.value])
        }
    }

    // ai_analyses
    if (tables.has('ai_analyses')) {
        for (const r of oldAll<any>(
            oldDb,
            'SELECT code, model, prompt, result, created_at FROM ai_analyses'
        )) {
            runNoPersist(
                'INSERT INTO ai_analyses (code, model, prompt, result, created_at) VALUES (?, ?, ?, ?, ?)',
                [r.code, r.model, r.prompt, r.result, r.created_at]
            )
        }
    }

    // chat_sessions：INSERT OR IGNORE，保留新库已修改的标题
    if (tables.has('chat_sessions')) {
        for (const r of oldAll<any>(
            oldDb,
            'SELECT id, title, created_at, updated_at FROM chat_sessions'
        )) {
            runNoPersist(
                'INSERT OR IGNORE INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
                [r.id, r.title, r.created_at, r.updated_at]
            )
        }
    }

    // chat_messages：id 自增会冲突，按 (session_id, content, created_at) 去重后不带 id 插入
    if (tables.has('chat_messages')) {
        const cols = oldCols('chat_messages')
        const hasToolCalls = cols.includes('tool_calls')
        const hasImages = cols.includes('images')
        const selectSql = `SELECT session_id, role, content, created_at${
            hasToolCalls ? ', tool_calls' : ''
        }${hasImages ? ', images' : ''} FROM chat_messages ORDER BY id ASC`
        for (const r of oldAll<any>(oldDb, selectSql)) {
            const dup = get(
                'SELECT 1 FROM chat_messages WHERE session_id = ? AND content = ? AND created_at = ?',
                [r.session_id, r.content, r.created_at]
            )
            if (dup) continue
            runNoPersist(
                'INSERT INTO chat_messages (session_id, role, content, tool_calls, images, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [r.session_id, r.role, r.content, r.tool_calls ?? null, r.images ?? null, r.created_at]
            )
        }
    }

    // chat_checkpoints：INSERT OR IGNORE（复合主键）
    if (tables.has('chat_checkpoints')) {
        for (const r of oldAll<any>(
            oldDb,
            'SELECT thread_id, checkpoint_ns, checkpoint_id, parent_id, checkpoint, metadata, created_at FROM chat_checkpoints'
        )) {
            runNoPersist(
                'INSERT OR IGNORE INTO chat_checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_id, checkpoint, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [r.thread_id, r.checkpoint_ns, r.checkpoint_id, r.parent_id, r.checkpoint, r.metadata, r.created_at]
            )
        }
    }

    // chat_writes：INSERT OR IGNORE（复合主键）
    if (tables.has('chat_writes')) {
        for (const r of oldAll<any>(
            oldDb,
            'SELECT thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value FROM chat_writes'
        )) {
            runNoPersist(
                'INSERT OR IGNORE INTO chat_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [r.thread_id, r.checkpoint_ns, r.checkpoint_id, r.task_id, r.idx, r.channel, r.value]
            )
        }
    }

    flush()
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
        sector: string
        sub_sector: string
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

export function addHolding(
    code: string,
    name: string,
    costPrice: number,
    quantity: number,
    sector?: string,
    subSector?: string
) {
    // 兼容新旧表结构：同时插入 cost_price 和 avg_cost_price
    run(
        'INSERT INTO holdings (code, name, sector, sub_sector, cost_price, avg_cost_price, quantity) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [code, name, sector ?? '', subSector ?? '', costPrice, costPrice, quantity]
    )
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

export function updateHoldingSector(id: number, sector: string, subSector: string) {
    run(
        "UPDATE holdings SET sector = ?, sub_sector = ?, updated_at = datetime('now') WHERE id = ?",
        [sector, subSector, id]
    )
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

export function addToWatchlist(
    code: string,
    name: string,
    note?: string,
    sector?: string,
    subSector?: string
) {
    run('INSERT OR IGNORE INTO watchlist (code, name, sector, sub_sector, note) VALUES (?, ?, ?, ?, ?)', [
        code,
        name,
        sector ?? '',
        subSector ?? '',
        note ?? '',
    ])
}

export function updateWatchlistSector(id: number, sector: string, subSector: string) {
    run('UPDATE watchlist SET sector = ?, sub_sector = ? WHERE id = ?', [sector, subSector, id])
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
        formatHoldingsSummary(),
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

export interface HoldingsSummaryOptions {
    /** 单只持仓最大展示条数，超出按成本占比聚合尾段，默认 15 */
    maxItems?: number
}

/**
 * 生成用户持仓摘要（成本口径，不含实时价，0 网络延迟）。
 * 用于注入 AI user profile 上下文，让 AI 被动知道用户持有什么。
 * 实时盈亏由 researchAgent 的 get_my_holdings 工具按需获取。
 */
export function formatHoldingsSummary(options?: HoldingsSummaryOptions): string {
    const maxItems = options?.maxItems ?? 15
    const holdings = getAllHoldings()
    if (holdings.length === 0) return '当前持仓：无'

    const rows = holdings.map((h) => {
        const costPrice = (h.avg_cost_price || (h as { cost_price?: number }).cost_price || 0) as number
        return {
            code: h.code,
            name: h.name,
            sector: (h.sector ?? '').trim(),
            subSector: (h.sub_sector ?? '').trim(),
            quantity: h.quantity,
            avgCostPrice: costPrice,
            cost: costPrice * h.quantity,
        }
    })
    const totalCost = rows.reduce((s, r) => s + r.cost, 0)
    if (totalCost <= 0) return '当前持仓：无'

    rows.sort((a, b) => b.cost - a.cost)

    const pct = (v: number) => `${((v / totalCost) * 100).toFixed(1)}%`
    const sectorText = (s: string, sub: string) =>
        s && sub ? `${s}/${sub}` : s || sub || '未分类'

    const visible = rows.slice(0, maxItems)
    const rest = rows.slice(maxItems)
    const restCost = rest.reduce((s, r) => s + r.cost, 0)

    const lines: string[] = []
    lines.push(`当前持仓（共 ${rows.length} 只，按成本占比降序，成本口径不含实时价）：`)
    for (const r of visible) {
        lines.push(
            `- ${r.code} ${r.name} | ${sectorText(r.sector, r.subSector)} | ${r.quantity}股 @ ${r.avgCostPrice.toFixed(2)}（成本 ${Math.round(r.cost)}，占 ${pct(r.cost)}）`
        )
    }
    if (rest.length > 0) {
        lines.push(`[其余 ${rest.length} 只合计成本 ${Math.round(restCost)} 元，占 ${pct(restCost)}，未展开]`)
    }

    // 行业分布（按成本）
    const sectorMap = new Map<string, { cost: number; count: number }>()
    for (const r of rows) {
        const k = r.sector || '未分类'
        const cur = sectorMap.get(k) ?? { cost: 0, count: 0 }
        cur.cost += r.cost
        cur.count += 1
        sectorMap.set(k, cur)
    }
    const sectorDist = [...sectorMap.entries()]
        .sort((a, b) => b[1].cost - a[1].cost)
        .map(([k, v]) => `${k} ${pct(v.cost)}（${v.count}只）`)
        .join('、')
    lines.push(`行业分布（按成本）：${sectorDist}`)

    const top = rows[0]
    lines.push(`最大单只占比：${pct(top.cost)}（${top.name}）`)
    lines.push('注：以上为成本口径，不含实时市值与浮盈亏；需实时盈亏请调用 get_my_holdings 工具。')
    return lines.join('\n')
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
    images: string | null
    created_at: string
}

export interface ImageContent {
    id: string
    dataUrl: string
    name: string
    type: string
}

export function listChatMessages(sessionId: string): ChatMessageRow[] {
    return all<ChatMessageRow>(
        'SELECT id, session_id, role, content, tool_calls, images, created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC',
        [sessionId]
    )
}

export function appendChatMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    toolCalls?: unknown,
    images?: ImageContent[]
): void {
    run(
        'INSERT INTO chat_messages (session_id, role, content, tool_calls, images) VALUES (?, ?, ?, ?, ?)',
        [sessionId, role, content, toolCalls ? JSON.stringify(toolCalls) : null, images ? JSON.stringify(images) : null]
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

// ===== 每日决策记忆 + 命中追踪 =====

export interface SaveDecisionInput {
    decisionDate: string
    marketContext: string
    decisionText: string
    structuredDecision: {
        summary: string
        marketBias: string
        maxPositionPerTarget: number
        observeReason: string | null
        picks: Array<{
            priority: number
            action: 'watch' | 'avoid'
            code: string
            name: string
            reason: string
            aggressiveEntry: number | null
            conservativeEntry: number | null
            stopLoss: number | null
            takeProfit: number | null
            positionAmount: number
            noBuyCondition: string
            riskNote: string
        }>
    } | null
    diagnostics?: unknown
    capital?: number
    riskLevel?: string
    marketRegime?: unknown
}

export interface DecisionHistoryRow {
    id: number
    decision_date: string
    market_context: string
    decision_text: string
    structured_decision: string | null
    diagnostics: string | null
    capital: number | null
    risk_level: string | null
    review_status: 'pending' | 'partial' | 'reviewed'
    market_regime: string | null
    created_at: string
}

export interface DecisionPickReviewRow {
    id: number
    decision_id: number
    code: string
    name: string
    priority: number | null
    action: 'watch' | 'avoid' | null
    aggressive_entry: number | null
    conservative_entry: number | null
    stop_loss: number | null
    take_profit: number | null
    position_amount: number | null
    status: 'pending' | 'reviewed' | 'failed'
    review_date: string | null
    entry_triggered: 0 | 1
    entry_type: 'aggressive' | 'conservative' | null
    entry_price: number | null
    entry_date: string | null
    exit_reason: string | null
    exit_price: number | null
    exit_date: string | null
    return_pct: number | null
    pnl_amount: number | null
    kline_snapshot: string | null
    error_msg: string | null
    reviewed_at: string | null
}

export interface PickReviewResult {
    status: 'reviewed' | 'failed'
    entry_triggered: 0 | 1
    entry_type: 'aggressive' | 'conservative' | null
    entry_price: number | null
    entry_date: string | null
    exit_reason: 'stop_loss' | 'take_profit' | 'window_end' | 'none' | 'not_applicable' | null
    exit_price: number | null
    exit_date: string | null
    return_pct: number | null
    pnl_amount: number | null
    kline_snapshot: string | null
    error_msg: string | null
}

export interface DecisionStats {
    decision_count: number
    pick_total: number
    actionable_count: number
    entry_triggered_count: number
    closed_count: number
    profitable_count: number
    trigger_rate: number
    win_rate: number
    avg_return_pct: number | null
    total_pnl: number
}

export function saveDecision(input: SaveDecisionInput): number {
    const sd = input.structuredDecision
    const hasPicks = sd !== null && Array.isArray(sd.picks) && sd.picks.length > 0
    const reviewStatus = hasPicks ? 'pending' : 'reviewed'
    const sdJson = sd ? JSON.stringify(sd) : null
    const diagJson = input.diagnostics !== undefined ? JSON.stringify(input.diagnostics) : null
    const regimeJson = input.marketRegime !== undefined ? JSON.stringify(input.marketRegime) : null
    const nowIso = new Date().toISOString()

    run(
        `INSERT OR REPLACE INTO decision_history
            (decision_date, market_context, decision_text, structured_decision, diagnostics, capital, risk_level, review_status, market_regime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            input.decisionDate, input.marketContext, input.decisionText, sdJson, diagJson,
            input.capital ?? null, input.riskLevel ?? null, reviewStatus, regimeJson
        ]
    )
    const row = get<{ id: number }>(
        'SELECT id FROM decision_history WHERE decision_date = ?',
        [input.decisionDate]
    )
    const decisionId = row!.id

    // INSERT OR REPLACE 已换 id 并 cascade 清旧 pick review；此处双保险
    runNoPersist('DELETE FROM decision_pick_reviews WHERE decision_id = ?', [decisionId])

    if (hasPicks && sd) {
        for (const p of sd.picks) {
            const isAvoid = p.action === 'avoid'
            runNoPersist(
                `INSERT INTO decision_pick_reviews
                    (decision_id, code, name, priority, action, aggressive_entry, conservative_entry,
                     stop_loss, take_profit, position_amount, status, entry_triggered, exit_reason, reviewed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    decisionId, p.code, p.name, p.priority, p.action,
                    p.aggressiveEntry, p.conservativeEntry, p.stopLoss, p.takeProfit, p.positionAmount,
                    isAvoid ? 'reviewed' : 'pending',
                    0,
                    isAvoid ? 'not_applicable' : null,
                    isAvoid ? nowIso : null
                ]
            )
        }
    }
    flush()
    return decisionId
}

export function getDecisions(limit = 30): DecisionHistoryRow[] {
    return all<DecisionHistoryRow>(
        'SELECT * FROM decision_history ORDER BY decision_date DESC LIMIT ?',
        [limit]
    )
}

export function getUnreviewedDecisions(beforeDate: string): DecisionHistoryRow[] {
    return all<DecisionHistoryRow>(
        `SELECT * FROM decision_history WHERE review_status != 'reviewed' AND decision_date < ? ORDER BY decision_date ASC`,
        [beforeDate]
    )
}

export function getDecisionById(id: number): DecisionHistoryRow | undefined {
    return get<DecisionHistoryRow>('SELECT * FROM decision_history WHERE id = ?', [id])
}

export function getPickReviewsByDecisionId(decisionId: number): DecisionPickReviewRow[] {
    return all<DecisionPickReviewRow>(
        'SELECT * FROM decision_pick_reviews WHERE decision_id = ? ORDER BY priority, id',
        [decisionId]
    )
}

export function getPendingPickReviews(decisionId: number): DecisionPickReviewRow[] {
    return all<DecisionPickReviewRow>(
        `SELECT * FROM decision_pick_reviews WHERE decision_id = ? AND status != 'reviewed' ORDER BY priority, id`,
        [decisionId]
    )
}

export function updatePickReview(id: number, result: PickReviewResult, reviewDate: string): void {
    run(
        `UPDATE decision_pick_reviews SET
            status = ?, review_date = ?, entry_triggered = ?, entry_type = ?, entry_price = ?,
            entry_date = ?, exit_reason = ?, exit_price = ?, exit_date = ?, return_pct = ?,
            pnl_amount = ?, kline_snapshot = ?, error_msg = ?, reviewed_at = datetime('now')
        WHERE id = ?`,
        [
            result.status, reviewDate, result.entry_triggered, result.entry_type, result.entry_price,
            result.entry_date, result.exit_reason, result.exit_price, result.exit_date, result.return_pct,
            result.pnl_amount, result.kline_snapshot, result.error_msg, id
        ]
    )
}

export function updateDecisionReviewStatus(decisionId: number): void {
    const rows = all<{ status: string }>(
        'SELECT status FROM decision_pick_reviews WHERE decision_id = ?',
        [decisionId]
    )
    let status: 'pending' | 'partial' | 'reviewed'
    if (rows.length === 0) {
        status = 'reviewed'
    } else if (rows.every((r) => r.status === 'reviewed')) {
        status = 'reviewed'
    } else if (rows.some((r) => r.status === 'reviewed')) {
        status = 'partial'
    } else {
        status = 'pending'
    }
    run('UPDATE decision_history SET review_status = ? WHERE id = ?', [status, decisionId])
}

export function getDecisionStats(days: number): DecisionStats {
    const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    const row = get<{
        decision_count: number
        pick_total: number
        actionable_count: number
        entry_triggered_count: number
        closed_count: number
        profitable_count: number
        avg_return_pct: number | null
        total_pnl: number | null
    }>(
        `SELECT
            COUNT(DISTINCT dh.id) AS decision_count,
            COUNT(dpr.id) AS pick_total,
            SUM(CASE WHEN dpr.action = 'watch' AND (dpr.aggressive_entry IS NOT NULL OR dpr.conservative_entry IS NOT NULL) THEN 1 ELSE 0 END) AS actionable_count,
            SUM(CASE WHEN dpr.entry_triggered = 1 THEN 1 ELSE 0 END) AS entry_triggered_count,
            SUM(CASE WHEN dpr.action = 'watch' AND dpr.status = 'reviewed' AND dpr.entry_triggered = 1 THEN 1 ELSE 0 END) AS closed_count,
            SUM(CASE WHEN dpr.action = 'watch' AND dpr.status = 'reviewed' AND dpr.entry_triggered = 1 AND dpr.return_pct > 0 THEN 1 ELSE 0 END) AS profitable_count,
            AVG(CASE WHEN dpr.action = 'watch' AND dpr.status = 'reviewed' AND dpr.entry_triggered = 1 THEN dpr.return_pct END) AS avg_return_pct,
            SUM(CASE WHEN dpr.action = 'watch' AND dpr.status = 'reviewed' AND dpr.entry_triggered = 1 THEN dpr.pnl_amount END) AS total_pnl
        FROM decision_history dh LEFT JOIN decision_pick_reviews dpr ON dpr.decision_id = dh.id
        WHERE dh.decision_date >= ?`,
        [sinceDate]
    )
    if (!row) {
        return {
            decision_count: 0, pick_total: 0, actionable_count: 0, entry_triggered_count: 0,
            closed_count: 0, profitable_count: 0, trigger_rate: 0, win_rate: 0,
            avg_return_pct: null, total_pnl: 0
        }
    }
    const actionable = row.actionable_count || 0
    const closed = row.closed_count || 0
    return {
        decision_count: row.decision_count || 0,
        pick_total: row.pick_total || 0,
        actionable_count: actionable,
        entry_triggered_count: row.entry_triggered_count || 0,
        closed_count: closed,
        profitable_count: row.profitable_count || 0,
        trigger_rate: actionable > 0 ? Number(((row.entry_triggered_count / actionable) * 100).toFixed(1)) : 0,
        win_rate: closed > 0 ? Number(((row.profitable_count / closed) * 100).toFixed(1)) : 0,
        avg_return_pct: row.avg_return_pct !== null ? Number(row.avg_return_pct.toFixed(2)) : null,
        total_pnl: row.total_pnl !== null ? Number(row.total_pnl.toFixed(2)) : 0
    }
}

export function deleteDecision(id: number): void {
    runNoPersist('DELETE FROM decision_pick_reviews WHERE decision_id = ?', [id])
    runNoPersist('DELETE FROM decision_history WHERE id = ?', [id])
    flush()
}
