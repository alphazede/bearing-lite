# `te-hook` fixtures

Synthetic **stdin envelopes only**, for
`CMD-LITE-TE-HOOK-TEST` (`test/te-hook-contract.test.mjs`).

An envelope carries the host event shape and nothing else. It is not a
passing token: it grants no capability, no handoff, no completion receipt,
no assignment, and no verdict. Trusted assignment comes from the
coordinator-authored plan in the workspace, and candidate state comes from
the real Git checkout — never from these files.

`"cwd"` is the literal placeholder `__WORKSPACE__`. The test replaces it
with a real temporary workspace before the envelope reaches the adapter.

No private identity, no repository secret, and no HQ method text is stored
here.
