# Optional pilots: turn off or remove

Bearing Lite has four opt-in pilots. Each one is off unless you request it.
Ordinary commands keep their output when a pilot is off, missing or removed;
`test/pilot-removal.test.mjs` checks this. The npm package does not ship
`docs/guides/`, so read these guides in the repository.

| Pilot | Turn off and remove |
| --- | --- |
| Code Mode | [Turn the pilot on or off](code-mode.md#turn-the-pilot-on-or-off) and [Remove the pilot](code-mode.md#remove-the-pilot) |
| Plannotator owner review | [Turn off or remove](plannotator-review.md#turn-off-or-remove) |
| Visual Definition of Done Manifest | See below |
| Review change outline and measured repair loop | See below |

## Visual Definition of Done Manifest

- To turn it off, run `node tools/render-dod-manifest.mjs <implementation.json>`
  without `--visual`. The default Manifest output is unchanged.
- The visual view is a separate `-visual.html` file next to the Manifest.
  Keep the default Manifest. Keep a visual file that a frozen review or
  evidence record cites.
- The visual renderer lives in `tools/render-dod-manifest.mjs` with the
  default renderer. To remove it, restore that file from the previous
  release and leave the other files unchanged.

## Review change outline and measured repair loop

- To turn them off, do not request a change outline in a review packet, and
  do not opt a packet in to the measured repair loop.
- To remove them, delete the "Change outline" section of
  `skills/reviewer/references/optional-techniques.md` and the "Measured
  repair loop" section of `skills/bearing-lite/references/wave-operations.md`.
  Leave the other sections of both files unchanged.
