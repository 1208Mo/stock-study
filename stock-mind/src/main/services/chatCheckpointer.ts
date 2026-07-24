/**
 * SqlJsCheckpointSaver
 * ────────────────────────────────────────────────────────────────────────
 * LangGraph 通过 BaseCheckpointSaver 抽象持久化 Agent 的状态。
 * 官方内置了 MemorySaver（进程内），但重启后就会丢。
 *
 * 这里的做法：
 * 1. 直接继承 MemorySaver，复用它已经写好的 getTuple/list/getDeltaChannelHistory
 *    等复杂读逻辑（涉及 v<4 迁移、delta channel 等，自己写容易踩坑）。
 * 2. 只覆盖三个写路径：put / putWrites / deleteThread。每次写完调用 super 让内存
 *    结构变最新，再把新增/更新的行落到 sql.js 的 chat_checkpoints / chat_writes。
 * 3. 构造时 hydrate 一次：把 db 里的所有行读回内存，之后所有读走内存。
 *
 * 结构对应关系（MemorySaver 内部）：
 *   storage[threadId][checkpoint_ns][checkpoint_id] = [checkpointBytes, metadataBytes, parentId?]
 *   writes[JSON.stringify([threadId, ns, cpId])][`${taskId},${idx}`] = [taskId, channel, valueBytes]
 */

import type { RunnableConfig } from '@langchain/core/runnables'
import type {
    Checkpoint,
    CheckpointMetadata,
    PendingWrite,
} from '@langchain/langgraph-checkpoint'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import {
    clearThreadState,
    loadAllCheckpoints,
    loadAllWrites,
    upsertCheckpoint,
    upsertWrite,
} from '../db'

export class SqlJsCheckpointSaver extends MemorySaver {
    constructor() {
        super()
        this.hydrate()
    }

    /**
     * 启动时把 db 里所有 checkpoint / write 记录塞回父类的 in-memory 结构。
     * 这样后续 getTuple/list 全部走内存，速度和 MemorySaver 一致。
     */
    private hydrate(): void {
        for (const row of loadAllCheckpoints()) {
            const ns = row.checkpoint_ns ?? ''
            if (!this.storage[row.thread_id]) {
                this.storage[row.thread_id] = Object.create(null)
            }
            if (!this.storage[row.thread_id][ns]) {
                this.storage[row.thread_id][ns] = Object.create(null)
            }
            this.storage[row.thread_id][ns][row.checkpoint_id] = [
                row.checkpoint,
                row.metadata,
                row.parent_id ?? undefined,
            ]
        }
        for (const row of loadAllWrites()) {
            const outerKey = JSON.stringify([row.thread_id, row.checkpoint_ns ?? '', row.checkpoint_id])
            if (!this.writes[outerKey]) {
                this.writes[outerKey] = Object.create(null)
            }
            const innerKey = `${row.task_id},${row.idx}`
            this.writes[outerKey][innerKey] = [row.task_id, row.channel, row.value]
        }
    }

    async put(
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata
    ): Promise<RunnableConfig> {
        const result = await super.put(config, checkpoint, metadata)
        const threadId = result.configurable?.thread_id as string
        const ns = (result.configurable?.checkpoint_ns as string) ?? ''
        const cpId = checkpoint.id
        const entry = this.storage[threadId]?.[ns]?.[cpId]
        if (entry) {
            const [checkpointBytes, metadataBytes, parentId] = entry
            upsertCheckpoint({
                thread_id: threadId,
                checkpoint_ns: ns,
                checkpoint_id: cpId,
                parent_id: parentId ?? null,
                checkpoint: checkpointBytes,
                metadata: metadataBytes,
            })
        }
        return result
    }

    async putWrites(
        config: RunnableConfig,
        writes: PendingWrite[],
        taskId: string
    ): Promise<void> {
        await super.putWrites(config, writes, taskId)
        const threadId = config.configurable?.thread_id as string
        const ns = (config.configurable?.checkpoint_ns as string) ?? ''
        const cpId = config.configurable?.checkpoint_id as string
        const outerKey = JSON.stringify([threadId, ns, cpId])
        const bucket = this.writes[outerKey]
        if (!bucket) return

        // 只把本次 taskId 的写入落库（其他 taskId 的行早已入库）
        for (const [innerKey, tuple] of Object.entries(bucket)) {
            const commaIdx = innerKey.lastIndexOf(',')
            const parsedTaskId = innerKey.slice(0, commaIdx)
            if (parsedTaskId !== taskId) continue
            const idx = Number(innerKey.slice(commaIdx + 1))
            const [tid, channel, value] = tuple
            upsertWrite({
                thread_id: threadId,
                checkpoint_ns: ns,
                checkpoint_id: cpId,
                task_id: tid,
                idx,
                channel,
                value,
            })
        }
    }

    async deleteThread(threadId: string): Promise<void> {
        await super.deleteThread(threadId)
        clearThreadState(threadId)
    }
}

// 单例：整个主进程共享同一个 checkpointer 实例，避免重复 hydrate
let instance: SqlJsCheckpointSaver | null = null
export function getChatCheckpointer(): SqlJsCheckpointSaver {
    if (!instance) {
        instance = new SqlJsCheckpointSaver()
    }
    return instance
}
