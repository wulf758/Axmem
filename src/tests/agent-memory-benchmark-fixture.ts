import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
    buildMemorySearchStore,
    evaluateMemoryRecallBenchmark,
    ingestMemoryPack,
    type MemoryRecallBenchmarkCase,
    type MemoryRecallBenchmarkReport
} from "../memory"

export const AXMEM_BENCHMARK_CORPUS_VERSION = "synthetic-public-memory-2026-06-14-plus-soundness-teeth-v1"

type BenchmarkCard = {
    taskId: string
    title: string
    tags: string[]
    summary: string
    decisions?: string[]
    commands?: string[]
    semantic_refs?: { kind: string; name: string }[]
    next_actions?: string[]
    invalidated_hypotheses?: {
        hypothesis: string
        reason?: string
        next_better_hypothesis?: string
        invalidated_by: string[]
    }[]
}

// Most cards below are compacted from synthetic public AXMEM-style cards across
// axiom, forgekit-2, forgekit-3, and cityruntime. The final
// few synthetic cards are narrow teeth cases for specific soundness mutations.
const BENCHMARK_CARDS: BenchmarkCard[] = [
    {
        taskId: "axiom-knowledge-axmem-runtime",
        title: "Axiom AXMEM native agent memory runtime",
        tags: ["axiom", "axmem", "memory", "runtime", "cli", "ultra", "zlib"],
        summary: "AXMEM packs, index, ingest, reindex, global project memory, graph strata, invalidated-history recall, and ultra/focused/full profiles.",
        decisions: [
            "AXMEM v1 remains deterministic: compressed local .axmem plus readable index are source of truth.",
            "Ultra recall is compact and index-backed; focused/full hydrate only on request."
        ],
        commands: ["node dist/cli.js memory recall --query axmem runtime --profile ultra"],
        semantic_refs: [{ kind: "file", name: "compiler/src/agent/memory.ts" }]
    },
    {
        taskId: "axiom-knowledge-cli-command-map",
        title: "Axiom CLI command families and source-first registry",
        tags: ["axiom", "cli", "registry", "source-first", "generated", "commands"],
        summary: "CLI metadata is source-first: compiler/axiom/cli_commands.axm is semantic source and generated registry files are projections.",
        decisions: ["Edit cli_commands.axm and regenerate/check the registry instead of editing generated output."],
        commands: ["node dist/cli.js generate-cli-registry --check --json"],
        semantic_refs: [
            { kind: "module", name: "axiom_cli_registry" },
            { kind: "command", name: "memory" }
        ]
    },
    {
        taskId: "axiom-knowledge-repo-map",
        title: "Axiom repository map and search orientation",
        tags: ["axiom", "repo-map", "compiler", "docs", "generated", "source-first"],
        summary: "Use AXMEM, source-map commands and targeted rg first. compiler/axiom owns semantic source; compiler/src/generated is projection output.",
        decisions: ["Do not begin broad Axiom tasks by reading every repo file."],
        semantic_refs: [
            { kind: "repo", name: "compiler/axiom" },
            { kind: "repo", name: "compiler/src/generated" }
        ]
    },
    {
        taskId: "forgekit-repo-map-current-2026-06-08",
        title: "ForgeKit repo map and source projection rules",
        tags: ["forgekit", "forgekit-2", "semantic-source", "sfpack", "sfskin", "sfasset", "pbr"],
        summary: "ForgeKit source is semantic truth: .strata.json/.sfpack for model and .skin.json/.sfskin for skin; OBJ, GLB, PNG, normal maps, height maps, and relief meshes are projections.",
        decisions: ["Build and validate the naked model before texture; texture must not hide wrong volume or surface binding mistakes."],
        semantic_refs: [
            { kind: "doc", name: "README.md" },
            { kind: "doc", name: "docs/runtime-asset-format.md" }
        ]
    },
    {
        taskId: "forgekit-texture-design-decisions-from-prototype-2026-06-08",
        title: "ForgeKit texture prototype design decisions",
        tags: ["forgekit", "texture", "micro-strata", "pbr", "relief", "projection"],
        summary: "Texture is a real semantic 3D skin: agents edit 2D strata on named surfaces, and PBR maps plus relief meshes are projections.",
        decisions: ["Do not simulate texture as a flat painted image; albedo, normal, height, and occlusion come from semantic 3D skin."],
        semantic_refs: [
            { kind: "module", name: "texture_proto/src/model.rs" },
            { kind: "module", name: "texture_proto/src/pbr.rs" }
        ]
    },
    {
        taskId: "forgekit-texture-pbr-first-runtime-2026-06-08",
        title: "ForgeKit texture PBR-first runtime contract",
        tags: ["forgekit", "texture", "pbr-first", "sfskin-v4", "sfasset", "bevy-runtime"],
        summary: "The semantic 3D skin remains lossless truth, but game/runtime loading is PBR-first; real relief mesh is explicit and budgeted.",
        decisions: ["RuntimeSkinPolicy default compiles PBR and does not compile real relief by default."],
        semantic_refs: [
            { kind: "module", name: "texture_proto/src/lod.rs" },
            { kind: "module", name: "texture_proto/src/runtime_gltf.rs" }
        ]
    },
    {
        taskId: "forgekit-3-functioning-2026-06-08",
        title: "ForgeKit 3 fonctionnement MVP",
        tags: ["forgekit", "forgekit-3", "sfz", "axmem", "operation-log", "projection"],
        summary: "ForgeKit 3 is an agent-only Rust MVP where compressed .sfz is canonical truth: a semantic operation log over part-local 2D strata; OBJ and GLB are projections.",
        decisions: ["Semantic ops are canonical; caches, masks, previews, meshes, OBJ, and GLB are disposable projections."],
        commands: ["cargo test", "cargo check"],
        semantic_refs: [
            { kind: "doc", name: "README.md" },
            { kind: "module", name: "crates/sfz_core/src/ops.rs" }
        ]
    },
    {
        taskId: "forgekit-3-organic-tree-v0-2026-06-08",
        title: "ForgeKit 3 organic tree v0",
        tags: ["forgekit-3", "organic", "tree", "cylinder_between", "revolve_profile", "support_contact_required"],
        summary: "Organic tree scene used 76 semantic ops, grounded trunk/root system, branch parts snapped as side_contact slaves, and separate revolved leaf clusters.",
        decisions: ["A future organic primitive should support tapered swept branches with explicit graft/contact semantics."],
        semantic_refs: [
            { kind: "operation", name: "cylinder_between" },
            { kind: "observer", name: "support_contact_required" }
        ],
        invalidated_hypotheses: [{
            hypothesis: "pure tangent cylinder cap at branch base is enough for support_contact_required",
            reason: "cylinder_between material query excludes endpoint caps",
            next_better_hypothesis: "Use tapered swept branches with explicit graft/contact semantics.",
            invalidated_by: ["agent_ingest"]
        }]
    },
    {
        taskId: "forgekit-3-roof-contact-trim-correction-2026-06-08",
        title: "ForgeKit 3 roof chimney surface-fit wave fix",
        tags: ["forgekit-3", "roof-contact", "trim_to_master_surface", "support_surface_contact", "mesh-projection"],
        summary: "Fixed roof chimney surface-fit visual waves by changing mesh projection, not semantic ops; trim_to_master_surface truth remains quantized.",
        decisions: ["Use trim_to_master_surface at fine pitch for clean fitted bottoms on gable roofs."],
        semantic_refs: [
            { kind: "operation", name: "trim_to_master_surface" },
            { kind: "observer", name: "support_surface_contact" }
        ],
        invalidated_hypotheses: [{
            hypothesis: "anchor snap or relation placement caused the chimney waves",
            reason: "validate strict showed clean surface_fit relation",
            next_better_hypothesis: "Inspect SurfaceFittedBox boundary reconstruction before changing semantic ops.",
            invalidated_by: ["agent_ingest"]
        }]
    },
    {
        taskId: "cityruntime-pbr-flat-game-runtime-decision",
        title: "CityRuntime game runtime abandons full relief",
        tags: ["cityruntime", "runtime", "sfasset", "pbr-flat", "cityskinprojectionmode", "semanticassetruntimecache"],
        summary: "CityRuntime locked game runtime to PBR-flat geometry plus albedo/normal maps; real relief moved to explicit local debug/stress.",
        decisions: ["Full relief is no longer the game/browser runtime path."],
        semantic_refs: [
            { kind: "runtime", name: "CitySkinProjectionMode" },
            { kind: "runtime", name: "SemanticAssetRuntimeCache" }
        ]
    },
    {
        taskId: "cityruntime-pbr-flat-runtime-implemented",
        title: "CityRuntime PBR-flat skin runtime implemented",
        tags: ["cityruntime", "bevy", "runtime", "assets", "sfasset", "pbr", "pbr-flat"],
        summary: "CityRuntime separates city render mode from skin projection mode; PBR-flat bakes albedo plus normal and uses flat surface meshes with tangent data.",
        decisions: ["Browser/game runtime should use pbr-flat skin projection by default."],
        semantic_refs: [
            { kind: "runtime", name: "CitySkinProjectionMode" },
            { kind: "asset", name: "out/buildings/art_deco_glass_skyscraper_50seed_catalog.sfasset" }
        ]
    },
    {
        taskId: "cityruntime-pbr-runtime-review",
        title: "CityRuntime PBR-first sfskin review",
        tags: ["cityruntime", "runtime", "assets", "sfasset", "pbr", "review"],
        summary: "CityRuntime Bevy needed an explicit PBR-flat projection path; height should be material data for normal/parallax metadata and real relief geometry stays opt-in.",
        decisions: ["Treat height as material data for normal/parallax metadata in browser/game runtime."],
        semantic_refs: [{ kind: "runtime", name: "SemanticAssetRuntimeCache" }]
    },
    {
        taskId: "score-hint-card",
        title: "Decision-only guard",
        tags: ["soundness", "ranking"],
        summary: "This guard card is findable by indexed decision text.",
        decisions: ["redblue greenpurple silverneedle"]
    },
    {
        taskId: "query-card",
        title: "Query specific target",
        tags: ["querytarget", "soundness"],
        summary: "The query-specific target must beat a newer unrelated card."
    },
    {
        taskId: "zz-newer-noise-card",
        title: "Newer unrelated noise",
        tags: ["noise", "soundness"],
        summary: "This newer card catches rankers that ignore query terms."
    },
    {
        taskId: "refund-active-card",
        title: "Refund active bounded card",
        tags: ["refund", "captured", "amount", "active", "bounded"],
        summary: "Current truth: refund is bounded by captured amount even when an invalidated hypothesis mentions the same words."
    },
    {
        taskId: "refund-invalid-card",
        title: "Refund invalidated card",
        tags: ["refund", "captured", "amount", "invalidated"],
        summary: "Historical false refund path.",
        invalidated_hypotheses: [{
            hypothesis: "Refund can exceed captured amount",
            reason: "Conservation invalidated this path",
            next_better_hypothesis: "Refund is bounded by captured amount",
            invalidated_by: ["benchmark"]
        }]
    },
    {
        taskId: "fts-migration",
        title: "SQLite FTS migration",
        tags: ["sqlite", "fts", "schema-version", "dual-read", "corruption-recovery"],
        summary: "The inverted search store migration needs schema versioning, full rebuild, recovery, and dual-read compare mode.",
        decisions: ["Do not retire the JSON index before the dual-read gate passes."]
    }
]

export const AXMEM_BENCHMARK_CASES: MemoryRecallBenchmarkCase[] = [
    { id: "synthetic-axiom-runtime", query: "deterministic axmem zlib packs ultra focused full recall", expected_task_ids: ["axiom-knowledge-axmem-runtime"] },
    { id: "synthetic-axiom-cli", query: "cli source first registry generated commands memory", expected_task_ids: ["axiom-knowledge-cli-command-map"] },
    { id: "synthetic-axiom-repo-map", query: "repo map compiler axiom generated projections source first", expected_task_ids: ["axiom-knowledge-repo-map"] },
    { id: "synthetic-sf2-repo", query: "forgekit semantic source sfpack sfskin sfasset projections", expected_task_ids: ["forgekit-repo-map-current-2026-06-08"] },
    { id: "synthetic-sf2-texture", query: "micro strata pbr maps relief meshes semantic skin", expected_task_ids: ["forgekit-texture-design-decisions-from-prototype-2026-06-08"] },
    { id: "synthetic-sf2-pbr-first", query: "RuntimeSkinPolicy force_real_relief sfskin-v4 texture_proto lod", expected_task_ids: ["forgekit-texture-pbr-first-runtime-2026-06-08"] },
    { id: "synthetic-sf3-functioning", query: "sfz semantic operation log obj glb projections", expected_task_ids: ["forgekit-3-functioning-2026-06-08"] },
    { id: "synthetic-sf3-organic", query: "organic tree cylinder_between support_contact_required", expected_task_ids: ["forgekit-3-organic-tree-v0-2026-06-08"] },
    { id: "synthetic-sf3-roof", query: "roof chimney trim_to_master_surface support_surface_contact", expected_task_ids: ["forgekit-3-roof-contact-trim-correction-2026-06-08"] },
    { id: "synthetic-cityruntime-runtime", query: "cityruntime pbr flat game runtime abandons full relief", expected_task_ids: ["cityruntime-pbr-flat-game-runtime-decision"] },
    { id: "synthetic-cityruntime-implemented", query: "CitySkinProjectionMode PbrFlat SemanticAssetRuntimeCache", expected_task_ids: ["cityruntime-pbr-flat-runtime-implemented"] },
    { id: "synthetic-cityruntime-review", query: "pbr flat projection path height material data review", expected_task_ids: ["cityruntime-pbr-runtime-review"] },
    { id: "teeth-score-hints", query: "redblue greenpurple silverneedle", expected_task_ids: ["score-hint-card"], max_rank: 1 },
    { id: "teeth-query-terms", query: "querytarget", expected_task_ids: ["query-card"], max_rank: 1 },
    { id: "teeth-invalidated-current", query: "refund captured amount invalidated", expected_task_ids: ["refund-active-card"], max_rank: 1 },
    { id: "teeth-invalidated-history", query: "refund exceed captured amount history", mode: "history", expected_task_ids: ["refund-invalid-card"], max_rank: 1 },
    { id: "teeth-vector-alias", query: "database recover", expected_task_ids: ["fts-migration"], max_rank: 1 },
    { id: "negative-nebula", query: "banana cookbook nebula", expect_no_strong_match: true },
    { id: "negative-calendar", query: "oauth calendar invite", expect_no_strong_match: true },
    { id: "negative-playlist", query: "quantum sandwich playlist", expect_no_strong_match: true },
    { id: "negative-invoice", query: "nonexistent textile invoice", expect_no_strong_match: true }
]

export function seedAxmemBenchmarkStore(cwd: string): void {
    for (const card of BENCHMARK_CARDS) {
        ingestMemoryPack({
            cwd,
            taskId: card.taskId,
            title: card.title,
            tags: card.tags,
            document: {
                summary: card.summary,
                decisions: card.decisions,
                commands: card.commands,
                semantic_refs: card.semantic_refs,
                next_actions: card.next_actions,
                invalidated_hypotheses: card.invalidated_hypotheses
            }
        })
    }
    forceIndexUpdatedAt(cwd, "zz-newer-noise-card", "2099-01-01T00:00:00.000Z")
    buildMemorySearchStore({ cwd, reason: "manual" })
}

export function evaluateAxmemBenchmark(cwd: string): MemoryRecallBenchmarkReport {
    return evaluateMemoryRecallBenchmark({
        cwd,
        corpusVersion: AXMEM_BENCHMARK_CORPUS_VERSION,
        strongMatchMinScore: 15,
        cases: AXMEM_BENCHMARK_CASES
    })
}

export function axmemBenchmarkGatePassed(report: MemoryRecallBenchmarkReport): boolean {
    return report.corpus_version === AXMEM_BENCHMARK_CORPUS_VERSION
        && report.case_count === AXMEM_BENCHMARK_CASES.length
        && report.positive_case_count >= 17
        && report.no_strong_match_case_count >= 4
        && report.recall_at_1 >= 0.85
        && report.recall_at_3 >= 0.95
        && report.mrr >= 0.9
        && report.no_strong_match_precision >= 0.9
        && report.no_strong_match_accuracy >= 1
        && report.status === "ok"
}

export function assertAxmemBenchmarkGate(report: MemoryRecallBenchmarkReport): void {
    assert.equal(
        axmemBenchmarkGatePassed(report),
        true,
        JSON.stringify({
            corpus_version: report.corpus_version,
            case_count: report.case_count,
            recall_at_1: report.recall_at_1,
            recall_at_3: report.recall_at_3,
            mrr: report.mrr,
            no_strong_match_precision: report.no_strong_match_precision,
            no_strong_match_accuracy: report.no_strong_match_accuracy,
            failed_cases: report.results.filter((item) => !item.passed)
        }, null, 2)
    )
}

function forceIndexUpdatedAt(cwd: string, taskId: string, updatedAt: string): void {
    const indexPath = path.join(cwd, ".axmem", "memory", "index.axmem.json")
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
        entries: { task_id: string; updated_at: string }[]
        updated_at: string
    }
    const entry = index.entries.find((item) => item.task_id === taskId)
    if (!entry) throw new Error(`missing benchmark card ${taskId}`)
    entry.updated_at = updatedAt
    index.updated_at = updatedAt
    fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8")
}
