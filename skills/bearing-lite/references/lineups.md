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
malformed or unreadable unused catalog fails closed and cannot override
explicit inline owner choices.

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

Copy selected entries into the Journey snapshot. Preserve fallback array
order. Later catalog edits do not mutate a frozen snapshot.

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
