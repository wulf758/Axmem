// AXMEM soundness — Family 1: the hard, deductive guarantees.
//
// Unlike recall *quality* (Family 2, statistical), these are properties that
// must hold exactly, every time, and are testable as invariants:
//   1. round-trip fidelity      — ingest -> recall returns what was stored
//   2. determinism              — same store + query -> identical result
//   3. trust / provenance       — an invalidated hypothesis is never surfaced
//                                 as current truth (no boost, never promoted)
//   4. metric honesty           — recall_chars equals the emitted card bytes
//
// The memory store is isolated per test in an os.tmpdir() workspace, so these
// never touch the real ~/.axmem registry.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ingestMemoryPack, readMemoryIndex, recallMemory, renderRecallCardChars } from "../memory"

function freshStore(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `axmem-soundness-${label}-`))
}

test("AXMEM Family 1 — round-trip: ingest then recall preserves load-bearing fields", () => {
    const tmp = freshStore("roundtrip")
    ingestMemoryPack({
        cwd: tmp,
        taskId: "rt-card",
        title: "Round trip card",
        tags: ["claude"],
        document: {
            summary: {
                goal: "Verify round-trip fidelity of the memory store",
                last_completed_step: "Ingested a known card",
                next_recommended_step: "Recall it and compare every load-bearing field"
            },
            decisions: ["Round-trip fidelity is the foundational memory invariant"],
            commands: ["node dist/cli.js memory recall --task rt-card"],
            next_actions: ["Assert the recalled card matches what was stored"],
            semantic_refs: [{ kind: "file", name: "compiler/src/agent/memory.ts" }]
        }
    })

    // Recall by task id (deterministic single hit) and read the pack-faithful
    // content via the full profile.
    const result = recallMemory({ cwd: tmp, taskId: "rt-card", profile: "full" })
    assert.equal(result.results.length, 1)
    const item = result.results[0]

    assert.equal(item.task_id, "rt-card")
    assert.equal(item.summary.goal, "Verify round-trip fidelity of the memory store")
    assert.equal(item.summary.last_completed_step, "Ingested a known card")
    assert.equal(item.summary.next_recommended_step, "Recall it and compare every load-bearing field")
    assert.equal(item.decisions.some((d) => d.summary.includes("foundational memory invariant")), true)
    assert.equal(item.commands.some((c) => c.command.includes("recall --task rt-card")), true)
    assert.equal(item.next_actions.some((n) => n.includes("matches what was stored")), true)
    assert.equal(item.semantic_refs.some((r) => r.kind === "file" && r.name === "compiler/src/agent/memory.ts"), true)
})

test("AXMEM Family 1 — determinism: same store and query yields an identical result", () => {
    const tmp = freshStore("determinism")
    for (const n of [1, 2, 3]) {
        ingestMemoryPack({
            cwd: tmp,
            taskId: `det-${n}`,
            title: `Runtime profile card ${n}`,
            tags: ["runtime", "profile"],
            document: {
                summary: `runtime profile card number ${n}`,
                decisions: [`runtime profile decision ${n}`]
            }
        })
    }

    const a = recallMemory({ cwd: tmp, query: "runtime profile card", profile: "full" })
    const b = recallMemory({ cwd: tmp, query: "runtime profile card", profile: "full" })

    assert.equal(a.results.length > 0, true)
    assert.deepEqual(a.results.map((r) => r.task_id), b.results.map((r) => r.task_id))
    // Full structural determinism: recall must not depend on hidden state/time.
    assert.deepEqual(a, b)
})

test("AXMEM Family 1 — trust: an invalidated hypothesis is never surfaced as current truth", () => {
    const tmp = freshStore("trust")
    const debunked = "Refund can exceed the captured payment amount"
    ingestMemoryPack({
        cwd: tmp,
        taskId: "trust-card",
        title: "Refund trust card",
        tags: ["refund", "trust", "accounting"],
        document: {
            summary: { goal: "Refund accounting keeps trust tiers honest" },
            invalidated_hypotheses: [{
                hypothesis: debunked,
                reason: "A conservation invariant forbids refunding more than was captured",
                next_better_hypothesis: "A refund is bounded by the captured amount",
                invalidated_by: ["claude_agent"]
            }]
        }
    })

    const query = "refund captured amount trust accounting"

    // Current mode: the card may surface (it has real tags), but the debunked
    // belief must never be boosted or promoted to a fact.
    const current = recallMemory({ cwd: tmp, query, mode: "current", profile: "full" })
    assert.equal(current.results.length > 0, true)
    for (const item of current.results) {
        assert.equal(item.invalidated_score_boost, 0) // hard invariant: no boost in current mode
        assert.notEqual(item.summary.goal, debunked) // never promoted to the goal
        assert.equal(item.decisions.some((d) => d.summary.includes("Refund can exceed")), false)
    }
    const trustItem = current.results.find((r) => r.task_id === "trust-card")
    assert.ok(trustItem)
    // The belief is preserved — but confined to the invalidated_hypotheses field.
    assert.equal(trustItem.invalidated_hypotheses.some((h) => h.hypothesis === debunked), true)

    // History mode: the same belief is intentionally surfaced, with a boost,
    // as "here is what we learned was wrong".
    const history = recallMemory({ cwd: tmp, query, mode: "history", profile: "full" })
    const histItem = history.results.find((r) => r.task_id === "trust-card")
    assert.ok(histItem)
    assert.equal(histItem.invalidated_score_boost > 0, true)
})

test("AXMEM Family 1 — metric honesty: recall_chars equals the emitted card bytes", () => {
    const tmp = freshStore("metric")
    ingestMemoryPack({
        cwd: tmp,
        taskId: "metric-card",
        title: "Metric honesty card",
        tags: ["metric", "honesty"],
        document: {
            summary: {
                goal: "The reported recall size must equal what the agent actually reads",
                last_completed_step: "Fixed recall_chars to measure the rendered card",
                next_recommended_step: "Guard it with this test"
            },
            decisions: ["recall_chars is the rendered card length, not jsonCharLength(item)", "savings must be honest"],
            commands: ["node dist/cli.js memory recall --query metric honesty"],
            next_actions: ["Keep this gate in CI"],
            semantic_refs: [{ kind: "file", name: "a.ts" }, { kind: "command", name: "memory recall" }]
        }
    })

    // Cover both metric paths: ultra recalls from the index, full reads the pack.
    for (const profile of ["ultra", "full"] as const) {
        const result = recallMemory({ cwd: tmp, query: "metric honesty card", profile })
        assert.equal(result.results.length > 0, true)
        for (const item of result.results) {
            assert.equal(item.metrics.recall_chars, renderRecallCardChars(item))
        }
    }
})

test("AXMEM Family 1 — ultra recall stores bounded index previews and uses pack-size metrics", () => {
    const tmp = freshStore("preview")
    const hugeSummary = "ultra preview budget ".repeat(500)
    const hugeDecision = "decision preview budget ".repeat(500)
    const hugeCommand = "node -e ".repeat(800)
    const hugeAction = "next action preview budget ".repeat(500)
    ingestMemoryPack({
        cwd: tmp,
        taskId: "bounded-preview-card",
        title: "Bounded preview card",
        tags: ["preview", "metric"],
        document: {
            summary: {
                goal: "Bound ultra recall previews",
                recent_message: hugeSummary
            },
            decisions: [hugeDecision],
            commands: [hugeCommand],
            next_actions: [hugeAction],
            evidence: [{
                kind: "agent_note",
                summary: "Tiny evidence so pack-size metrics differ from evidence-only metrics",
                data: "small"
            }]
        }
    })

    const entry = readMemoryIndex(tmp).entries.find((item) => item.task_id === "bounded-preview-card")
    assert.ok(entry)
    assert.equal((entry.summary_preview?.recent_message?.length ?? 0) <= 800, true)
    assert.equal((entry.decision_hints?.[0]?.summary.length ?? 0) <= 600, true)
    assert.equal((entry.command_hints?.[0]?.command.length ?? 0) <= 600, true)
    assert.equal((entry.next_action_hints?.[0]?.length ?? 0) <= 600, true)

    const ultra = recallMemory({ cwd: tmp, taskId: "bounded-preview-card", profile: "ultra" })
    const item = ultra.results[0]
    assert.equal(item.summary.recent_message, entry.summary_preview?.recent_message)
    assert.notEqual(item.summary.recent_message, hugeSummary)
    assert.equal(item.metrics.raw_evidence_chars, entry.pack_json_chars)
    assert.equal(item.metrics.raw_evidence_chars > (entry.raw_evidence_chars ?? 0), true)
    assert.equal(item.metrics.recall_chars < 8_000, true)
    assert.equal(item.metrics.estimated_context_tokens_saved > 0, true)
})

test("AXMEM Family 1 — hydrated recall returns newest decisions, commands, actions, and refs first", () => {
    const tmp = freshStore("latest")
    ingestMemoryPack({
        cwd: tmp,
        taskId: "latest-card",
        title: "Latest card",
        tags: ["latest"],
        document: {
            summary: "Newest items must be visible in hydrated recall",
            decisions: Array.from({ length: 12 }, (_, index) => `decision-${index}`),
            commands: Array.from({ length: 12 }, (_, index) => `cmd-${index}`),
            next_actions: Array.from({ length: 12 }, (_, index) => `action-${index}`),
            evidence: Array.from({ length: 12 }, (_, index) => ({
                id: `evidence-${index}`,
                kind: "agent_note",
                summary: `evidence-${index}`,
                data: { index }
            }))
        }
    })

    for (const profile of ["focused", "full"] as const) {
        const recalled = recallMemory({ cwd: tmp, taskId: "latest-card", profile })
        const item = recalled.results[0]
        assert.equal(item.decisions[0].summary, "decision-11")
        assert.equal(item.commands[0].command, "cmd-11")
        assert.equal(item.next_actions[0], "action-11")
        assert.equal(item.evidence_refs[0].id, "evidence-11")
    }
})
