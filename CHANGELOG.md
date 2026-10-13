# Changelog

## Unreleased

- Fix `tools/render-dod-manifest.mjs` exiting 0 without output when invoked through a symlinked install path; symlinked directory and file invocations now behave identically to the real path ([#182](https://github.com/alphazede/bearing-lite/issues/182)).
