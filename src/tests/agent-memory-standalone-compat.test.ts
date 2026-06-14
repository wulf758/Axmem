import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { spawnSync } from "node:child_process"
import { ingestMemoryPack, recallMemory, setAxmemStorageLayout } from "../memory"

function freshStore(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `axmem-standalone-${label}-`))
}

test("standalone layout writes .axmem by default", () => {
    const tmp = freshStore("layout")
    setAxmemStorageLayout("standalone", tmp)
    ingestMemoryPack({
        cwd: tmp,
        taskId: "standalone-card",
        title: "Standalone card",
        tags: ["standalone"],
        document: { summary: "Standalone AXMEM uses .axmem/memory by default." }
    })
    assert.equal(fs.existsSync(path.join(tmp, ".axmem", "memory", "standalone-card.axmem")), true)
    assert.equal(fs.existsSync(path.join(tmp, ".axiom", "memory", "standalone-card.axmem")), false)
    assert.equal(recallMemory({ cwd: tmp, query: "standalone default", profile: "ultra" }).results[0]?.task_id, "standalone-card")
})

test("legacy axiom layout remains readable when selected", () => {
    const tmp = freshStore("axiom-layout")
    setAxmemStorageLayout("axiom", tmp)
    ingestMemoryPack({
        cwd: tmp,
        taskId: "legacy-card",
        title: "Legacy layout card",
        tags: ["legacy"],
        document: { summary: "Legacy Axiom layout remains compatible." }
    })
    assert.equal(fs.existsSync(path.join(tmp, ".axiom", "memory", "legacy-card.axmem")), true)
    assert.equal(recallMemory({ cwd: tmp, query: "legacy compatible", profile: "ultra" }).results[0]?.task_id, "legacy-card")
    setAxmemStorageLayout("standalone", tmp)
})

test("CLI migration copies .axiom/memory to .axmem/memory", () => {
    const tmp = freshStore("migrate")
    setAxmemStorageLayout("axiom", tmp)
    ingestMemoryPack({
        cwd: tmp,
        taskId: "migrated-card",
        title: "Migrated card",
        tags: ["migration"],
        document: { summary: "Migration should copy this legacy card." }
    })
    const cli = path.resolve(__dirname, "..", "cli.js")
    const migrated = spawnSync(process.execPath, [cli, "migrate", "--from-axiom", "--json"], { cwd: tmp, encoding: "utf8", windowsHide: true })
    assert.equal(migrated.status, 0, migrated.stderr)
    const parsed = JSON.parse(migrated.stdout)
    assert.equal(parsed.status, "ok")
    assert.equal(fs.existsSync(path.join(tmp, ".axmem", "memory", "migrated-card.axmem")), true)
    const recalled = spawnSync(process.execPath, [cli, "recall", "--query", "migration legacy", "--json"], { cwd: tmp, encoding: "utf8", windowsHide: true })
    assert.equal(recalled.status, 0, recalled.stderr)
    assert.equal(JSON.parse(recalled.stdout).results[0]?.task_id, "migrated-card")
    setAxmemStorageLayout("standalone", tmp)
})

test("CLI accepts axmem memory alias", () => {
    const tmp = freshStore("alias")
    const cli = path.resolve(__dirname, "..", "cli.js")
    const ingested = spawnSync(process.execPath, [cli, "memory", "ingest", "--quick", "--summary", "Alias card is visible", "--task", "alias-card", "--json"], { cwd: tmp, encoding: "utf8", windowsHide: true })
    assert.equal(ingested.status, 0, ingested.stderr)
    const recalled = spawnSync(process.execPath, [cli, "memory", "recall", "--query", "alias visible", "--json"], { cwd: tmp, encoding: "utf8", windowsHide: true })
    assert.equal(recalled.status, 0, recalled.stderr)
    assert.equal(JSON.parse(recalled.stdout).results[0]?.task_id, "alias-card")
})
