# Bearing Lite global defaults

Store the user-owned copy at
`~/.agents/bearing-lite/default-role-lineup.md`. The Router displays it before
implementation and asks whether it is good for the current Journey. Never fill
agent, model, or reasoning values on the user's behalf.

```markdown
review_cadence: at-end

| Role | Primary agent/harness | Primary model | Primary reasoning | Fallback agent/harness | Fallback model | Fallback reasoning |
| --- | --- | --- | --- | --- | --- | --- |
| Router | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET |
| Explorer | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET |
| Crewmate | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET |
| Test Engineer | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET |
| Scribe | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET |
| Plan Integrator | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET |
| Systems Modeler | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET |
| Integration Engineer | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET |
| Park Ranger | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET |
| Surveyor | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET | OWNER_TO_SET |
```

Navigator is not a normal lineup role. Existing plans that still assign it use
the Navigator compatibility diagnostic; treat the assignment as unused.
Validator is not a normal lineup role. Existing plans that still assign it use
the Validator compatibility diagnostic; treat the assignment as unused.

Journey artifacts copy the confirmed values and mark named instances active,
standby, or unused. Only verified primary unavailability activates its approved
fallback. If both are unavailable, return `OWNER_DECISION_REQUIRED`.
