---
name: axmem
description: >-
  MUST use for tasks involving AXMEM, .axmem files, .axmem/memory stores,
  agent memory recall, handoff cards, session memory, profile facts, memory
  search-store/vector recall, working windows, or integrating AXMEM into another
  agent/repository. Local AXMEM files and this repository are the source of
  truth; memory orients, source/evidence proves.
metadata:
  short-description: Local-first AXMEM workflow for agent memory
---

# AXMEM

Use this skill whenever the task involves AXMEM, `.axmem` packs, `.axmem/memory`,
legacy `.axiom/memory` compatibility, agent memory recall, session memory,
profile facts, working windows, or AXMEM integration into another tool.

## First Checks

1. Inspect local signals before broad reading or web search:

```bash
rg --files -g "*.axmem" -g ".axmem/**" -g ".axiom/memory/**" -g "CLAUDE.md" -g "README.md" -g "package.json"
```

2. Identify the runnable CLI:

```bash
npm run build
node dist/cli.js --help
```

3. Before non-trivial work, recall relevant local memory if a store exists:

```bash
node dist/cli.js recall --query "short task description" --profile ultra
node dist/cli.js recall --query "short task description" --profile focused --explain-score
```

If the project only has legacy Axiom memory, use:

```bash
node dist/cli.js recall --layout axiom --query "short task description" --profile ultra
```

## Core Rules

- AXMEM orients; source files, primary evidence, tests, and exact packs prove.
- Never commit real `.axmem/`, `.axiom/`, or `*.axmem` memory stores.
- Keep the pack format compatible unless the task explicitly asks for a breaking migration.
- Preserve deterministic recall. Random ordering in recall/rerank is a bug.
- Do not weaken senior/oracle tests to make a ranker change pass.
- Mutation teeth matter: if a mutation is supposed to be killed, verify the real runtime path fails under that mutation.

## Common Commands

```bash
npm test
node dist/cli.js ingest --quick --summary "..." --task task-id --tag handoff
node dist/cli.js handoff --summary "..." --task handoff-YYYY-MM-DD
node dist/cli.js recall --query "..." --profile ultra --json
node dist/cli.js recall --query "..." --profile focused --explain-score
node dist/cli.js session append --kind note --summary "..." --text "..."
node dist/cli.js session recall --query "..." --profile ultra
node dist/cli.js migrate --from-axiom --json
```

## Change Discipline

For runtime changes:

1. Add or preserve an oracle first.
2. Make the smallest runtime change that moves the oracle.
3. Run `npm test`.
4. Run a targeted recall manually when ranking behavior changed.
5. Write a handoff card when the state should survive context loss.

For public repo hygiene:

```bash
rg --files -g ".axmem/**" -g ".axiom/**" -g "*.axmem"
rg -n "C:\\Users|Desktop|real AXMEM|personal|private" README.md docs src examples package.json package-lock.json
```

The first command should find no tracked public data stores.
