# Antigravity CLI plugin

## Install

Use a Bearing Lite checkout, Node.js with npm, and Antigravity CLI (`agy`).
Close active Antigravity sessions before replacing an installed plugin. They
resolve hook commands from the installed plugin directory throughout the session.

Stage the npm payload and overlay Antigravity's `plugin.json`. The staging
directory contains copies of the skills and hooks alongside the manifest.

```sh
cd /path/to/bearing-lite
(
  set -eu
  stage=$(mktemp -d)
  trap 'rm -rf -- "$stage"' EXIT
  archive=$(npm pack --ignore-scripts --pack-destination "$stage")
  tar -xzf "$stage/$archive" -C "$stage"
  cp .agy/plugin.json "$stage/package/plugin.json"
  agy plugin validate "$stage/package"
  agy plugin install "$stage/package"
  agy plugin enable bearing-lite
)
```

Validation should report seven hook registrations. Antigravity runs the
relative commands in root `hooks.json` from the installed plugin directory.
See the [compatibility matrix](../docs/harness-compatibility.md#capability-matrix).
