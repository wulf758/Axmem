// AXMEM profile facts v2 — SENIOR-OWNED ORACLE (gold standard).
//
// Extends the identity/name fix to preferences, relations, and other stable
// personal facts, with the SAME discipline: explicit-only extraction, provenance
// + confidence + supersede, recall boost, and conservative non-extraction.
//
// RULES FOR THE CODER:
//   * Make every case pass by implementing extraction/recall — NEVER edit the cases.
//   * Until profile-facts v2 lands, the preference/relation/supersede cases are
//     RED on purpose: they are the target. The name + no-false-extraction cases
//     must stay green (regression guard / conservative guard).
//   * Add an env-gated mutation (e.g. ignore_preference_boost) the test must KILL.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { appendSessionMemory, recallSessionMemory } from "../memory"

function freshStore(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `axmem-profile-v2-${label}-`))
}
function user(cwd: string, sessionId: string, text: string): void {
    appendSessionMemory({ cwd, sessionId, kind: "user_message", role: "user", text })
}
function recall(cwd: string, sessionId: string, query: string): any {
    return recallSessionMemory({ cwd, sessionId, query, profile: "ultra" })
}
function topFact(r: any): any | null {
    const top = r.results?.[0]
    return top?.profile_fact ?? null
}
function preferenceOraclePasses(cwd: string, sessionId: string): boolean {
    const f = topFact(recall(cwd, sessionId, "what is my preferred programming language"))
    return Boolean(f && String(f.key).startsWith("user.preference") && /typescript/i.test(JSON.stringify(f)))
}

test("profile v2 — name still works (regression guard, must stay green)", () => {
    const cwd = freshStore("name"), S = "s"
    user(cwd, S, "Bonjour, je m'appelle Alex.")
    user(cwd, S, "Il fait beau aujourd'hui.")
    user(cwd, S, "au fait, quel est mon nom déjà ?")
    const f = topFact(recall(cwd, S, "what is my name"))
    assert.ok(f && f.key === "user.name" && f.value === "Alex", "name fact must be the top result, not the question")
})

test("profile v2 — incidental/negated mentions do NOT become facts (conservative, must stay green)", () => {
    const cwd = freshStore("noextract"), S = "s"
    user(cwd, S, "Certains préfèrent Python, mais bon.")        // not the USER's stable preference
    user(cwd, S, "Je préfère ne pas en parler.")                 // negated
    const f = topFact(recall(cwd, S, "what is my preferred language"))
    assert.ok(
        !(f && String(f.key).startsWith("user.preference") && /python/i.test(JSON.stringify(f))),
        "must not extract a false user preference from an incidental/negated mention"
    )
})

// ---- TARGET cases (RED until profile-facts v2 is implemented) ----

test("profile v2 — explicit preference becomes a fact and beats the question echo", () => {
    const cwd = freshStore("pref"), S = "s"
    user(cwd, S, "Je préfère TypeScript à Rust pour ce projet.")
    user(cwd, S, "On en reparle demain.")
    user(cwd, S, "au fait, quelle est ma préférence de langage ?")
    const f = topFact(recall(cwd, S, "what is my preferred programming language"))
    assert.ok(f && String(f.key).startsWith("user.preference"), "top must be a preference profile_fact, not the question event")
    assert.ok(/typescript/i.test(JSON.stringify(f)), "preference value must capture TypeScript")
    assert.equal(f.confidence, "explicit_user_statement")
})

test("profile v2 — a later explicit preference supersedes the older one", () => {
    const cwd = freshStore("supersede"), S = "s"
    user(cwd, S, "Je préfère TypeScript.")
    user(cwd, S, "Finalement, maintenant je préfère Rust.")
    const f = topFact(recall(cwd, S, "what is my preferred programming language"))
    assert.ok(f && /rust/i.test(JSON.stringify(f)), "current preference must be Rust")
    assert.equal(f.status, "active")
    assert.ok(!/typescript/i.test(String(f.value)), "the superseded value must not be the active current truth")
})

test("profile v2 — explicit relation fact (e.g. spouse name)", () => {
    const cwd = freshStore("relation"), S = "s"
    user(cwd, S, "Ma femme s'appelle Riley.")
    user(cwd, S, "comment s'appelle ma femme ?")
    const f = topFact(recall(cwd, S, "what is my wife's name"))
    assert.ok(f, "a relation profile_fact must be the top result")
    assert.ok(/riley/i.test(JSON.stringify(f)), "relation value must capture Riley")
    assert.ok(/relation|wife|spouse|femme/i.test(String(f.key)), "key must mark a relation fact")
})

test("profile v2 teeth — real session recall kills preference boost mutation", () => {
    const cwd = freshStore("pref-mutation"), S = "s"
    user(cwd, S, "Je préfère TypeScript à Rust pour ce projet.")
    user(cwd, S, "au fait, quelle est ma préférence de langage ?")

    assert.equal(preferenceOraclePasses(cwd, S), true)
    withAxmemMutation("ignore_preference_boost", () => {
        assert.equal(preferenceOraclePasses(cwd, S), false, "ignore_preference_boost survived the profile v2 benchmark")
    })
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
