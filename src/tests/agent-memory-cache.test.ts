// AXMEM cache coherence — Phase 1.
//
// Caches are allowed to skip parse/inflate work, but they must never serve stale
// memory. These tests cover same-process writes, external index rewrites with
// unchanged mtime, and external pack rewrites after focused recall hydration.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ingestMemoryPack, packMemoryPack, readMemoryIndex, recallMemory, unpackMemoryPack } from "../memory"

function freshStore(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `axmem-cache-${label}-`))
}

function indexPath(cwd: string): string {
    return path.join(cwd, ".axmem", "memory", "index.axmem.json")
}

function packPath(cwd: string, taskId: string): string {
    return path.join(cwd, ".axmem", "memory", `${taskId}.axmem`)
}

test("AXMEM Phase 1 — index cache sees external rewrites even with restored mtime", () => {
    const tmp = freshStore("index-external")
    ingestMemoryPack({
        cwd: tmp,
        taskId: "cache-index",
        title: "Cache index oldtoken",
        tags: ["oldtoken"],
        document: {
            summary: "oldtoken should be replaced by newtoken in the index"
        }
    })

    assert.equal(readMemoryIndex(tmp).entries.some((entry) => entry.score_hints.includes("oldtoken")), true)
    const filePath = indexPath(tmp)
    const stat = fs.statSync(filePath)
    const raw = fs.readFileSync(filePath, "utf8")
    const rewritten = raw.replaceAll("oldtoken", "newtoken")
    assert.equal(raw.length, rewritten.length)
    fs.writeFileSync(filePath, rewritten, "utf8")
    fs.utimesSync(filePath, stat.atime, stat.mtime)

    const recalled = recallMemory({ cwd: tmp, query: "newtoken", profile: "ultra" })
    assert.equal(recalled.results[0]?.task_id, "cache-index")
    assert.equal(readMemoryIndex(tmp).entries.some((entry) => entry.score_hints.includes("newtoken")), true)
})

test("AXMEM Phase 1 — index cache sees same-process writes immediately", () => {
    const tmp = freshStore("index-own-write")
    ingestMemoryPack({
        cwd: tmp,
        taskId: "first-card",
        title: "First card",
        tags: ["first"],
        document: { summary: "First card populates the index cache" }
    })
    readMemoryIndex(tmp)

    ingestMemoryPack({
        cwd: tmp,
        taskId: "second-card",
        title: "Second card",
        tags: ["second"],
        document: { summary: "Second card must be visible after the write" }
    })

    const recalled = recallMemory({ cwd: tmp, query: "second", profile: "ultra" })
    assert.equal(recalled.results[0]?.task_id, "second-card")
})

test("AXMEM Phase 1 — focused recall pack cache invalidates on external pack rewrite", () => {
    const tmp = freshStore("pack-external")
    ingestMemoryPack({
        cwd: tmp,
        taskId: "pack-card",
        title: "Pack card",
        tags: ["pack"],
        document: {
            summary: {
                goal: "old pack truth"
            }
        }
    })

    const before = recallMemory({ cwd: tmp, taskId: "pack-card", profile: "focused" })
    assert.equal(before.results[0]?.summary.goal, "old pack truth")

    const filePath = packPath(tmp, "pack-card")
    const stat = fs.statSync(filePath)
    const pack = unpackMemoryPack(fs.readFileSync(filePath))
    pack.summary.goal = "new pack truth"
    fs.writeFileSync(filePath, packMemoryPack(pack))
    fs.utimesSync(filePath, stat.atime, stat.mtime)

    const after = recallMemory({ cwd: tmp, taskId: "pack-card", profile: "focused" })
    assert.equal(after.results[0]?.summary.goal, "new pack truth")
})
