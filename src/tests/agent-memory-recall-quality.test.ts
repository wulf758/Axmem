// AXMEM Family 2 — recall QUALITY benchmark (senior-owned oracle).
//
// Self-contained: ingests a fixed corpus into a temp store, then runs labeled
// HARD cases that model the ranking pathologies found in live testing:
//   - incidental mention beating the topic-owning card,
//   - a broad "kitchen-sink" card hijacking unrelated queries,
//   - a focused/specific card buried,
//   - a negative query that must return no_strong_match.
//
// This is the coder's fitness function. Rules:
//   * The CODER improves the ranker (scoreEntry) — never edits these cases.
//   * The gate locks a non-regressing floor; raise FLOOR as the ranker improves.
//   * `npm run axmem:recall-quality` (or this test) prints per-case ranks so the
//     coder can see exactly which cases still fail.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ingestMemoryPack, recallMemory } from "../memory"

// Locked non-regressing floor. Measured baseline of the current ranker; the coder
// RAISES these as ranking improves. Target: positives all rank 1 (recall@1 = 1).
// Locked baseline on these BASIC single-store cases (the ranker already aces
// them, so they are a non-regression guard, not a quality claim). The REAL hard
// ranking oracle is the live-registry diagnostic (.tmp/axmem-recall-baseline.mjs,
// recall@1 ~0.25). `negativeDeclines` is a KNOWN-FAILING A5 target (no_strong_match
// is not yet calibrated) — logged, not asserted, so CI stays green; the coder must
// make it true.
// Hardened-corpus baseline of the CURRENT ranker (it bites: a broad "kitchen-sink"
// card hijacks specific queries -> recall@1 = 0.25, same as the live diagnostic).
// This is the honest floor; the CODER ratchets recall1 UP toward 1.0 by fixing
// broad-card dominance, then raises these numbers. negativeDeclines is a KNOWN A5
// target (no_strong_match not yet calibrated) — logged, not asserted.
// Ratcheted up after the coder's ranker pass: recall@1 0.25 -> 1.0 (broad-card
// dominance fixed) and the negative now declines (A5 fixed on this fixture).
// Locked so any future ranking regression on these cases fails CI.
// NOTE (residual): A5 is NOT yet robust on the LIVE registry — a weak partial
// match there still clears the no_strong_match threshold. Tracked for the coder.
const FLOOR = { recall1: 1.0, recall3: 1.0, mrr: 1.0 }

type Card = { taskId: string; title: string; tags: string[]; summary: string; decisions?: string[]; commands?: string[] }

const CORPUS: Card[] = [
    { taskId: "sf-asset-format", title: "ForgeKit SFZ runtime asset format", tags: ["forgekit", "sfz", "asset", "format", "runtime"],
      summary: "The .sfz file is ForgeKit's semantic runtime asset format; it deterministically generates the .glb. Authoring is semantic-first." },
    { taskId: "cityruntime-sfz-pivot", title: "CityRuntime runtime", tags: ["cityruntime", "bevy", "runtime"],
      summary: "CityRuntime now loads ForgeKit sfz assets at runtime in the Bevy engine; this is a runtime integration note." },
    { taskId: "recall-metric-fix", title: "recall_chars metric honesty fix", tags: ["recall", "metric", "recall_chars", "honesty"],
      summary: "recall_chars now measures the rendered card bytes via renderRecallCardChars, not jsonCharLength of the item." },
    { taskId: "broad-notes", title: "General project notes", tags: ["notes", "misc", "general"],
      summary: "Assorted notes touching recall, metric, tokens, chars, card, index, cache, runtime, asset, format, sfz, query, ranking, evidence, budget.",
      decisions: ["recall and metric and chars and card and index and cache appear here as broad noise", "tokens and ranking and query and evidence also appear"] },
    { taskId: "cache-coherence", title: "RAM index cache coherence", tags: ["cache", "coherence", "index", "mtime"],
      summary: "The in-RAM index cache invalidates on content hash so a stale cache never serves wrong memory." },
    { taskId: "trust-tier", title: "Trust tiers and invalidated hypotheses", tags: ["trust", "invalidated", "provenance"],
      summary: "Invalidated hypotheses are never surfaced as current truth; trust tier is preserved through recall." }
]

type Case = { id: string; query: string; expect: string | null }
const CASES: Case[] = [
    { id: "owner-vs-incidental", query: "sfz runtime asset format authoring", expect: "sf-asset-format" },
    { id: "focused-vs-broad", query: "recall_chars metric measured wrong then fixed", expect: "recall-metric-fix" },
    { id: "exact-term", query: "renderRecallCardChars rendered card bytes", expect: "recall-metric-fix" },
    { id: "cache-control", query: "index cache coherence stale content hash", expect: "cache-coherence" },
    { id: "negative", query: "production billing database cloud provider hosting region", expect: null }
]

function seed(cwd: string): void {
    for (const c of CORPUS) {
        ingestMemoryPack({ cwd, taskId: c.taskId, title: c.title, tags: c.tags, document: { summary: c.summary, decisions: c.decisions, commands: c.commands } })
    }
    // Kitchen-sink broad card: name-drops the terms of EVERY targeted query. It
    // must NOT outrank the topic-owning cards. This is the broad-card-dominance trap.
    ingestMemoryPack({
        cwd, taskId: "kitchen-sink", title: "Misc working notes (everything)",
        tags: ["notes", "sfz", "recall", "metric", "recall_chars", "format", "runtime", "cache", "index", "asset", "card", "bytes", "query", "ranking", "coherence", "authoring"],
        document: {
            summary: "Broad notes mentioning sfz runtime asset format recall metric recall_chars rendered card bytes index cache coherence authoring query ranking — all in one place.",
            decisions: [
                "sfz runtime asset format recall metric recall_chars card bytes index cache coherence authoring",
                "more recall metric chars card index cache sfz format runtime query ranking noise"
            ]
        }
    })
    // Scale: distractor cards so dominance/burying pathologies can emerge.
    for (let i = 0; i < 40; i++) {
        ingestMemoryPack({
            cwd, taskId: `distractor-${i}`, title: `Working note ${i}`,
            tags: [`topic${i % 8}`, "general", "note", i % 3 === 0 ? "runtime" : "misc", i % 4 === 0 ? "cache" : "data"],
            document: { summary: `General note ${i} about topic ${i % 8}, touching runtime cache index format and assorted project work.` }
        })
    }
}

test("AXMEM Family 2 — recall quality on hard cases (non-regressing floor)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axmem-recall-quality-"))
    seed(tmp)

    const positives: { id: string; rank: number | null; top: string }[] = []
    let negativeDeclines = true
    for (const c of CASES) {
        const r = recallMemory({ cwd: tmp, query: c.query, profile: "ultra", limit: 10 })
        const top = r.results[0]?.task_id ?? "(none)"
        if (c.expect === null) {
            const declines = r.no_strong_match === true || r.results.length === 0
            negativeDeclines = negativeDeclines && declines
            console.log(`[${c.id}] negative -> top=${top} no_strong_match=${r.no_strong_match ?? "n/a"} -> ${declines ? "OK" : "RISK"}`)
            continue
        }
        const idx = r.results.findIndex((x) => x.task_id === c.expect)
        const rank = idx >= 0 ? idx + 1 : null
        positives.push({ id: c.id, rank, top })
        console.log(`[${c.id}] expect ${c.expect} -> ${rank === 1 ? "rank 1 OK" : rank ? `rank ${rank} (top=${top})` : `MISS (top=${top})`}`)
    }

    const recall1 = positives.filter((p) => p.rank === 1).length / positives.length
    const recall3 = positives.filter((p) => p.rank && p.rank <= 3).length / positives.length
    const mrr = positives.reduce((s, p) => s + (p.rank ? 1 / p.rank : 0), 0) / positives.length
    console.log(`\n=== recall@1=${recall1.toFixed(2)} recall@3=${recall3.toFixed(2)} MRR=${mrr.toFixed(2)} negativeDeclines=${negativeDeclines} ===`)
    console.log("Target: recall@1 -> 1.0. Coder raises FLOOR as the ranker improves; never edit the cases.")

    // Non-regressing gate (locked baseline; ratchet up):
    assert.ok(recall1 >= FLOOR.recall1, `recall@1 ${recall1} regressed below floor ${FLOOR.recall1}`)
    assert.ok(recall3 >= FLOOR.recall3, `recall@3 ${recall3} regressed below floor ${FLOOR.recall3}`)
    assert.ok(mrr >= FLOOR.mrr, `MRR ${mrr} regressed below floor ${FLOOR.mrr}`)
    assert.ok(negativeDeclines, "negative query must return no_strong_match (A5 conservative decline)")
})

// ---- Indexing analyzer: accents + light morphology (senior-owned) ----
//
// PROVEN LIVE BUG: queryTerms strips [^a-z0-9_.:-], so accented chars are
// DELETED ("préfère" -> "prfre") instead of folded ("prefere"). A French user
// typing without accents (the common case) misses accented cards, and
// vice-versa. The fix: ONE shared analyzer (lowercase -> NFD -> strip combining
// marks -> filter) applied identically at index time AND query time, plus an
// index schema bump + rebuild. The coder removes the todo flags by fixing the
// analyzer; never edits the cases.

function seedFrench(cwd: string): void {
    ingestMemoryPack({
        cwd, taskId: "pref-fr-accented", title: "Préférences de Alex",
        tags: ["préférence", "langage", "décision"],
        document: { summary: "Alex préfère TypeScript. Décision enregistrée après évaluation." }
    })
    ingestMemoryPack({
        cwd, taskId: "notes-fr-plain", title: "Notes utilisateur sans accents",
        tags: ["preferences", "utilisateur"],
        document: { summary: "Preferences utilisateur enregistrees pour le deploiement, gestion memoire." }
    })
}

test("indexing — accent-insensitive: unaccented query finds the accented card", { todo: "TARGET: shared analyzer with NFD accent folding (index + query)" }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axmem-accents-a-"))
    seedFrench(tmp)
    const r = recallMemory({ cwd: tmp, query: "prefere typescript decision", profile: "ultra", limit: 5 })
    assert.equal(r.results[0]?.task_id, "pref-fr-accented", "unaccented query must find the accented card at rank 1")
})

test("indexing — accent-insensitive: accented query finds the unaccented card", { todo: "TARGET: shared analyzer with NFD accent folding (index + query)" }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axmem-accents-b-"))
    seedFrench(tmp)
    const r = recallMemory({ cwd: tmp, query: "préférences utilisateur enregistrées", profile: "ultra", limit: 5 })
    assert.equal(r.results[0]?.task_id, "notes-fr-plain", "accented query must find the unaccented card at rank 1")
})

test("indexing — light morphology: plural/variant query matches the singular card text", { todo: "TARGET: light FR/EN suffix stemming in the shared analyzer" }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axmem-stem-"))
    seedFrench(tmp)
    // "décisions"/"évaluations" (plural) vs card text "Décision enregistrée après évaluation"
    // (singular); no tag matches these exactly, so only stemming can bridge it.
    const r = recallMemory({ cwd: tmp, query: "décisions évaluations", profile: "ultra", limit: 5 })
    assert.equal(r.results[0]?.task_id, "pref-fr-accented", "morphological variant must still rank the owning card first")
})
