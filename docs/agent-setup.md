# Agent setup

AXMEM ships with local agent instructions for Codex and Claude Code.

## Codex skill

Install the skill into your Codex home:

```powershell
npm run install:codex-skill
```

The installer copies:

```text
.codex/skills/axmem/SKILL.md
```

to:

```text
$CODEX_HOME/skills/axmem
```

If `CODEX_HOME` is not set, it uses `$HOME/.codex`.

After installation, new Codex sessions can use the `axmem` skill for tasks involving `.axmem` packs, recall, handoff cards, session memory, or AXMEM integrations.

## Claude Code

Claude Code reads the root `CLAUDE.md` when opened in this repository.

Slash-command helpers are included under:

```text
.claude/commands/
```

Commands included:

- `/axmem-recall <query>`
- `/axmem-handoff <summary>`
- `/axmem-ingest <summary>`

## Verify assets

```powershell
npm run verify:agent-assets
```

This checks that the Codex skill, Claude instructions, and Claude command files are present.

## Public hygiene

Do not commit real memory stores:

```text
.axmem/
.axiom/
*.axmem
```

The agent instructions intentionally reinforce that AXMEM orients, while source files and evidence prove.
