# How PLOP Fits the ENS Pool Prize

PLOP integrates ENS at the core of its trading flow. Every session is represented by a randomized ENS subname, and the resolver stores key session metadata via text records:

- `plop.active`
- `plop.pairs`
- `plop.receipts`

It also stores encrypted settlement instructions in:

- `plop.settlement`

This makes ENS the coordination layer for order flow, authorization, and receipts — not just a name registry.

This is a concrete, functional ENS integration (live on Sepolia) that is required for the system to operate, so it clearly qualifies for the ENS pool prize.
