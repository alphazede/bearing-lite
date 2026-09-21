# AGY plugin root

Antigravity CLI (`agy`) requires a root `plugin.json` with only `name` and
`description`. The portable Agent Plugins manifest at the repository root
cannot satisfy that schema, so this directory is the AGY install root.

AGY is a skills-only host: it has no verified SessionStart/Stop mapping, so
hooks stay procedural.

## Install

`agy` reads the catalog from `skills/` next to its `plugin.json`, so link the
portable catalog into this directory first:

```sh
cd /path/to/bearing-lite
ln -s ../skills .agy/skills
agy plugin install "$PWD/.agy"
agy plugin enable bearing-lite
```

The link is deliberately **not** committed. A symlink tracked in the
repository makes the whole tree unusable to hosts that install from git and
reject symlink entries — Muse Code refuses the marketplace outright with
`plugin contains symlink entries and cannot be installed`. Creating it at
install time keeps every other host working.

`.agy/` is not part of the published npm package (`@alphazede/bearing-lite`);
npm consumers get the portable root manifest and `skills/` directly.
