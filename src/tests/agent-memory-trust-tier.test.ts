// AXMEM trust/access tiers — Phase 4/A7+B6.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { buildMemorySearchStore, ingestMemoryPack, packMemoryPack, recallMemory, type AgentMemoryPack } from "../memory"

function freshStore(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `axmem-trust-${label}-`))
}

test("AXMEM A7 — invalidated trust tier cannot be promoted to active fact", () => {
    const now = new Date().toISOString()
    const pack: AgentMemoryPack = {
        schema: "axiom.agent_memory_pack.v0",
        version: 1,
        task: {
            id: "bad-trust",
            title: "Bad trust pack",
            tags: ["trust"],
            created_at: now,
            updated_at: now
        },
        summary: { goal: "Bad trust tier" },
        semantic_refs: [],
        decisions: [],
        commands: [],
        next_actions: [],
        invalidated_hypotheses: [],
        evidence: [],
        strata: [],
        nodes: [{
            id: "node:bad",
            part: "memory",
            stratum: "trust",
            kind: "hypothesis",
            title: "Invalidated belief promoted by mistake",
            status: "active",
            trust_tier: "invalidated"
        }],
        anchors: []
    }

    assert.throws(() => packMemoryPack(pack), /tier invalidated node/)
})

test("AXMEM A7/B6 — invalidated nodes keep trust tier and recall exposes access tiers", () => {
    const tmp = freshStore("tiers")
    ingestMemoryPack({
        cwd: tmp,
        taskId: "trust-card",
        title: "Trust tier card",
        tags: ["trust", "sqlite", "corruption", "recovery"],
        document: {
            summary: "Trust tier card with invalidated hypothesis",
            nodes: [{
                id: "bad-hypothesis",
                kind: "hypothesis",
                title: "Bad hypothesis",
                status: "invalidated",
                trust_tier: "invalidated",
                evidence_refs: ["agent_ingest"]
            }]
        }
    })
    buildMemorySearchStore({ cwd: tmp, reason: "manual" })

    const recalled = recallMemory({
        cwd: tmp,
        query: "database recover trust",
        profile: "full",
        includeGraph: true
    })
    assert.equal(recalled.results[0]?.task_id, "trust-card")
    assert.equal(recalled.access_tiers.includes("L2_SEARCH_STORE"), true)
    assert.equal(recalled.access_tiers.includes("L3_VECTOR_INDEX"), true)
    assert.equal(recalled.access_tiers.includes("L1_PACK_LRU"), true)
    const nodes = recalled.results[0]?.full_graph?.nodes ?? []
    const invalidated = nodes.find((node) => node.id === "bad-hypothesis")
    assert.equal(invalidated?.status, "invalidated")
    assert.equal(invalidated?.trust_tier, "invalidated")
})
