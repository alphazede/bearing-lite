# Named lineup catalog

Candidate procedure for the user-owned JSON catalog. It is not a staged
lineup or route-review gate. Selection is not an authority grant.

## Location

The live user catalog is exactly one file:

`<absolute home>/.agents/bearing-lite/lineups.json`

Resolve `<absolute home>` as a nonempty absolute `HOME`, else a nonempty
absolute `USERPROFILE` on its platform; otherwise fail closed with
`home_unresolved`. Do not use cwd, the package root, XDG, a relative
`lineups.json`, or a second search root.

The packaged catalog is package-root `lineups.json`. Never read it as user
data. Never write the packaged catalog, including resolved symlink aliases
of that file.

Missing user file means no named profiles. Do not auto-create the live
catalog. An empty `lineups` object is valid and is not an error. A
malformed unused catalog cannot override explicit inline owner choices.

## Configurable roles

Catalog entries assign Explorer, Crewmate, Light Implementer, Test Engineer,
Scribe, Plan Integrator, Systems Modeler, Integration Engineer, Requirements
Engineer, Park Ranger, and Surveyor. The Light Implementer takes only slices
whose `work_class` is `light` (criteria in `skills/light-implementer`); it
has its own primary and fallbacks, usually a lighter and cheaper route. Navigator and Validator are not lineup roles;
existing plans that still assign them use the compatibility diagnostics and
treat the assignment as unused. Never fill agent, model, or reasoning values
on the user's behalf. `review_cadence` is `at-end`.

The Router is not a configurable role: it is whatever session is running
planning. The Journey snapshot records the observed Router identity
(harness, model, reasoning at that time). A catalog or snapshot entry with
`role: Router` is ignored with the typed note `router_row_ignored`; it is
never a deviation.

Only verified primary unavailability activates its approved fallback. If
both are unavailable, return `OWNER_DECISION_REQUIRED`.
Activation within the frozen ordered fallbacks is a dated execution receipt,
not a lineup amendment or a new owner approval. Verify the approved activation
condition and remaining eligible routes before escalating exhaustion. A new
identity or changed fallback condition requires an owner amendment; follow
`owner-stops.md` for classification and batching.

This catalog is the single lineup source. A legacy
`~/.agents/bearing-lite/default-role-lineup.md` is never read or created;
when one is present it is ignored with the typed note
`legacy_lineup_md_ignored`. A missing catalog returns the typed outcome
`no_named_profiles` and an inline-selection prompt.

## Validity

Named selection and save require a valid catalog. Bind
`schemas/lineups.schema.json` Draft 2020-12 validation before named
selection or save. That schema is the validation document, not a second
search root for user data. Do not add a runtime catalog library.

On load and on save, inspect raw object members first. Reject duplicate
raw JSON keys; do not silently collapse. Then parse and apply Draft 2020-12
validation against package-root `schemas/lineups.schema.json`. Fail closed
as follows even when the schema cannot express the check:

- Reject duplicate role assignments within each phase.
- Reject ASCII case-fold collisions on both load and save. Do not trim
  or case-fold names.
- Defaults keys must resolve exactly. Unresolved defaults fail closed.
- Invalid structure or name fails closed on both load and save.

Refuse named selection or save on any of those failures. Do not invent a
fallback profile and do not read packaged bytes as user data.

## Selection

Explicit inline owner choices require no catalog lookup and no extra
confirmation. Consume them as already explicit.

A named choice needs a valid catalog and an exact selected key. Do not trim
or case-fold the name. Independent planning and implementation selections
remain separate; the owner may pick two names, one name twice, or inline on
either side.

Optional user `defaults.planning` and `defaults.implementation` are
recommendations requiring selection or confirmation. They are never a silent
grant and not an authority grant. Do not apply them without that
confirmation. Do not invent a packaged default.

Copy selected entries into the Journey snapshot as a frozen snapshot copy.
Preserve fallback array order. Bind a SHA-256 configuration digest of that
frozen snapshot copy. Digest that copy only: selected entries with fallback
order and selection sources. Exclude N/K/C, review cadence, route, and
authority. Canonical JSON: UTF-8, sort_keys, compact separators.
Later catalog edits do not mutate the frozen snapshot copy or its digest.

## Save

Save only on explicit owner request. Never save this Journey as a side
effect of selection, freeze, or routing.

Create versus replace: if replace is already explicit, do not ask again;
otherwise preview the selected-entry replacement and confirm. Create must
not overwrite an existing exact key. Replace updates only that key.

Preserve unrelated valid keys and defaults. Refuse changed-input overwrite.
Use a safe atomic update (sibling temp file, then rename).

Do not write N/K/C, review cadence, route, or authority into catalog
entries.
