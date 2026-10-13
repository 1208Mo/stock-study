/**
 * 数据备份与导出
 *
 * 数据库是单个 SQLite 文件，持仓、交易流水、决策历史和战绩都在里面，
 * 其中战绩是靠时间一天天攒出来的，丢了没法重建，所以必须有导出能力。
 *
 * 提供三种出口：
 * - JSON 备份：结构化全量导出，可跨版本恢复（对话记录默认不含，体积大且可再生）
 * - 数据库文件副本：最保险的冷备份，直接替换回去即可
 * - CSV：持仓和交易流水，给 Excel 用
 */

import { copyFileSync, writeFileSync, readFileSync } from 'fs'
import { app } from 'electron'
import { dumpAllTables, flush, getDbPath, restoreTables, getAllHoldings, getHoldingTrades } from '../db'

export interface BackupPayload {
    format: 'stockmind-backup'
    version: number
    appVersion: string
    exportedAt: string
    includeChat: boolean
    tables: Record<string, unknown[]>
}

const BACKUP_VERSION = 1

export function buildBackup(includeChat = false): BackupPayload {
    return {
        format: 'stockmind-backup',
        version: BACKUP_VERSION,
        appVersion: app.getVersion(),
        exportedAt: new Date().toISOString(),
        includeChat,
        tables: dumpAllTables({ includeChat }),
    }
}

export function exportBackupJson(targetPath: string, includeChat = false): { path: string; tables: number; rows: number } {
    const payload = buildBackup(includeChat)
    writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf-8')
    const rows = Object.values(payload.tables).reduce((a, t) => a + t.length, 0)
    return { path: targetPath, tables: Object.keys(payload.tables).length, rows }
}

export function exportDbFile(targetPath: string): { path: string } {
    // 先把内存库落盘，否则副本可能落后于当前数据
    flush()
    copyFileSync(getDbPath(), targetPath)
    return { path: targetPath }
}

function csvCell(v: unknown): string {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(headers: string[], rows: unknown[][]): string {
    // 带 BOM，否则 Excel 打开中文会乱码
    return '\ufeff' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function exportHoldingsCsv(targetPath: string): { path: string; rows: number } {
    const holdings = getAllHoldings()
    const rows = holdings.map((h) => [
        h.code,
        h.name,
        h.sector,
        h.sub_sector,
        h.avg_cost_price,
        h.quantity,
        (h.avg_cost_price * h.quantity).toFixed(2),
        h.created_at,
    ])
    writeFileSync(
        targetPath,
        toCsv(['代码', '名称', '板块', '细分板块', '成本价', '持仓量', '成本市值', '建仓时间'], rows),
        'utf-8'
    )
    return { path: targetPath, rows: rows.length }
}

export function exportTradesCsv(targetPath: string): { path: string; rows: number } {
    const rows: unknown[][] = []
    for (const h of getAllHoldings()) {
        for (const t of getHoldingTrades(h.id)) {
            rows.push([
                t.trade_date,
                h.code,
                h.name,
                t.trade_type === 'buy' ? '买入' : '卖出',
                t.cost_price,
                t.quantity,
                (t.cost_price * t.quantity).toFixed(2),
                t.note ?? '',
            ])
        }
    }
    rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])))
    writeFileSync(
        targetPath,
        toCsv(['时间', '代码', '名称', '方向', '价格', '数量', '金额', '备注'], rows),
        'utf-8'
    )
    return { path: targetPath, rows: rows.length }
}

export interface ImportResult {
    restored: string[]
    skipped: string[]
    rows: number
    exportedAt: string
}

/**
 * 从 JSON 备份恢复。会先把当前库另存一份 .before-restore 副本兜底，
 * 再整表覆盖。恢复后建议重启应用，让各处缓存重新加载。
 */
export function importBackupJson(sourcePath: string): ImportResult {
    const raw = readFileSync(sourcePath, 'utf-8')
    let payload: BackupPayload
    try {
        payload = JSON.parse(raw)
    } catch {
        throw new Error('文件不是合法 JSON，请确认选的是 StockMind 导出的备份')
    }
    if (payload?.format !== 'stockmind-backup' || !payload.tables) {
        throw new Error('不是 StockMind 备份文件（缺少 format 标记）')
    }
    if (payload.version > BACKUP_VERSION) {
        throw new Error(`备份版本 v${payload.version} 比当前程序支持的 v${BACKUP_VERSION} 更新，请先升级应用`)
    }

    flush()
    try {
        copyFileSync(getDbPath(), `${getDbPath()}.before-restore`)
    } catch (e) {
        console.warn('恢复前备份当前库失败:', e)
    }

    const { restored, skipped } = restoreTables(payload.tables)
    const rows = Object.values(payload.tables).reduce((a, t) => a + (t as unknown[]).length, 0)
    return { restored, skipped, rows, exportedAt: payload.exportedAt ?? '' }
}
