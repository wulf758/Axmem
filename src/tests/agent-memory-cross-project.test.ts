// AXMEM Family 2 — CROSS-PROJECT bleed gate (senior-owned oracle).
//
// Reproducible: builds an isolated temp registry (--memory-home) with two attached
// projects, then runs cross-project queries via recallGlobalMemory. A card from
// project Y that merely name-drops project X's terms must NOT outrank the card
// that OWNS the topic in project X. Tested in BOTH directions so the fix is real
// routing, not "always prefer one project". Negative -> no_strong_match.
//
// The CODER owns the ranker; the SENIOR owns these cases. Never edit the cases.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { attachMemoryProject, ingestMemoryPack, recallGlobalMemory } from "../memory"

// Locked baseline (set after measuring). Coder must keep cross-project routing.
const FLOOR = { recall1: 1.0 }

type Card = { taskId: string; title: string; tags: string[]; summary: string }
type Proj = { id: string; cards: Card[] }

const PROJECTS: Proj[] = [
    { id: "forgekit", cards: [
        { taskId: "sf-format", title: "ForgeKit SFZ runtime asset format", tags: ["forgekit", "sfz", "asset", "format", "runtime"],
          summary: "The .sfz file is ForgeKit's semantic runtime asset format; it deterministically generates the glb." },
        { taskId: "sf-recipe-note", title: "ForgeKit generation recipes", tags: ["forgekit", "recipe", "generation"],
          summary: "Recipes define generation; they touch glass and grid parameters in passing." }
    ] },
    { id: "cityruntime", cards: [
        { taskId: "lim-sfz-pivot", title: "CityRuntime runtime integration", tags: ["cityruntime", "bevy", "runtime"],
          summary: "CityRuntime loads ForgeKit sfz assets at runtime in the Bevy engine." },
        { taskId: "lim-facade", title: "CityRuntime facade glass grid recipe normalization", tags: ["cityruntime", "facade", "glass-grid", "recipe", "bevy"],
          summary: "Art-deco facade asymmetry is fixed at runtime via a normalized glass grid recipe in Bevy." }
    ] }
]

type Case = { id: string; query: string; expectProject: string | null; expectTask: string | null }
const CASES: Case[] = [
    // owner (forgekit/sf-format) must beat the incidental mention (cityruntime/lim-sfz-pivot)
    { id: "bleed-forgekit-owns-sfz", query: "sfz runtime asset format authoring", expectProject: "forgekit", expectTask: "sf-format" },
    // owner (cityruntime/lim-facade) must beat the incidental mention (forgekit/sf-recipe-note)
    { id: "bleed-cityruntime-owns-facade", query: "bevy facade glass grid recipe normalization", expectProject: "cityruntime", expectTask: "lim-facade" },
    // nothing matches -> decline
    { id: "negative", query: "kubernetes ingress controller yaml deployment", expectProject: null, expectTask: null }
]

function buildRegistry(): string {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "axmem-xproj-home-"))
    for (const p of PROJECTS) {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), `axmem-xproj-${p.id}-`))
        for (const c of p.cards) {
            ingestMemoryPack({ cwd: ws, taskId: c.taskId, title: c.title, tags: c.tags, document: { summary: c.summary } })
        }
        attachMemoryProject({ memoryHome: home, workspacePath: ws, projectId: p.id, title: p.id, visibility: "shared", agentScope: "test" })
    }
    return home
}

test("AXMEM Family 2 — cross-project bleed gate (owner beats incidental mention)", () => {
    const home = buildRegistry()
    const positives: { id: string; rank: number | null; top: string }[] = []
    let negativeDeclines = true

    for (const c of CASES) {
        const r = recallGlobalMemory({ memoryHome: home, query: c.query, profile: "ultra", limit: 10 })
        const top = r.results[0] ? `${r.results[0].project_id}/${r.results[0].task_id}` : "(none)"
        if (c.expectProject === null) {
            const declines = r.no_strong_match === true || r.results.length === 0
            negativeDeclines = negativeDeclines && declines
            console.log(`[${c.id}] negative -> top=${top} no_strong_match=${r.no_strong_match ?? "n/a"} -> ${declines ? "OK" : "RISK"}`)
            continue
        }
        const idx = r.results.findIndex((x) => x.project_id === c.expectProject && x.task_id === c.expectTask)
        const rank = idx >= 0 ? idx + 1 : null
        positives.push({ id: c.id, rank, top })
        console.log(`[${c.id}] expect ${c.expectProject}/${c.expectTask} -> ${rank === 1 ? "rank 1 OK" : rank ? `rank ${rank} (top=${top})` : `MISS (top=${top})`}`)
    }

    const recall1 = positives.filter((p) => p.rank === 1).length / positives.length
    console.log(`\n=== cross-project recall@1 = ${recall1.toFixed(2)}  negativeDeclines=${negativeDeclines} ===`)
    assert.ok(recall1 >= FLOOR.recall1, `cross-project recall@1 ${recall1} below floor ${FLOOR.recall1}`)
    assert.ok(negativeDeclines, "cross-project negative must return no_strong_match")
})
