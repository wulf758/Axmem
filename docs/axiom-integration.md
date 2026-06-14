# Axiom integration

Axiom can keep `axiom memory ...` as a facade over the standalone AXMEM package.

Recommended adapter shape:

```ts
import { setAxmemContextProvider } from "@wulf758/axmem"
import { readContext, readContextHistory, readSessionLog } from "./agent/context"

setAxmemContextProvider({ readContext, readContextHistory, readSessionLog })
```

Then route existing Axiom memory subcommands to the same exported AXMEM functions. The pack schema remains compatible with existing `.axiom/memory/*.axmem` files.
