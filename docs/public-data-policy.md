# Public data policy

The repository must never include real local memory stores:

- `.axmem/`
- `.axiom/`
- `*.axmem`
- global registries copied from a user machine

Use synthetic cards under `examples/` and test fixtures generated at runtime.
