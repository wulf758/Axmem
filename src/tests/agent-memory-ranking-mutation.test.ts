// AXMEM ranking mutation teeth — Phase 1/A4.
//
// This test does not reimplement ranking. Each mutation is an env-gated break in
// the true memory runtime, and the oracle is the real recall benchmark.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
    assertAxmemBenchmarkGate,
    axmemBenchmarkGatePassed,
    evaluateAxmemBenchmark,
    seedAxmemBenchmarkStore
} from "./agent-memory-benchmark-fixture"

const RANKING_MUTATIONS = [
    "ignore_score_hints",
    "ignore_query_terms",
    "drop_invalidated_penalty",
    "random_order"
]

function freshStore(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `axmem-mutation-${label}-`))
}

test("AXMEM A4 — real recall benchmark kills env-gated ranking mutations", () => {
    const tmp = freshStore("teeth")
    seedAxmemBenchmarkStore(tmp)

    withAxmemMutation(undefined, () => {
        assertAxmemBenchmarkGate(evaluateAxmemBenchmark(tmp))
    })

    for (const mutation of RANKING_MUTATIONS) {
        withAxmemMutation(mutation, () => {
            const report = evaluateAxmemBenchmark(tmp)
            assert.equal(
                axmemBenchmarkGatePassed(report),
                false,
                `${mutation} survived AXMEM recall benchmark: ${JSON.stringify(report.results.filter((item) => !item.passed), null, 2)}`
            )
        })
    }
})

function withAxmemMutation<T>(mutation: string | undefined, run: () => T): T {
    const previous = process.env.AXIOM_AXMEM_MUTATE
    if (mutation) {
        process.env.AXIOM_AXMEM_MUTATE = mutation
    } else {
        delete process.env.AXIOM_AXMEM_MUTATE
    }

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
