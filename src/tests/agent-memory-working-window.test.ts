// AXMEM L5 — flush + recall working-window manager.
//
// This pins the task card, keeps a bounded recent buffer, leaves breadcrumbs for
// flushed state, supports the explicit axmem_recall reflex, and proves pending
// state is written before a flush can evict hot tier data.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
    buildMemorySearchStore,
    buildMemoryWorkingWindow,
    clearMemoryTierCaches,
    flushMemoryWorkingWindow,
    ingestMemoryPack,
    runAxmemRecallTool,
    type MemoryEvidence
} from "../memory"

function freshStore(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `axmem-window-${label}-`))
}

function seedTaskCards(cwd: string): void {
    ingestMemoryPack({
        cwd,
        taskId: "task-thread",
        title: "Task thread fil conducteur",
        tags: ["thread", "working-window"],
        document: {
            summary: "Pinned task card for the working-window manager."
        }
    })
    ingestMemoryPack({
        cwd,
        taskId: "active-switchboard",
        title: "Active runtime switchboard card",
        tags: ["active", "switchboard", "window"],
        document: {
            summary: "Active card that automatic paging should recall.",
            semantic_refs: [{ kind: "module", name: "compiler/src/agent/memory.ts" }]
        }
    })
    ingestMemoryPack({
        cwd,
        taskId: "neighbor-switchboard",
        title: "Neighbor runtime switchboard card",
        tags: ["active", "switchboard", "window"],
        document: {
            summary: "Likely next card warmed by predictive prefetch.",
            semantic_refs: [{ kind: "module", name: "compiler/src/agent/memory.ts" }]
        }
    })
    buildMemorySearchStore({ cwd, reason: "manual" })
}

test("AXMEM L5 — working window is bounded, pinned, breadcrumbed, and prefetches", () => {
    const tmp = freshStore("bounded")
    seedTaskCards(tmp)
    for (let i = 0; i < 8; i++) {
        flushMemoryWorkingWindow({
            cwd: tmp,
            sessionId: "l5-session",
            pendingEvents: [{
                kind: "assistant_update",
                summary: `Completed step ${i}`,
                text: `Completed step ${i}; exact sentinel WINDOW-STEP-${i}`,
                role: "assistant"
            }],
            maxPackCacheBytes: 0
        })
    }

    clearMemoryTierCaches()
    const window = buildMemoryWorkingWindow({
        cwd: tmp,
        sessionId: "l5-session",
        taskId: "task-thread",
        query: "active runtime switchboard",
        systemPrompt: "You are running inside an AXMEM working window.",
        tokenBudget: 2500,
        recentEventLimit: 3,
        activeCardLimit: 1,
        prefetch: true
    })

    assert.equal(window.schema, "axiom.agent_memory_working_window.v0")
    assert.equal(window.estimated_tokens <= window.token_budget, true)
    assert.equal(window.pinned_card?.task_id, "task-thread")
    assert.equal(window.active_cards[0]?.task_id, "active-switchboard")
    assert.equal(window.recent_events.length <= 3, true)
    assert.equal(window.recent_events.some((event) => event.full_evidence?.some((evidence) => evidenceText(evidence).includes("WINDOW-STEP-7"))), true)
    assert.equal(window.breadcrumbs.some((breadcrumb) => breadcrumb.id.includes("e000001")), true)
    assert.equal(window.tools[0]?.name, "axmem_recall")
    assert.equal(window.prefetch?.prefetched_task_ids.includes("neighbor-switchboard"), true)
})

test("AXMEM L5 — flush writes pending state before eviction, and axmem_recall restores it", () => {
    const tmp = freshStore("no-amnesia")
    seedTaskCards(tmp)
    clearMemoryTierCaches()
    const flushed = flushMemoryWorkingWindow({
        cwd: tmp,
        sessionId: "l5-no-amnesia",
        pendingEvents: [{
            kind: "decision",
            summary: "Remember the durable window sentinel",
            text: "Durable state after flush: L5-NO-AMNESIA-SENTINEL",
            tags: ["l5", "sentinel"],
            role: "assistant"
        }],
        query: "active runtime switchboard",
        maxPackCacheBytes: 0,
        tokenBudget: 1800
    })
    assert.equal(flushed.appended_events.length, 1)
    assert.equal(flushed.eviction.status, "ok")

    const recalled = runAxmemRecallTool({
        cwd: tmp,
        source: "session",
        sessionId: "l5-no-amnesia",
        query: "L5-NO-AMNESIA-SENTINEL",
        profile: "full",
        includeEvidence: true
    })
    assert.equal(recalled.session?.results[0]?.event_id, flushed.appended_events[0].event_id)
    assert.equal(recalled.session?.results[0]?.full_evidence?.some((evidence) => evidenceText(evidence).includes("L5-NO-AMNESIA-SENTINEL")), true)

    withAxmemMutation("drop_write_before_flush", () => {
        const mutant = freshStore("mutant")
        seedTaskCards(mutant)
        const mutated = flushMemoryWorkingWindow({
            cwd: mutant,
            sessionId: "l5-mutant",
            pendingEvents: [{
                kind: "decision",
                summary: "This should be lost under the mutation",
                text: "L5-MUTANT-LOST-SENTINEL"
            }],
            maxPackCacheBytes: 0
        })
        assert.equal(mutated.appended_events.length, 0)
        const missing = runAxmemRecallTool({
            cwd: mutant,
            source: "session",
            sessionId: "l5-mutant",
            query: "L5-MUTANT-LOST-SENTINEL",
            profile: "full",
            includeEvidence: true
        })
        assert.equal(missing.session?.results.length ?? 0, 0)
    })
})

test("AXMEM L5 — explicit axmem_recall can page session and task memory on demand", () => {
    const tmp = freshStore("tool")
    seedTaskCards(tmp)
    const appended = flushMemoryWorkingWindow({
        cwd: tmp,
        sessionId: "l5-tool",
        pendingEvents: [{
            kind: "risk",
            summary: "Tool recall exact event",
            text: "Explicit recall event contains AXMEM-TOOL-SENTINEL."
        }],
        maxPackCacheBytes: 0
    }).appended_events[0]

    const both = runAxmemRecallTool({
        cwd: tmp,
        source: "both",
        sessionId: "l5-tool",
        eventId: appended.event_id,
        taskId: "task-thread",
        profile: "focused",
        includeEvidence: true
    })
    assert.equal(both.session?.results[0]?.event_id, appended.event_id)
    assert.equal(both.memory?.results[0]?.task_id, "task-thread")
    assert.equal(both.estimated_tokens > 0, true)
})

function evidenceText(evidence: MemoryEvidence): string {
    return JSON.stringify(evidence.data ?? evidence.summary)
}

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
