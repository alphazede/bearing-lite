# Planning and Design allocation inputs

Planning and Design allocates requirement rows against the Systems Modeler
placement receipt (current flow, candidate placements with `file:line`,
constraints) whenever that role is selected or required. The placement
receipt is an input to allocation.

1. Before the first register draft, consume the contextual-pass placement
   receipt. Allocate each row against a candidate placement from that
   receipt; the pass-1 return cites the placement receipt.
2. If the Systems Modeler is unavailable, record a typed gap
   (`NEEDS_OWNER_DECISION` naming the missing placement receipt) instead
   of allocating silently.
3. Relationship mappings are still finalized only after the Requirements Engineer passes.
