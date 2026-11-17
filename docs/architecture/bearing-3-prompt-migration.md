# Prompt compiler migration

Observer: Implementer, slice S08, 2026-11-17. Base revision: bearing-lite `12bd16e`. This plan covers delivery of the handoff compiler beside the existing Prompt skill. It does not switch the default.

Maintenance owner: bearing-lite maintainers. Update this plan when a promotion record changes the default handoff path or a host adapter's skill package changes.

## Current default

`skills/prompt/SKILL.md` remains the handoff composer. Its seven-section packet template is unchanged. The compiler is an additional tool, `tools/compile-handoff.mjs`. Adoption that would make the compiler the default waits for the promotion rule (DEC-07) to record promote on the replay workload. This slice does not record promote.

A compiled packet uses the same seven titles in the same order: `ROLE / SESSION`, `STATE / INPUTS`, `OBJECTIVE / ACCEPTANCE`, `AUTHORITY`, `LOOP`, `VERIFY`, `RETURN / STOP`. A host that already shows the Prompt template can show the compiled `text` without a new section order.

## Host adapters

The compiler does not edit hook maps, plugin layout, or skill install paths. Compatibility is "skills stay where they are; the default composer stays the Prompt skill."

| Host | Skill package today | This slice |
| --- | --- | --- |
| Claude Code | plugin skills; `hooks/hooks.json` maps Claude Code and Codex | no change |
| Codex | same plugin skills and `hooks/hooks.json` | no change |
| Cursor | plugin skills; `hooks/com.cursor/hooks.json` | no change |
| Copilot | plugin skills; `com.github.copilot/hooks/hooks.json` | no change |
| Grok | not an advertised client (`docs/harness-compatibility.md`) | no skill package to migrate |
| Kimi | not an advertised client (`docs/harness-compatibility.md`) | no skill package to migrate |

Qwen Code is in that same non-advertised group. It is not a seventh adapter in the acceptance list. No row above gains a compiler-specific install step.

## Rollback

Keep calling the Prompt skill template. Do not select `tools/compile-handoff.mjs` as the default. Because this slice never edits `skills/prompt/SKILL.md` or a host adapter, rollback does not restore a skill file or a hook map. Removing the compiler and `schemas/handoff.schema.json` leaves the Prompt path as it was.
