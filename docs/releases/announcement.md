# Bearing Lite public lifecycle alignment

This announcement describes the public Bearing Delivery Lifecycle now
documented in the README, specification, and process diagrams. It is not a
GitHub release, npm publication, or tag.

## What changed in the public story

- One input-to-evidence lifecycle: Intake → Architectural Alignment → Scope
  Definition → Planning and Design, then bounded implementation and
  independent assessment.
- Persistent configuration is `profiles.json`. `onboard-bearing` asks one
  setting at a time.
- One Integration Engineer role with planning and execution sessions. One
  Test Engineer role with planning and assurance sessions.
- The Definition of Done Manifest replaces `review.html` as the human
  projection of planned versus actual work.
- Native wait/status checks are advisory. Duplicate dispatch stays
  prohibited.

Host package contracts, Copilot discovery, and Muse skill validation remain
the package-compatibility workstream. This announcement does not claim a
new published version.

## What this announcement does not do

It does not close issues, publish npm, create a git tag, or alter GitHub
contributor graphs.
