# AXMEM Claude Instructions

AXMEM is a local-first memory runtime for AI agents. Use it as orientation, not proof: source files, exact evidence, and tests remain authoritative.

## Start Of Task

- Run `npm run build` if `dist/` is missing or stale.
- If a memory store exists, recall before broad exploration:

```bash
node dist/cli.js recall --query "<task>" --profile ultra
```

- Use `--layout axiom` only when working with a legacy `.axiom/memory` store.

## Work Rules

- Do not commit `.axmem/`, `.axiom/`, or `*.axmem` packs.
- Do not weaken recall or mutation tests to make implementation pass.
- Deterministic ranker behavior is a soundness constraint.
- For ranker changes, keep a before/after measurement and run the mutation teeth.
- For profile facts, extract only explicit user statements; prefer no fact over a false fact.
- For public hygiene, keep examples synthetic.

## Useful Commands

```bash
npm test
node dist/cli.js recall --query "..." --profile ultra --json
node dist/cli.js recall --query "..." --profile focused --explain-score
node dist/cli.js ingest --quick --summary "..." --task task-id --tag handoff
node dist/cli.js handoff --summary "..." --task handoff-YYYY-MM-DD
node dist/cli.js migrate --from-axiom --json
```

## Handoff

Before ending substantial work, write a handoff card:

```bash
node dist/cli.js handoff --summary "What changed, tests run, and next action" --tag handoff
```
