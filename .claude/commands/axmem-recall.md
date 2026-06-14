---
description: Recall AXMEM cards relevant to the current task
argument-hint: <query>
---

Run AXMEM recall for the user query and use it only as orientation. Validate important claims against source files and tests.

```bash
node dist/cli.js recall --query "$ARGUMENTS" --profile ultra
```

If the ultra card is too thin, run:

```bash
node dist/cli.js recall --query "$ARGUMENTS" --profile focused --explain-score
```
