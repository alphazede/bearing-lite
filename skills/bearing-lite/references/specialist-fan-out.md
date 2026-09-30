# Specialist fan-out

A specialist session whose objective holds independent questions may split
them into up to N child sessions of the same role, one per question. N is a
packet-declared bound: the lead packet states it.

Each child gets its own prompt-skill packet, its own write directory, only
its own inputs, and a time budget: stop starting new work at T minus 5 and
write the result. Write directories must be distinct. Every specialist
packet carries a session time budget and a per-external-call bound smaller
than the remaining session time.

Children hold the lead's authority: they cannot select models, cannot write
outside their directory, and stop only through their own session handle.

The lead only launches the children, waits for them, and merges their typed
returns into one artifact, typing any missing answer INSUFFICIENT. It adds
no findings beyond the merge.

Children run under the lead's frozen route and count as one specialist
dispatch, not extra reviewer or assurance rounds.

The Orchestrator receipt lists each child with question, route, runtime,
and outcome.
