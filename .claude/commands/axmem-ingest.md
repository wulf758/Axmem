---
description: Ingest a quick AXMEM memory card
argument-hint: <summary>
---

Create a durable quick card from the summary below. Choose a short kebab-case task id from the summary, then run:

```bash
node dist/cli.js ingest --quick --task "<task-id>" --summary "$ARGUMENTS" --tag handoff
```

Keep the summary factual and compact. Do not ingest secrets or private raw logs.
