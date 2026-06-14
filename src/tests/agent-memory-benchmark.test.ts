// AXMEM recall benchmark and pack-budget guards.
//
// The benchmark corpus is synthetic public AXMEM-style cards across axiom,
// forgekit-2, forgekit-3, and cityruntime, with a few synthetic guard cards
// for specific ranking mutations.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as zlib from "node:zlib"
import {
    attachMemoryProject,
    ingestMemoryPack,
    readMemoryIndex,
    readGlobalMemoryRegistry,
    recallGlobalMemory,
    recallMemory,
    reindexMemory,
    unpackMemoryPack,
    type AgentMemoryPack
} from "../memory"
import {
    assertAxmemBenchmarkGate,
    AXMEM_BENCHMARK_CASES,
    AXMEM_BENCHMARK_CORPUS_VERSION,
    evaluateAxmemBenchmark,
    seedAxmemBenchmarkStore
} from "./agent-memory-benchmark-fixture"

function freshStore(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `axmem-benchmark-${label}-`))
}

test("AXMEM Phase 0 — index and pack budgets bound evidence and ultra hints", () => {
    const tmp = freshStore("budget")
    ingestMemoryPack({
        cwd: tmp,
        taskId: "budget-card",
        title: "Budget card",
        tags: ["budget", "evidence"],
        document: {
            summary: "Budget evidence card",
            evidence: Array.from({ length: 140 }, (_, index) => ({
                kind: index % 2 === 0 ? "patch_checkpoint" : "agent_note",
                summary: `Evidence ${index}`,
                data: {
                    index,
                    payload: "x".repeat(30_000)
                }
            }))
        }
    })

    const recalled = recallMemory({ cwd: tmp, taskId: "budget-card", profile: "full", includeEvidence: true })
    assert.equal(recalled.results.length, 1)
    const item = recalled.results[0]
    assert.ok(item.full_evidence)
    assert.equal(item.full_evidence.length <= 80, true)
    assert.equal(item.full_evidence.some((evidence) => JSON.stringify(evidence.data).includes("agent_memory_truncated_evidence")), true)

    const index = readMemoryIndex(tmp)
    const entry = index.entries.find((candidate) => candidate.task_id === "budget-card")
    assert.ok(entry)
    assert.equal(entry.score_hints.length <= 160, true)
    assert.equal((entry.decision_hints?.length ?? 0) <= 8, true)
    assert.equal((entry.command_hints?.length ?? 0) <= 8, true)
    assert.equal((entry.evidence_refs?.length ?? 0) <= 12, true)
    assert.equal((entry.anchor_refs?.length ?? 0) <= 12, true)
    assert.equal(entry.score_hints.some((hint) => hint.includes("Evidence 138")), false)
})

test("AXMEM friction — score explanation and freshness are visible without changing default recall", () => {
    const tmp = freshStore("explain-freshness")
    const memoryDir = path.join(tmp, ".axmem", "memory")
    fs.mkdirSync(memoryDir, { recursive: true })
    fs.writeFileSync(path.join(memoryDir, "old-release-notes.axmem"), encodeRawAxmemPack(minimalPack({
        task: {
            id: "old-release-notes",
            title: "Release notes archive",
            tags: ["release", "notes"],
            created_at: "2025-01-01T00:00:00.000Z",
            updated_at: "2025-01-01T00:00:00.000Z"
        },
        summary: { recent_message: "Old release notes archive" },
        evidence: [{ id: "source:old", kind: "agent_note", summary: "old note", data: { source_scope: "archived note" } }]
    })))
    ingestMemoryPack({
        cwd: tmp,
        taskId: "fresh-release-notes",
        title: "Fresh release notes",
        tags: ["release", "notes"],
        document: { summary: "Current release notes" }
    })
    reindexMemory({ cwd: tmp, reason: "manual" })

    const old = recallMemory({ cwd: tmp, taskId: "old-release-notes", profile: "ultra" }).results[0]
    assert.equal(old.freshness, "old")
    assert.equal(old.source_scope, "archived note")
    assert.equal(typeof old.age_days, "number")

    const explained = recallMemory({ cwd: tmp, query: "latest release notes", profile: "ultra", limit: 2, explainScore: true })
    assert.equal(explained.results[0].task_id, "fresh-release-notes")
    assert.equal(explained.results[0].score_explanation?.total, explained.results[0].score)
    assert.equal(explained.results[0].score_explanation?.components.some((item) => item.name === "title_task_id"), true)
    assert.equal(explained.results[0].score_explanation?.components.some((item) => item.name === "freshness"), true)
})

test("AXMEM friction — long summaries do not pollute score_hints but semantic refs remain findable", () => {
    const tmp = freshStore("hint-hygiene")
    const longSummary = `This sentence should not be copied wholesale into score hints. ${"summary filler ".repeat(200)} rare semantic implementation detail.`
    ingestMemoryPack({
        cwd: tmp,
        taskId: "hint-hygiene-card",
        title: "Hint hygiene card",
        tags: ["rareanchor"],
        document: {
            summary: longSummary,
            semantic_refs: [{ kind: "file", name: "src/core.ts" }]
        }
    })

    const entry = readMemoryIndex(tmp).entries.find((item) => item.task_id === "hint-hygiene-card")
    assert.ok(entry)
    assert.equal(entry.score_hints.some((hint) => hint.includes("This sentence should not be copied wholesale")), false)
    assert.equal(entry.summary_preview?.recent_message?.includes("This sentence should not be copied wholesale"), true)

    const recalled = recallMemory({ cwd: tmp, query: "rareanchor src core", profile: "ultra", limit: 1 })
    assert.equal(recalled.results[0]?.task_id, "hint-hygiene-card")
})

test("AXMEM friction — attached global project refreshes after local ingest", () => {
    const tmp = freshStore("global-refresh")
    const memoryHome = freshStore("global-home")
    const previousHome = process.env.AXMEM_MEMORY_HOME
    process.env.AXMEM_MEMORY_HOME = memoryHome
    try {
        ingestMemoryPack({
            cwd: tmp,
            taskId: "bootstrap-card",
            title: "Bootstrap card",
            tags: ["bootstrap"],
            document: { summary: "Initial attached project card" }
        })
        attachMemoryProject({ memoryHome, workspacePath: tmp, projectId: "auto-refresh", title: "Auto Refresh" })
        ingestMemoryPack({
            cwd: tmp,
            taskId: "fresh-global-card",
            title: "Fresh global auto refresh card",
            tags: ["global", "refresh"],
            document: { summary: "New card should be visible through global recall without manual re-attach." }
        })

        const registryProject = readGlobalMemoryRegistry(memoryHome).projects.find((project) => project.project_id === "auto-refresh")
        assert.equal(registryProject?.task_count, 2)
        const recalled = recallGlobalMemory({ memoryHome, query: "fresh global auto refresh", profile: "ultra", limit: 1 })
        assert.equal(recalled.results[0]?.task_id, "fresh-global-card")
    } finally {
        if (previousHome === undefined) delete process.env.AXMEM_MEMORY_HOME
        else process.env.AXMEM_MEMORY_HOME = previousHome
    }
})

test("AXMEM friction — file-anchored recall prefers cards that own the file ref", () => {
    const tmp = freshStore("file-recall")
    ingestMemoryPack({
        cwd: tmp,
        taskId: "sfz-skin-owner",
        title: "Sfz skin runtime notes",
        tags: ["forgekit"],
        document: {
            summary: "What to know before editing the skin runtime.",
            semantic_refs: [{ kind: "file", name: "crates/sfz_core/skin.rs" }]
        }
    })
    ingestMemoryPack({
        cwd: tmp,
        taskId: "incidental-skin-note",
        title: "Renderer note mentioning skin",
        tags: ["renderer"],
        document: {
            summary: "This card mentions skin rendering but owns no file reference."
        }
    })

    const recalled = recallMemory({
        cwd: tmp,
        file: "crates/sfz_core/skin.rs",
        query: "what should I know before editing",
        profile: "ultra",
        limit: 2,
        explainScore: true
    })
    assert.equal(recalled.results[0]?.task_id, "sfz-skin-owner")
    assert.equal(recalled.results[0]?.score_explanation?.components.some((component) => component.name === "file_ref"), true)
})

test("AXMEM Phase 0 — unpack rejects packs that exceed the stored-pack budget", () => {
    const oversized = minimalPack({
        evidence: [{
            id: "oversized:evidence",
            kind: "agent_note",
            summary: "Oversized payload should fail validation on unpack",
            data: "x".repeat(600_000)
        }]
    })

    assert.throws(
        () => unpackMemoryPack(encodeRawAxmemPack(oversized)),
        /pack JSON size .* exceeds budget/
    )
})

test("AXMEM Phase 0 — reindex repairs legacy packs that exceed current budgets", () => {
    const tmp = freshStore("legacy-repair")
    const memoryDir = path.join(tmp, ".axmem", "memory")
    fs.mkdirSync(memoryDir, { recursive: true })
    const legacy = minimalPack({
        task: {
            id: "legacy-overbudget-card",
            title: "Legacy overbudget card",
            tags: ["legacy", "budget"],
            created_at: "2026-06-08T00:00:00.000Z",
            updated_at: "2026-06-08T00:00:00.000Z"
        },
        evidence: Array.from({ length: 120 }, (_, index) => ({
            id: `legacy:evidence:${index}`,
            kind: "agent_note",
            summary: `Legacy evidence ${index}`,
            data: { index }
        }))
    })
    const packPath = path.join(memoryDir, "legacy-overbudget-card.axmem")
    fs.writeFileSync(packPath, encodeRawAxmemPack(legacy))

    const result = reindexMemory({ cwd: tmp, reason: "manual" })
    assert.equal(result.entry_count, 1)
    assert.equal(result.entries[0].task_id, "legacy-overbudget-card")

    const repaired = unpackMemoryPack(fs.readFileSync(packPath))
    assert.equal(repaired.evidence.length <= 80, true)
    assert.equal(repaired.evidence.some((item) => item.id === "legacy:evidence:119"), true)

    const entry = readMemoryIndex(tmp).entries[0]
    assert.equal(entry.task_id, "legacy-overbudget-card")
    assert.equal(entry.evidence_count <= 80, true)
})

test("AXMEM Phase 0/A3 — synthetic-memory benchmark reports quality without assuming perfect metrics", () => {
    const tmp = freshStore("quality")
    seedAxmemBenchmarkStore(tmp)

    const report = evaluateAxmemBenchmark(tmp)

    assert.equal(report.corpus_version, AXMEM_BENCHMARK_CORPUS_VERSION)
    assert.equal(report.case_count, AXMEM_BENCHMARK_CASES.length)
    assert.equal(report.positive_case_count >= 17, true)
    assert.equal(report.no_strong_match_case_count, 4)
    assertAxmemBenchmarkGate(report)
})

function minimalPack(overrides: Partial<AgentMemoryPack>): AgentMemoryPack {
    const now = new Date("2026-06-08T00:00:00.000Z").toISOString()
    return {
        schema: "axiom.agent_memory_pack.v0",
        version: 1,
        task: {
            id: "oversized-budget-card",
            title: "Oversized budget card",
            tags: ["budget"],
            created_at: now,
            updated_at: now
        },
        summary: {
            recent_message: "Pack budget test"
        },
        semantic_refs: [],
        decisions: [],
        commands: [],
        next_actions: [],
        invalidated_hypotheses: [],
        evidence: [],
        ...overrides
    }
}

function encodeRawAxmemPack(pack: AgentMemoryPack): Buffer {
    const json = Buffer.from(JSON.stringify(pack), "utf8")
    const payload = zlib.deflateSync(json, { level: zlib.constants.Z_BEST_COMPRESSION })
    const out = Buffer.alloc(32 + payload.length)
    Buffer.from([0x41, 0x58, 0x4d, 0x45, 0x4d, 0x00, 0x00, 0x00]).copy(out, 0)
    out.writeUInt16LE(1, 8)
    out.writeUInt16LE(1, 10)
    out.writeUInt32LE(0, 12)
    out.writeBigUInt64LE(BigInt(json.length), 16)
    out.writeBigUInt64LE(BigInt(payload.length), 24)
    payload.copy(out, 32)
    return out
}
