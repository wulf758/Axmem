# AXMEM

AXMEM is a local-first memory runtime for AI agents.

It gives agents a shared, durable memory that lives on disk, works from a plain CLI, and stays readable enough to audit. An agent can write compact `.axmem` cards during work, recall the most relevant cards later, and hand off state to another agent without relying on a proprietary memory silo.

The core rule is simple:

> AXMEM orients. Source files, primary evidence, and tests prove.

AXMEM is not a truth oracle. It is a compact, provenance-aware working memory that helps an agent start from the right context, avoid repeated dead ends, and recover important decisions after context loss.

## Why AXMEM exists

Modern coding agents lose context constantly. A long session gets compressed, a new model enters cold, or a different tool has no access to yesterday's discoveries. Most agent memory systems also live inside one product, so memory written by one agent is not naturally available to another.

AXMEM targets that gap:

- **Shared memory for heterogeneous agents**: any agent that can run a shell can use the same memory store.
- **Local-first storage**: memory is stored in project folders or a local registry, not a remote service.
- **Compact recall**: agents get bounded cards first, then hydrate exact evidence only when needed.
- **Deterministic ranking**: recall order should be stable for the same store and query.
- **Provenance and invalidation**: cards can preserve what was tried, what was wrong, and why it was superseded.
- **Public, inspectable format**: `.axmem` packs are compressed JSON with a readable index beside them.

## What AXMEM stores

An AXMEM card is a compressed pack with structured fields:

- task id, title, tags, and timestamps
- compact summary and resume prompt
- decisions and next actions
- command evidence and status
- semantic references such as files, modules, docs, or commands
- invalidated hypotheses: beliefs that were tested and found wrong
- graph nodes and anchors for related concepts
- optional session/profile facts for identity and preference recall

The index keeps bounded previews and ranking hints so an agent can recall a small card without inflating the full pack.

## How recall works

AXMEM recall is tiered:

1. **Index recall** returns compact cards quickly.
2. **Search-store recall** can use an inverted/vector-backed store for larger memories.
3. **Focused/full recall** hydrates pack-backed details on demand.
4. **Session recall** restores recent interaction facts and profile facts.
5. **Working windows** combine recent session state, active cards, breadcrumbs, and an explicit recall tool spec.

The default `ultra` profile is intentionally small. It is meant for cold starts and automatic injection. Use `focused` or `full` when the agent needs more detail.

## Status

AXMEM is currently a beta extraction from the Axiom project.

The current repo includes:

- a standalone TypeScript library
- a CLI binary named `axmem`
- compatibility with legacy `.axiom/memory` stores
- migration from Axiom layout to standalone layout
- Codex skill and Claude Code instructions
- synthetic public tests for recall, soundness, profile facts, search-store, vector rerank, tiering, and working windows

The pack schema currently keeps the historical `axiom.agent_memory_*` names for compatibility. That is intentional.

## Install

Install the current public beta directly from GitHub:

```bash
npm install -g https://github.com/wulf758/Axmem/archive/refs/tags/v0.1.0-beta.5.tar.gz
axmem --help
```

After the npm package is published, the shorter install is:

```bash
npm install -g @wulf758/axmem
axmem --help
```

For source development:

```bash
git clone https://github.com/wulf758/Axmem.git
cd Axmem
npm install
npm run build
node dist/cli.js --help
```

During local development, use:

```bash
node dist/cli.js <command>
```

## Quick start

Create a quick handoff card:

```bash
axmem ingest --quick \
  --task parser-handoff \
  --summary "The parser migration is blocked on source-map tests" \
  --tag handoff
```

Recall it later:

```bash
axmem recall --query "parser migration source-map" --profile ultra
```

Ask for a richer explanation of why cards ranked where they did:

```bash
axmem recall \
  --query "parser migration source-map" \
  --profile focused \
  --explain-score
```

Write a lightweight end-of-session handoff:

```bash
axmem handoff \
  --summary "Recall parser-handoff before touching parser code"
```

For compatibility with agents trained on Axiom, this also works:

```bash
axmem memory recall --query "parser migration"
```

## Storage layout

Standalone AXMEM writes to:

```text
.axmem/memory/
```

Legacy Axiom memory lives under:

```text
.axiom/memory/
```

Use `--layout` to choose the active store:

```bash
axmem recall --layout standalone --query "..."
axmem recall --layout axiom --query "..."
axmem recall --layout auto --query "..."
```

`auto` prefers an existing `.axmem/memory` store, then an existing `.axiom/memory` store, and creates new standalone stores under `.axmem/memory`.

To copy a legacy Axiom store into the standalone layout:

```bash
axmem migrate --from-axiom --json
```

## Core commands

```bash
axmem ingest --quick --summary "..." --task task-id
axmem handoff --summary "..."
axmem update --task task-id --append-decision "..."
axmem recall --query "..." --profile ultra
axmem recall --task task-id --profile full --include-evidence
axmem delete --task task-id --dry-run
axmem reindex
axmem search-store build
axmem session append --kind note --summary "..." --text "..."
axmem session recall --query "..."
axmem window --query "..." --token-budget 50000
axmem migrate --from-axiom
```

## Library API

```ts
import {
  ingestMemoryPack,
  recallMemory,
  appendSessionMemory,
  buildMemoryWorkingWindow,
  setAxmemContextProvider,
  validateMemoryPack
} from "@wulf758/axmem"
```

Example:

```ts
import { ingestMemoryPack, recallMemory } from "@wulf758/axmem"

ingestMemoryPack({
  cwd: process.cwd(),
  taskId: "runtime-handoff",
  title: "Runtime handoff",
  tags: ["handoff", "runtime"],
  document: {
    summary: "The runtime tests pass, but search-store rebuild still needs review.",
    decisions: ["Keep recall deterministic after vector candidate generation."],
    next_actions: ["Run npm test before changing scoreEntry."]
  }
})

const result = recallMemory({
  cwd: process.cwd(),
  query: "runtime search-store deterministic recall",
  profile: "ultra"
})

console.log(result.results[0]?.title)
```

Integrations can provide project context, history, and session logs with:

```ts
import { setAxmemContextProvider } from "@wulf758/axmem"

setAxmemContextProvider({
  readContext: (cwd) => undefined,
  readContextHistory: (cwd) => ({ schema: "axiom.context_history.v0", entries: [] }),
  readSessionLog: (cwd) => []
})
```

The default provider is empty, which keeps AXMEM standalone.

## Agent setup

AXMEM includes local agent instructions for Codex and Claude Code.

Install the Codex skill:

```powershell
npm run install:codex-skill
```

Verify agent assets:

```powershell
npm run verify:agent-assets
```

Claude Code reads `CLAUDE.md` at the repository root and can use helpers in:

```text
.claude/commands/
```

Included Claude commands:

- `/axmem-recall <query>`
- `/axmem-handoff <summary>`
- `/axmem-ingest <summary>`

See `docs/agent-setup.md` for details.

## Testing

Run the full suite:

```bash
npm test
```

The suite covers:

- pack round-trip and validation
- deterministic recall
- trust and invalidated hypotheses
- recall quality gates
- ranking mutation teeth
- search-store behavior
- vector candidate rerank
- profile facts and supersede
- session memory
- tiering and working windows
- standalone/legacy layout compatibility
- CLI migration and alias behavior

Some future indexing targets may be marked as TODO diagnostics, such as accent folding and light morphology. They are tracked without failing the suite.

## Public hygiene

Do not commit real memory stores or packs:

```text
.axmem/
.axiom/
*.axmem
```

They may contain private task history, command output, profile facts, or agent notes.

This repository should only include synthetic examples and generated-at-test-time fixtures.

Useful checks before publishing:

```bash
rg --files -g ".axmem/**" -g ".axiom/**" -g "*.axmem"
rg -n "C:\\Users|Desktop|private|secret|token" README.md docs src examples package.json package-lock.json
```

## Design principles

- **Local first**: no service is required to read or write memory.
- **CLI first**: every agent can participate through shell commands.
- **Bounded by default**: recall should not flood a small context window.
- **Hydrate on demand**: exact evidence is available, but not injected blindly.
- **Deterministic**: ranking and rerank behavior must be stable.
- **Conservative**: absence of a fact is better than a false fact.
- **Auditable**: memory should preserve provenance, including disproved hypotheses.

## License

MIT.
