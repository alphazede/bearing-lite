# Named correction loop

This is the Requirements Engineer correction loop, separate from the single
independent planning-review slot and implementation assurance budgets.
The Orchestrator owns dispatch and receipts; Planning and Design applies changes.

1. Freeze the complete before snapshot and candidate identity. Aggregate named
   findings to one per UID. Dispatch only those findings in a delta packet.
   An `exact_text` finding supplies the complete corrected statement verbatim
   and changes wording only; semantic, rationale, verification, allocation,
   glossary-definition, or reference changes are `requires_regate`.
2. Apply only the named findings. Copy exact text directly, without paraphrasing.
   Retain all other row fields. Export the complete after snapshot using the same
   projection as before; include every governed register, AC, and RISK row,
   every non-text field, and all outgoing reference targets. Do not hand-select
   changed rows or omit fields. Snapshot extraction belongs to the workspace;
   the plugin does not parse or persist a requirement register.
3. Run `node <plugin root>/hooks/correction-delta.cjs <input.json>`.
   The pure export is `evaluateCorrectionDelta(input)`. JSON input fields:
   - `candidate_ref`: nonempty identity of the frozen corrected candidate.
   - `before`, `after`: complete arrays of `{uid, text, references, ...fields}`;
     UID is globally unique, text is the statement, references is an array of UIDs.
   - `findings`: unique `{uid, finding_type, corrected_text?}` rows; corrected_text
     is mandatory for exact_text. The gate report supplies these, never the author.
   - `known_uids`: optional external-register reference targets, derived from the
     authoritative register; never synthesized to make a dangling reference pass.
   - `lint`: workspace-supplied `{verdict: "PASS" | "FAIL", candidate_ref, ...receipt}`
     over this corrected candidate; retain its command/output evidence. The plugin
     neither requires nor installs a lint tool. Missing, stale, or not-run lint
     prevents exact-text closure with `NEEDS_MORE_EVIDENCE`.
   - `correction_rounds`: spent requires_regate rounds, integer 0–2, default 0.
   - `residuals`: optional strings for the integrated owner gate.
4. Require changed UIDs to equal named UIDs (including additions/deletions).
   Any extra or unchanged named UID FAILS with `extra_uids` / `missing_uids`;
   do not relabel an extra change as a finding. Exact text must match verbatim
   with every non-text field unchanged. All after-snapshot references must resolve.
   A failed delta closes nothing: undo only this delta, report findings, and retry
   only with a new hypothesis, at most three mechanical application attempts.
5. Record the JSON mechanical verification receipt, including candidate identity,
   changed/named UID sets, cross-reference PASS, and external lint evidence.
   Close `closed_uids` without another Requirements Engineer gate in any round.
   `DELTA_APPLIED` means mechanical closure, never independent assurance or approval.
   Dispatch a re-gate only for `regate_uids` (`requires_regate`). A mixed delta
   closes exact-text rows first and spends one round for the remaining rows.
   `REQUIRES_REGATE` reserves that round; persist the returned count once, never
   increment again on gate return. Recheck dependent references mechanically;
   new semantic defects require new typed findings rather than silent corrections.
6. At two spent re-gate rounds, `NEEDS_OWNER_DECISION` preserves exact-text closures
   and names remaining regate_uids; follow owner-stops class C. Exact-text-only
   deltas still close mechanically. Preserve reported residuals (including any
   application failures) for the one integrated owner gate; never accept them silently.
   Re-embed artifact digests and run the normal package freeze before presentation.
