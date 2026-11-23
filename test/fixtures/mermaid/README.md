# Mermaid view fixtures (issue #271)

`flowchart.mmdc.svg` and `state.mmdc.svg` are trimmed `mmdc` 12.2.0 renders of
`flowchart.mmd` and `state.mmd`. They used the helper's settings: default
theme, `htmlLabels: false` and `deterministicIds: true`. The trim kept the
root element, the label and node markup, one marker, the `@keyframes` rules
and the id-scoped colour rules. It dropped unused markers and stylesheet
rules, and it shortened one long end-state path. `fake-mmdc.mjs` returns one
of these files in place of a browser render, so the default test run covers
the helper and the Manifest embedding without `mmdc` installed.
