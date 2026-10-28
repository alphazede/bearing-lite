# Contributing to Bearing Lite

## Provider-neutral public artifacts

Packaged skills, hooks, manifests, and documentation must never require,
select, recommend, or silently substitute a concrete agent, model, provider,
or private harness alias for a role. Public guidance declares capabilities and
independence requirements; the owner or compatible client maps available
agents to those requirements. Client names may appear only to document a
client-specific compatibility surface, never as a required implementation,
coordination, fallback, or assurance route.

Qwen Code, Kimi Code, and Grok Build are no longer supported native clients.
Retained integration metadata is legacy-only and does not require release
smoke tests. Report untested clients as untested; never count absence as PASS.

Thanks for the interest. This page covers how the project works and what helps
most.

## How this repository works

Bearing Lite is developed directly as a public skills-first Agent Plugin. The
portable product surface is `plugin.json`, `skills/`, optional `hooks/`,
`profiles.json`, and the public governance documents. There is no CLI binary,
MCP server, browser control room, or hidden runtime state to maintain for
ordinary contributions.

Pull requests that stay inside that product boundary are welcome. Changes that
reintroduce deep-harness coupling, model or provider pins, secret material, or
private path spill will be declined.

The public lifecycle is Intake → Architectural Alignment and Scope →
Planning and Design, then bounded implementation and independent assessment.
Use those names. Do not reactivate retired camp terminology in active public
flow.

## Reporting a bug

Open a bug report and include the Bearing Lite version (or commit), how you
installed the plugin, your operating system, and which agent client you used.
If a skill returned a structured handoff or a hook emitted a typed diagnostic,
paste the sanitized text. Never include credentials, private repository
contents, or unredacted session evidence.

Never report a security problem in a public issue. Use the [private
vulnerability reporting
form](https://github.com/alphazede/bearing-lite/security/advisories/new).
[SECURITY.md](SECURITY.md) covers what to include and what to leave out.

## Proposing a change

Open a feature request that states the problem before the solution. Bearing
Lite is a bounded product: skills-first, provider-neutral, no telemetry, no
hosted service, and no agent that certifies its own work. A proposal that
crosses one of those lines is likely to be declined, and hearing that early
saves you the work.

## Working on the package

Useful local checks for documentation and contract tests (when present in the
checkout):

```sh
node --test test/public-boundary.test.mjs test/skills-conformance.test.mjs
node --test test/*.test.mjs
python3 test/schema-validation.py
node --test test/native/codex-hook-discovery.test.mjs
node --test test/native/assurance-dispatch.test.mjs
node hooks/write-set-check.cjs -- <paths the slice wrote>
```

The native Codex gate is required in CI and before publishing. The
`test/*.test.mjs` glob does not run it, so a passing default suite is not a
native pass. It needs Codex CLI 0.162.1 (`codex` on `PATH`, or set
`BEARING_CODEX_BIN`); a missing Codex fails the gate, it never skips. CI
installs that exact version as test-only tooling into a job-local prefix:

```sh
npm install --prefix "$RUNNER_TEMP/bearing-codex" --ignore-scripts --no-audit --no-fund @openai/codex@0.162.1
BEARING_CODEX_BIN="$RUNNER_TEMP/bearing-codex/node_modules/.bin/codex" \
  node --test test/native/codex-hook-discovery.test.mjs
```

The test uses a disposable `HOME`/`CODEX_HOME` and makes no model call. It
proves that Codex registers the hooks and skills of the artifact from
`tools/prepare-codex-plugin.mjs`; it does not prove a hook runs. Release smoke
must show a positive hook invocation plus an allowed and a denied write-lock
case.

`git diff --check` alone does not examine untracked files. `write-set-check.cjs`
is the write-set hygiene command: it inspects each named path, including newly
added ones, and fails if any path was omitted.

Schema validation requires Python 3.12 or 3.14, the two interpreters whose
`rpds-py` wheels are pinned and scanned. `python3 test/schema-validation.py` is
the required developer and CI gate (`CMD-LITE-SCHEMA-VALIDATE`). It installs the
pinned hashes from `test/schema-validator-requirements.txt` into an isolated
temporary directory with `pip install --isolated --require-hashes --no-deps` and
runs Draft 2020-12 validation with no remote `$ref` retrieval. Do not install
those packages globally, with `--user`, or as production dependencies of this
package.

CI on `ubuntu-24.04` with Python 3.12 x64 performs the same isolated
`--require-hashes --no-deps` install into a job-local target directory, then
runs `python3 test/schema-validation.py`. To reuse a local isolated tree instead
of a temporary install:

```sh
python3.12 -m venv .venv-schema-validator
.venv-schema-validator/bin/python -m pip install \
  --isolated --require-hashes --no-deps \
  -r test/schema-validator-requirements.txt
BEARING_LITE_SCHEMA_ISOLATED_ROOT=.venv-schema-validator/lib/python3.12/site-packages \
  python3 test/schema-validation.py
```

Keep that virtualenv uncommitted.

Keep skills lean. Prefer references and assets only when progressive disclosure
needs them. Role `SKILL.md` files stay within the enforced budget (60 lines,
650 words); move conditional detail into a linked reference instead of growing
the core skill. Do not add dependencies or change the lockfile without explicit
maintainer approval. Do not add `mcp.json`, postinstall scripts, or global hook
installers.

When you change a Mermaid diagram under the plan assets or skill references,
keep the paired PNG synchronized and preserve equivalent authoritative text
(for task state, `skills/bearing-lite/references/task-state.md`).

## What gets reviewed hardest

Anything touching authority boundaries, independent assurance, public data
spill, provider neutrality, hook fail-open versus integrity fail-closed
behavior, or skill activation contracts. Those are the product rather than
details of it, so expect questions and expect evidence that the change stays
inside the approved Lite surface.


The bound assurance native test installs the candidate in disposable config and
uses an owned loopback Responses driver plus harmless local launch sentinels.
It never uses credentials or a paid provider. Run it separately from the default
glob, with the release-pinned client where available; record a different version
as compatibility evidence, not pinned qualification. One owned bind(0) listener
is reused within the binary; expected cost is under 10 seconds, total deadline
90 seconds. Changed native tests require five consecutive runs and two
concurrent copies with no shared resources. Component replay is never native
host proof for Claude, Cursor or Copilot.
