// AXMEM identity/profile recall benchmark (senior-owned oracle).
//
// The store contains an explicit user identity statement, noise, then a later
// question asking for the identity. The current truth must be the declarative
// fact, never the question echo. Superseded facts remain inspectable as history.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
    appendSessionMemory,
    recallSessionMemory,
    readSessionMemoryIndex,
    type SessionMemoryRecallItem
} from "../memory"

function freshStore(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `axmem-identity-${label}-`))
}

function appendUser(cwd: string, sessionId: string, text: string) {
    return appendSessionMemory({
        cwd,
        sessionId,
        kind: "user_message",
        summary: text,
        text,
        role: "user"
    })
}

function appendAssistant(cwd: string, sessionId: string, text: string) {
    return appendSessionMemory({
        cwd,
        sessionId,
        kind: "assistant_update",
        summary: text,
        text,
        role: "assistant"
    })
}

function recallName(cwd: string, sessionId: string) {
    return recallSessionMemory({
        cwd,
        sessionId,
        query: "what is my name / quel est mon nom",
        profile: "ultra",
        limit: 5
    })
}

function itemText(item: SessionMemoryRecallItem | undefined): string {
    const meta = item as (SessionMemoryRecallItem & {
        status?: string
        profile_fact?: { key?: string; value?: string; status?: string }
    }) | undefined
    return [
        meta?.event_id,
        meta?.kind,
        meta?.title,
        meta?.summary,
        meta?.evidence_preview,
        meta?.status,
        meta?.profile_fact?.key,
        meta?.profile_fact?.value,
        meta?.profile_fact?.status,
        ...(meta?.tags ?? []),
        ...(meta?.score_hints ?? [])
    ].filter(Boolean).join("\n")
}

function assertTopIdentityFact(item: SessionMemoryRecallItem | undefined, value: string): void {
    const text = itemText(item)
    const questionSurface = [item?.kind, item?.title, item?.summary, item?.evidence_preview].filter(Boolean).join("\n")
    assert.match(text, new RegExp(`\\b${value}\\b`, "i"), `top recall item should contain current identity value ${value}: ${text}`)
    if (item?.kind !== "profile_fact") {
        assert.doesNotMatch(questionSurface, /\bquel est mon nom\b|\bwhat is my name\b/i, `top recall item must not be the question event: ${text}`)
    }
}

function identityOraclePasses(cwd: string, sessionId: string): boolean {
    try {
        assertTopIdentityFact(recallName(cwd, sessionId).results[0], "Alex")
        return true
    } catch {
        return false
    }
}

test("AXMEM identity A/B — declarative name fact beats later question echoes", () => {
    const tmp = freshStore("question-echo")
    const sessionId = "identity-oracle-ab"
    appendUser(tmp, sessionId, "Bonjour, je m'appelle Alex")
    appendAssistant(tmp, sessionId, "Enchanté Alex, je garde ça en mémoire.")
    appendUser(tmp, sessionId, "J'aime les outils de mémoire locale.")
    const echo = appendAssistant(tmp, sessionId, "Question répétée: quel est mon nom ?")
    const question = appendUser(tmp, sessionId, "quel est mon nom ?")

    const result = recallName(tmp, sessionId)
    assertTopIdentityFact(result.results[0], "Alex")
    assert.notEqual(result.results[0]?.event_id, echo.event_id)
    assert.notEqual(result.results[0]?.event_id, question.event_id)
})

test("AXMEM identity C — explicit later name supersedes older current truth", () => {
    const tmp = freshStore("supersede")
    const sessionId = "identity-oracle-c"
    appendUser(tmp, sessionId, "Bonjour, je m'appelle Alex")
    appendAssistant(tmp, sessionId, "Bonjour Alex.")
    appendUser(tmp, sessionId, "appelle-moi Bob")

    const current = recallName(tmp, sessionId)
    assertTopIdentityFact(current.results[0], "Bob")
    assert.doesNotMatch(itemText(current.results[0]), /\bAlex\b/i, "current identity recall must not return superseded Alex as truth")

    const history = recallSessionMemory({
        cwd: tmp,
        sessionId,
        query: "Alex user.name history",
        profile: "focused",
        limit: 10
    })
    const old = history.results.find((item) => /\bAlex\b/i.test(itemText(item)))
    const oldMeta = old as (SessionMemoryRecallItem & {
        status?: string
        profile_fact?: { status?: string }
    }) | undefined
    assert.ok(old, "superseded Alex fact should remain visible in history recall")
    assert.equal(oldMeta?.profile_fact?.status ?? oldMeta?.status ?? oldMeta?.tags.includes("superseded"), "superseded")
})

test("AXMEM identity D — incidental jokes do not become high-confidence profile facts", () => {
    const tmp = freshStore("false-extraction")
    const sessionId = "identity-oracle-d"
    appendUser(tmp, sessionId, "Blague: dans mon roman, un personnage nommé Alex dit bonjour. Ce n'est pas mon nom.")
    appendUser(tmp, sessionId, "Peut-être que le robot s'appelle Bob, pas moi.")

    const index = readSessionMemoryIndex(tmp, sessionId)
    const activeProfileFacts = index.entries.filter((entry) =>
        (entry.kind === "profile_fact" || entry.tags.includes("profile")) &&
        (entry as typeof entry & { profile_fact?: { status?: string } }).profile_fact?.status !== "superseded"
    )
    assert.deepEqual(activeProfileFacts, [])
})

test("AXMEM identity teeth — real session recall kills profile and question mutations", () => {
    const tmp = freshStore("mutations")
    const sessionId = "identity-oracle-mutations"
    appendUser(tmp, sessionId, "Bonjour, je m'appelle Alex")
    appendAssistant(tmp, sessionId, "Question répétée: quel est mon nom ?")
    appendUser(tmp, sessionId, "quel est mon nom ?")

    assert.equal(identityOraclePasses(tmp, sessionId), true)
    withAxmemMutation("ignore_profile_boost", () => {
        assert.equal(identityOraclePasses(tmp, sessionId), false, "ignore_profile_boost survived the identity benchmark")
    })
    withAxmemMutation("allow_question_echo", () => {
        assert.equal(identityOraclePasses(tmp, sessionId), false, "allow_question_echo survived the identity benchmark")
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
