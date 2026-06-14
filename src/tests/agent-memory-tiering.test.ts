// AXMEM tiering — L2 access-cost VMM.
//
// The pack LRU is allowed to evict aggressively, but only after dirty staged
// packs are persisted. Pinned/hot entries must survive cold eviction first, and
// focused recall must transparently cross the search-store and pack tiers.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
    buildMemorySearchStore,
    clearMemoryTierCaches,
    evictMemoryTiers,
    getMemoryTierCacheStats,
    ingestMemoryPack,
    packMemoryPack,
    pinMemoryPackTierEntry,
    prefetchMemoryPacks,
    promoteMemoryPackTierEntry,
    recallMemory,
    stageMemoryPackInHotTier,
    unpackMemoryPack,
    type AgentMemoryPack
} from "../memory"

function freshStore(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `axmem-tier-${label}-`))
}

function packPath(cwd: string, taskId: string): string {
    return path.join(cwd, ".axmem", "memory", `${taskId}.axmem`)
}

function relativePackPath(taskId: string): string {
    return path.join(".axmem", "memory", `${taskId}.axmem`)
}

function makePack(taskId: string, goal: string): AgentMemoryPack {
    const now = "2026-06-09T00:00:00.000Z"
    return {
        schema: "axiom.agent_memory_pack.v0",
        version: 1,
        task: {
            id: taskId,
            title: `${taskId} title`,
            tags: [taskId, "tiering"],
            canonical_tags: [],
            agent_tags: [taskId, "tiering"],
            created_at: now,
            updated_at: now
        },
        summary: {
            goal,
            resume_command: `node dist/cli.js memory recall --task ${taskId}`
        },
        semantic_refs: [],
        decisions: [],
        commands: [],
        next_actions: [],
        evidence: []
    }
}

test("AXMEM L2 — evictor writes dirty staged packs before eviction", () => {
    const tmp = freshStore("write-before-evict")
    clearMemoryTierCaches()
    const taskId = "dirty-staged-card"
    stageMemoryPackInHotTier({ cwd: tmp, pack: makePack(taskId, "dirty truth survives eviction") })

    const before = getMemoryTierCacheStats()
    assert.equal(before.dirty_entries, 1)
    assert.equal(fs.existsSync(packPath(tmp, taskId)), false)

    const evicted = evictMemoryTiers({ cwd: tmp, maxCompressedBytes: 0 })
    assert.equal(evicted.status, "ok")
    assert.equal(evicted.persisted_before_evict_count, 1)
    assert.deepEqual(evicted.evicted_pack_paths, [relativePackPath(taskId).replaceAll("\\", "/")])
    assert.equal(fs.existsSync(packPath(tmp, taskId)), true)
    assert.equal(unpackMemoryPack(fs.readFileSync(packPath(tmp, taskId))).summary.goal, "dirty truth survives eviction")

    withAxmemMutation("drop_write_before_evict", () => {
        clearMemoryTierCaches()
        const mutatedTaskId = "dirty-mutant-card"
        stageMemoryPackInHotTier({ cwd: tmp, pack: makePack(mutatedTaskId, "must not disappear") })
        const mutated = evictMemoryTiers({ cwd: tmp, maxCompressedBytes: 0 })
        assert.equal(mutated.status, "blocked")
        assert.deepEqual(mutated.blocked_pack_paths, [relativePackPath(mutatedTaskId).replaceAll("\\", "/")])
        assert.equal(fs.existsSync(packPath(tmp, mutatedTaskId)), false)
    })
    clearMemoryTierCaches()
})

test("AXMEM L2 — eviction respects pinned and promoted pack-cache entries", () => {
    const tmp = freshStore("policy")
    clearMemoryTierCaches()
    for (const taskId of ["pinned-card", "promoted-card", "cold-card"]) {
        stageMemoryPackInHotTier({ cwd: tmp, pack: makePack(taskId, `${taskId} goal`) })
    }
    pinMemoryPackTierEntry({ cwd: tmp, packPath: relativePackPath("pinned-card"), reason: "active task" })
    promoteMemoryPackTierEntry({ cwd: tmp, packPath: relativePackPath("promoted-card") })

    const stats = getMemoryTierCacheStats()
    const pinnedBytes = stats.entries.find((entry) => entry.pack_path.endsWith("pinned-card.axmem"))?.compressed_bytes ?? 0
    const promotedBytes = stats.entries.find((entry) => entry.pack_path.endsWith("promoted-card.axmem"))?.compressed_bytes ?? 0
    assert.equal(pinnedBytes > 0, true)
    assert.equal(promotedBytes > 0, true)

    const evicted = evictMemoryTiers({ cwd: tmp, maxCompressedBytes: pinnedBytes + promotedBytes })
    assert.equal(evicted.status, "ok")
    assert.deepEqual(evicted.evicted_pack_paths, [relativePackPath("cold-card").replaceAll("\\", "/")])
    const remaining = getMemoryTierCacheStats().entries.map((entry) => entry.pack_path).sort()
    assert.deepEqual(remaining, [
        relativePackPath("pinned-card").replaceAll("\\", "/"),
        relativePackPath("promoted-card").replaceAll("\\", "/")
    ].sort())
    clearMemoryTierCaches()
})

test("AXMEM L2 — focused recall spans search store and pack tiers after eviction", () => {
    const tmp = freshStore("spans")
    clearMemoryTierCaches()
    ingestMemoryPack({
        cwd: tmp,
        taskId: "tiered-coherence",
        title: "Tiered coherence card",
        tags: ["tiered", "coherence", "search-store"],
        document: {
            summary: { goal: "old tier truth" },
            decisions: ["focused recall must hydrate the pack tier"]
        }
    })
    buildMemorySearchStore({ cwd: tmp, reason: "manual" })
    fs.writeFileSync(path.join(tmp, ".axmem", "memory", "index.axmem.json"), "{ broken json", "utf8")

    const first = recallMemory({ cwd: tmp, query: "tiered coherence search-store", profile: "focused" })
    assert.equal(first.results[0]?.task_id, "tiered-coherence")
    assert.equal(first.results[0]?.summary.goal, "old tier truth")
    assert.equal(first.access_tiers.includes("L2_SEARCH_STORE"), true)
    assert.equal(first.access_tiers.includes("L1_PACK_LRU"), true)
    assert.equal(first.access_tiers.includes("L2_COMPRESSED_PACK"), true)

    const filePath = packPath(tmp, "tiered-coherence")
    const stat = fs.statSync(filePath)
    const pack = unpackMemoryPack(fs.readFileSync(filePath))
    pack.summary.goal = "new tier truth after eviction"
    fs.writeFileSync(filePath, packMemoryPack(pack))
    fs.utimesSync(filePath, stat.atime, stat.mtime)
    const evicted = evictMemoryTiers({ cwd: tmp, maxCompressedBytes: 0 })
    assert.equal(evicted.status, "ok")
    assert.equal(evicted.evicted_count > 0, true)

    const after = recallMemory({ cwd: tmp, query: "tiered coherence search-store", profile: "focused" })
    assert.equal(after.results[0]?.task_id, "tiered-coherence")
    assert.equal(after.results[0]?.summary.goal, "new tier truth after eviction")
    assert.equal(after.access_tiers.includes("L2_SEARCH_STORE"), true)
    assert.equal(after.access_tiers.includes("L1_PACK_LRU"), true)
    assert.equal(after.access_tiers.includes("L2_COMPRESSED_PACK"), true)
    clearMemoryTierCaches()
})

test("AXMEM L3 — predictive prefetch promotes graph/semantic neighbors into the hot tier", () => {
    const tmp = freshStore("prefetch")
    clearMemoryTierCaches()
    ingestMemoryPack({
        cwd: tmp,
        taskId: "seed-prefetch",
        title: "Seed prefetch card",
        tags: ["prefetch", "semantic-neighbor"],
        document: {
            summary: "Seed card for predictive prefetch.",
            semantic_refs: [{ kind: "module", name: "compiler/src/agent/memory.ts" }]
        }
    })
    ingestMemoryPack({
        cwd: tmp,
        taskId: "next-prefetch",
        title: "Next prefetch card",
        tags: ["prefetch", "semantic-neighbor"],
        document: {
            summary: "Likely next card sharing semantic refs.",
            semantic_refs: [{ kind: "module", name: "compiler/src/agent/memory.ts" }]
        }
    })
    ingestMemoryPack({
        cwd: tmp,
        taskId: "unrelated-prefetch",
        title: "Unrelated prefetch card",
        tags: ["unrelated"],
        document: {
            summary: "This card should not be warmed by the seed."
        }
    })

    clearMemoryTierCaches()
    const noPrefetch = recallMemory({ cwd: tmp, taskId: "seed-prefetch", profile: "focused" })
    assert.equal(noPrefetch.prefetch, undefined)
    assert.equal(getMemoryTierCacheStats().entries.some((entry) => entry.pack_path.endsWith("next-prefetch.axmem")), false)

    clearMemoryTierCaches()
    const prefetched = recallMemory({ cwd: tmp, taskId: "seed-prefetch", profile: "focused", prefetch: true, prefetchLimit: 1 })
    assert.deepEqual(prefetched.prefetch?.prefetched_task_ids, ["next-prefetch"])
    const warmed = getMemoryTierCacheStats().entries.find((entry) => entry.pack_path.endsWith("next-prefetch.axmem"))
    assert.ok(warmed)
    const accessBefore = warmed.access_count

    const next = recallMemory({ cwd: tmp, taskId: "next-prefetch", profile: "focused" })
    assert.equal(next.results[0]?.task_id, "next-prefetch")
    const after = getMemoryTierCacheStats().entries.find((entry) => entry.pack_path.endsWith("next-prefetch.axmem"))
    assert.ok(after)
    assert.equal(after.access_count > accessBefore, true)

    clearMemoryTierCaches()
    const explicit = prefetchMemoryPacks({ cwd: tmp, seedTaskIds: ["seed-prefetch"], limit: 2 })
    assert.equal(explicit.prefetched_task_ids.includes("next-prefetch"), true)
    assert.equal(explicit.prefetched_task_ids.includes("unrelated-prefetch"), false)

    withAxmemMutation("prefetch_recency_only", () => {
        clearMemoryTierCaches()
        const mutated = prefetchMemoryPacks({ cwd: tmp, seedTaskIds: ["seed-prefetch"], limit: 2 })
        assert.equal(mutated.prefetched_task_ids.includes("unrelated-prefetch"), true)
    })
    clearMemoryTierCaches()
})

function withAxmemMutation<T>(mutation: string, run: () => T): T {
    const previous = process.env.AXIOM_AXMEM_MUTATE
    process.env.AXIOM_AXMEM_MUTATE = mutation
    try {
        return run()
    } finally {
        if (previous === undefined) {
            delete process.env.AXIOM_AXMEM_MUTATE
        } else {
            process.env.AXIOM_AXMEM_MUTATE = previous
        }
    }
}
