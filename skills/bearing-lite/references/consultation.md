# Consultation

Specialist consultation is allowed only when the frozen profile and authority
preauthorize it and name the consultant. The Orchestrator preselects and
dispatches that consultant. The assigned agent may request and receive bounded
advice. Ownership, model route and review identity stay unchanged. Without
that preauthorization, no consultation is recorded.

## Return

The consultant does not choose itself. The return is compact structured
guidance addressed to the original agent: an addressee of `original_agent`
and bounded guidance text. It carries no dispatch, route, model, harness,
write set, or ownership field.

Ownership stays with the original agent and the Orchestrator. Consultation
does not transfer orchestration ownership, model route, or review identity,
and it is not a new implementation attempt or review round.

## Fellow

Only the Orchestrator consults the Fellow, through the Bearing-level `fellow`
route defined at the top level of `profiles.json` and copied unchanged into
every frozen binding (`snapshot.fellow`), whatever profile is selected. If the
catalog omits `fellow`, `snapshot.fellow` is absent and the Orchestrator
proceeds without Fellow consultation. The Orchestrator keeps the final call.
The owner supplies its route. To configure it, use
[onboard-bearing](../../onboard-bearing/SKILL.md).

Consult at four checkpoints: before a major decision, with options and a
leaning already in hand; when stuck after two genuine attempts, on unexplained
behaviour, or before a workaround such as a retry loop, sleep, broad catch,
skipped test or disabled check; before declaring a task done; and when the
owner asks.

The briefing includes the owner request verbatim, history, evidence verbatim
with trims marked, current state, questions, options and the leaning. It
carries no secrets.

The Fellow returns a verdict and compact guidance. It does not edit files and
does not take the final call.

About four consultations per task. More than four means split the task or ask
the owner. Within one Lifecycle, resume that Lifecycle's Fellow session.
