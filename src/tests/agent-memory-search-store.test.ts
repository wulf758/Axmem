// AXMEM search store — Phase 2/B4.
//
// The search store is a local inverted index made of a manifest, per-token
// postings, and per-task documents. It provides the roadmap's "inverted index"
// branch without adding an external SQLite dependency.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { buildMemorySearchStore, compareMemorySearchStore, ingestMemoryPack, recallMemory } from "../memory"

function freshStore(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `axmem-search-${label}-`))
}

function searchManifestPath(cwd: string): string {
    return path.join(cwd, ".axmem", "memory", "search", "manifest.axsearch.json")
}

function indexPath(cwd: string): string {
    return path.join(cwd, ".axmem", "memory", "index.axmem.json")
}

function seed(cwd: string): void {
    ingestMemoryPack({
        cwd,
        taskId: "alpha-search",
        title: "Alpha search card",
        tags: ["alpha", "search", "runtime"],
        document: {
            summary: "Alpha runtime search store card",
            decisions: ["Alpha should be found through postings"]
        }
    })
    ingestMemoryPack({
        cwd,
        taskId: "beta-search",
        title: "Beta search card",
        tags: ["beta", "search", "cache"],
        document: {
            summary: "Beta cache search store card",
            decisions: ["Beta should be found through postings"]
        }
    })
}

test("AXMEM B4 — search store build supports dual-read compare", () => {
    const tmp = freshStore("dual")
    seed(tmp)
    const built = buildMemorySearchStore({ cwd: tmp, reason: "manual" })
    assert.equal(built.source_entry_count, 2)
    assert.equal(built.document_count, 2)
    assert.equal(built.token_count > 0, true)
    const manifest = JSON.parse(fs.readFileSync(searchManifestPath(tmp), "utf8")) as {
        document_layout?: string
        document_shard_files?: Record<string, string>
    }
    assert.equal(manifest.document_layout, "sharded")
    assert.equal(Object.keys(manifest.document_shard_files ?? {}).length > 0, true)

    const compared = compareMemorySearchStore({
        cwd: tmp,
        cases: [
            { id: "alpha", query: "alpha runtime postings" },
            { id: "beta", query: "beta cache postings" },
            { id: "top-k", query: "search postings", limit: 2 },
            { id: "task", taskId: "alpha-search" }
        ]
    })
    assert.equal(compared.status, "ok", JSON.stringify(compared.cases, null, 2))
    assert.equal(compared.cases.every((item) => item.comparison_status === "matched" && item.search_exercised), true)
    const topK = compared.cases.find((item) => item.id === "top-k")
    assert.ok(topK)
    assert.equal(topK.json_task_ids.length, 2)
    assert.deepEqual(topK.search_task_ids, topK.json_task_ids)
})

test("AXMEM B4 — compare does not treat missing search-store recall as agreement", () => {
    const tmp = freshStore("compare-missing")
    seed(tmp)
    fs.rmSync(path.join(tmp, ".axmem", "memory", "search"), { recursive: true, force: true })

    const compared = compareMemorySearchStore({
        cwd: tmp,
        cases: [
            { id: "alpha", query: "alpha runtime postings" }
        ]
    })

    assert.equal(compared.status, "failed")
    assert.equal(compared.cases[0].comparison_status, "not_compared")
    assert.equal(compared.cases[0].search_exercised, false)
    assert.deepEqual(compared.cases[0].search_task_ids, [])
})

test("AXMEM B4 — recall can use search store docs without reparsing the JSON index", () => {
    const tmp = freshStore("no-json")
    seed(tmp)
    buildMemorySearchStore({ cwd: tmp, reason: "manual" })
    fs.writeFileSync(indexPath(tmp), "{ broken json", "utf8")

    const recalled = recallMemory({ cwd: tmp, query: "beta cache postings", profile: "ultra" })
    assert.equal(recalled.results[0]?.task_id, "beta-search")

    withAxmemMutation("ignore_search_document_shards", () => {
        const mutated = recallMemory({ cwd: tmp, query: "beta cache postings", profile: "ultra" })
        assert.notEqual(mutated.results[0]?.task_id, "beta-search")
    })
})

test("AXMEM B4 — corrupt postings trigger recovery from the JSON index", () => {
    const tmp = freshStore("recover")
    seed(tmp)
    buildMemorySearchStore({ cwd: tmp, reason: "manual" })
    const manifest = JSON.parse(fs.readFileSync(searchManifestPath(tmp), "utf8")) as {
        token_files: Record<string, string>
    }
    const alphaPosting = manifest.token_files.alpha
    assert.ok(alphaPosting)
    fs.writeFileSync(path.join(tmp, alphaPosting), "{ corrupt", "utf8")

    const recalled = recallMemory({ cwd: tmp, query: "alpha runtime postings", profile: "ultra" })
    assert.equal(recalled.results[0]?.task_id, "alpha-search")
    const recovered = JSON.parse(fs.readFileSync(searchManifestPath(tmp), "utf8")) as {
        corruption_recovery_count: number
    }
    assert.equal(recovered.corruption_recovery_count > 0, true)
})

test("AXMEM B4 — ingest after build updates one document through search-store upsert", () => {
    const tmp = freshStore("upsert")
    seed(tmp)
    buildMemorySearchStore({ cwd: tmp, reason: "manual" })
    ingestMemoryPack({
        cwd: tmp,
        taskId: "gamma-search",
        title: "Gamma search card",
        tags: ["gamma", "search", "incremental"],
        document: {
            summary: "Gamma arrives after the search store already exists"
        }
    })

    const recalled = recallMemory({ cwd: tmp, query: "gamma incremental", profile: "ultra" })
    assert.equal(recalled.results[0]?.task_id, "gamma-search")
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
