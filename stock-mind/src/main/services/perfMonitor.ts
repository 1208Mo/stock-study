import { app, powerMonitor } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { monitorEventLoopDelay } from 'perf_hooks'

/**
 * 性能诊断：排查“后台挂着、睡眠唤醒后电脑很卡”。
 * - 常态每 5 分钟记一条各进程 CPU / 内存 + 主进程事件循环延迟
 * - 睡眠 / 唤醒 / 锁屏事件打点；唤醒后 3 分钟内改为每 5 秒采样，抓住唤醒瞬间的突发
 * 日志：<userData>/logs/perf.log，超过 2MB 轮转为 perf.log.1
 */

const IDLE_SAMPLE_MS = 5 * 60_000
const BURST_SAMPLE_MS = 5_000
const BURST_DURATION_MS = 3 * 60_000
const MAX_LOG_BYTES = 2 * 1024 * 1024

let logPath = ''
let burstUntil = 0
let timer: ReturnType<typeof setTimeout> | null = null
const loopDelay = monitorEventLoopDelay({ resolution: 20 })

function write(line: string): void {
    try {
        if (existsSync(logPath) && statSync(logPath).size > MAX_LOG_BYTES) renameSync(logPath, `${logPath}.1`)
        appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`)
    } catch {
        /* 诊断日志写失败不影响业务 */
    }
}

function sample(tag: string): void {
    // 按进程类型汇总：Browser=主进程，Tab=各窗口渲染进程，GPU 等
    const procs = app.getAppMetrics().map((m) => {
        const mb = Math.round(m.memory.workingSetSize / 1024)
        return `${m.type}#${m.pid}:cpu=${m.cpu.percentCPUUsage.toFixed(1)}%,mem=${mb}MB`
    })
    const p99 = (loopDelay.percentile(99) / 1e6).toFixed(0)
    const max = (loopDelay.max / 1e6).toFixed(0)
    loopDelay.reset()
    write(`[${tag}] loopDelay p99=${p99}ms max=${max}ms | ${procs.join(' ')}`)
}

function scheduleNext(): void {
    if (timer) clearTimeout(timer)
    const bursting = Date.now() < burstUntil
    timer = setTimeout(() => {
        sample(bursting ? 'burst' : 'idle')
        scheduleNext()
    }, bursting ? BURST_SAMPLE_MS : IDLE_SAMPLE_MS)
}

export function startPerfMonitor(): void {
    const dir = join(app.getPath('userData'), 'logs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    logPath = join(dir, 'perf.log')
    loopDelay.enable()
    write(`[start] pid=${process.pid} electron=${process.versions.electron} log=${logPath}`)

    powerMonitor.on('suspend', () => {
        sample('suspend')
        write('[event] suspend')
    })
    powerMonitor.on('resume', () => {
        write('[event] resume')
        burstUntil = Date.now() + BURST_DURATION_MS
        sample('resume')
        scheduleNext()
    })
    powerMonitor.on('lock-screen', () => write('[event] lock-screen'))
    powerMonitor.on('unlock-screen', () => {
        write('[event] unlock-screen')
        burstUntil = Date.now() + BURST_DURATION_MS
        scheduleNext()
    })

    // 首次采样先等 app.getAppMetrics 有 CPU 基线
    setTimeout(() => sample('idle'), 10_000)
    scheduleNext()
}
