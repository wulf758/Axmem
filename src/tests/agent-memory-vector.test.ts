// AXMEM semantic/vector candidate path — Phase 3/B5.
//
// The implementation is local and deterministic: hashed bag-of-words embedding
// cells generate candidates, then the normal deterministic scorer reranks them.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { buildMemorySearchStore, ingestMemoryPack, recallMemory } from "../memory"

function freshStore(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `axmem-vector-${label}-`))
}

function manifestPath(cwd: string): string {
    return path.join(cwd, ".axmem", "memory", "search", "manifest.axsearch.json")
}

test("AXMEM B5 — vector metadata is stored and deterministic rerank handles semantic aliases", () => {
    const tmp = freshStore("semantic")
    ingestMemoryPack({
        cwd: tmp,
        taskId: "fts-recovery-card",
        title: "SQLite FTS corruption recovery",
        tags: ["sqlite", "fts", "corruption", "recovery"],
        document: {
            summary: "The inverted search store can rebuild after corruption."
        }
    })
    ingestMemoryPack({
        cwd: tmp,
        taskId: "unrelated-card",
        title: "Unrelated calendar note",
        tags: ["calendar", "note"],
        document: {
            summary: "This card should not win the semantic alias check."
        }
    })

    buildMemorySearchStore({ cwd: tmp, reason: "manual" })
    const manifest = JSON.parse(fs.readFileSync(manifestPath(tmp), "utf8")) as {
        embedding?: { model_id?: string; dimensions?: number; normalization?: string; corpus_fingerprint?: string }
        vector_cells?: Record<string, string[]>
        vector_cell_files?: Record<string, string>
    }
    assert.equal(manifest.embedding?.model_id, "axiom-local-hash-bow-v1")
    assert.equal(manifest.embedding?.dimensions, 64)
    assert.equal(manifest.embedding?.normalization, "l2")
    assert.equal(typeof manifest.embedding?.corpus_fingerprint, "string")
    assert.equal(Object.keys(manifest.vector_cells ?? {}).length > 0, true)
    assert.equal(Object.keys(manifest.vector_cell_files ?? {}).length > 0, true)

    const recalled = recallMemory({ cwd: tmp, query: "database recover", profile: "ultra" })
    const repeated = recallMemory({ cwd: tmp, query: "database recover", profile: "ultra" })
    assert.equal(recalled.results[0]?.task_id, "fts-recovery-card")
    assert.deepEqual(recalled.results.map((item) => item.task_id), repeated.results.map((item) => item.task_id))
    assert.equal(recalled.access_tiers.includes("L3_VECTOR_INDEX"), true)

    const fileBackedOnlyManifest = {
        ...manifest,
        vector_cells: {}
    }
    fs.writeFileSync(manifestPath(tmp), `${JSON.stringify(fileBackedOnlyManifest, null, 2)}\n`, "utf8")
    const fileBackedRecall = recallMemory({ cwd: tmp, query: "database recover", profile: "ultra" })
    assert.equal(fileBackedRecall.results[0]?.task_id, "fts-recovery-card")
    withAxmemMutation("ignore_vector_cell_files", () => {
        const mutated = recallMemory({ cwd: tmp, query: "database recover", profile: "ultra" })
        assert.notEqual(mutated.results[0]?.task_id, "fts-recovery-card")
    })

    const vectorlessManifest = {
        ...fileBackedOnlyManifest,
        vector_cell_files: {}
    }
    fs.writeFileSync(manifestPath(tmp), `${JSON.stringify(vectorlessManifest, null, 2)}\n`, "utf8")
    const vectorlessRecall = recallMemory({ cwd: tmp, query: "database recover", profile: "ultra" })
    assert.notEqual(vectorlessRecall.results[0]?.task_id, "fts-recovery-card")
})

test("AXMEM B5/A6 — vector candidates are reranked by deterministic keyword and trust scoring", () => {
    const tmp = freshStore("rerank")
    ingestMemoryPack({
        cwd: tmp,
        taskId: "refund-active-card",
        title: "Refund active bounded card",
        tags: ["refund", "captured", "amount", "active", "bounded"],
        document: {
            summary: "Current truth: refund is bounded by captured amount."
        }
    })
    ingestMemoryPack({
        cwd: tmp,
        taskId: "semantic-invalidated-card",
        title: "SQLite FTS corruption recovery decoy",
        tags: ["sqlite", "fts", "corruption", "recovery"],
        document: {
            summary: "Historical false path that should only be a vector candidate.",
            invalidated_hypotheses: [{
                hypothesis: "Database recovery vector candidate should override keyword trust",
                reason: "ANN candidates are only candidates, never the final verdict",
                next_better_hypothesis: "Deterministic keyword and trust rerank chooses current truth",
                invalidated_by: ["vector-rerank-test"]
            }]
        }
    })

    buildMemorySearchStore({ cwd: tmp, reason: "manual" })
    const query = "refund captured amount database recover"
    const recalled = recallMemory({ cwd: tmp, query, profile: "ultra" })
    const repeated = recallMemory({ cwd: tmp, query, profile: "ultra" })
    assert.equal(recalled.results[0]?.task_id, "refund-active-card")
    assert.deepEqual(recalled.results.map((item) => item.task_id), repeated.results.map((item) => item.task_id))
    assert.equal(recalled.access_tiers.includes("L3_VECTOR_INDEX"), true)

    withAxmemMutation("ann_only_rerank", () => {
        const mutated = recallMemory({ cwd: tmp, query, profile: "ultra" })
        assert.notEqual(mutated.results[0]?.task_id, "refund-active-card")
    })
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
