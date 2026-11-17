# Prompt overhead audit and instruction classes

Observer: Implementer, slice S02, 2026-11-17. Source revision: bearing-lite `9fdf4d0`. This report records an inspection of prompt text. It does not change any skill.

Maintenance owner: bearing-lite maintainers. Update this report when `skills/prompt/` or a role skill it tells the agent to read changes.

## Lookup scope

The population was fixed before instances were marked. It is the Prompt skill, its role-loop index, and the role skills and references that those two files tell a composer or an agent to read:

- `skills/prompt/SKILL.md` (73 lines)
- `skills/prompt/references/role-loops.md` (64 lines)
- `skills/bearing-lite/SKILL.md` (59 lines)
- `skills/coordinator/SKILL.md` (59 lines)
- `skills/implementer/SKILL.md` (60 lines)
- `skills/planning-and-design/SKILL.md` (59 lines)
- references those skills name, listed under overlong context

Line counts are `wc -l` on `9fdf4d0`. No journey sample was measured. Token cost is unmeasured.

A category with no instance says `none found` and names the files searched.

## Categories

### Repeated instructions

The same duty is stated in more than one file the handoff causes the model to hold.

| Instance | Citations |
| --- | --- |
| Wait on a completion event, wake on the response, and do not poll | `skills/prompt/SKILL.md:49-50`; `skills/prompt/references/role-loops.md:63-64`; `skills/bearing-lite/SKILL.md:51-53`; `skills/coordinator/SKILL.md:50-53` |
| An evaluator reports and does not repair the candidate while evaluating | `skills/prompt/SKILL.md:47-48`; `skills/prompt/references/role-loops.md:12-13` |
| Return a compact receipt with verdict, candidate, changed paths, tests, findings, and blocker | `skills/prompt/SKILL.md:69`; `skills/coordinator/SKILL.md:57-58`; `skills/implementer/SKILL.md:56-57` |

### Model-authored mechanical packet assembly

| Instance | Citations |
| --- | --- |
| Every handoff is composed by a model. Steps 1 to 8 tell the model to fill one template. No compiler in this revision writes that packet. | `skills/prompt/SKILL.md:23-70` |

`none found` does not apply. Files searched: the population list above.

### Premature prescription of methods

| Instance | Citations |
| --- | --- |
| The handoff must include the selected role's full loop (method sequence) before the agent starts work | `skills/prompt/SKILL.md:45-48`; `skills/prompt/references/role-loops.md:17-32` |

The outcome sentence at `skills/prompt/SKILL.md:32-33` states the outcome and the limits. That sentence is not this category.

### Overlong context

Rule, fixed before the search: a file is overlong when a skill in the population tells the agent to read it and the file is longer than 200 lines. Role `SKILL.md` files in the population are 73 lines or fewer, so 200 lines is more than twice that size.

| Instance | Lines | Pointer |
| --- | --- | --- |
| `skills/bearing-lite/references/profiles.md` | 205 | `skills/bearing-lite/SKILL.md:47`; `skills/onboard-bearing/SKILL.md:25` |
| `skills/planning-and-design/references/artifact-grammar.md` | 212 | `skills/planning-and-design/SKILL.md:30` |
| `skills/bearing-lite/references/planning-assembly.md` | 223 | `skills/bearing-lite/SKILL.md:25`; `skills/planning-and-design/SKILL.md:40` |
| `skills/bearing-lite/references/assurance-policy.md` | 258 | `skills/coordinator/SKILL.md:42`; `skills/bearing-lite/references/task-state.md:120` |

Files searched: `skills/*/SKILL.md` and `skills/*/references/*.md` on `9fdf4d0`. No other file in that set exceeds 200 lines.

### Contradictory role instructions

| Instance | Citations |
| --- | --- |
| The Prompt skill says expected files are a guide, not a fence, and that the agent may change what the authorized outcome needs. The Implementer and Coordinator skills require an exact write set. Owner decision DEC-24 (2026-11-17) makes the recorded write set binding and treats expected files as guidance inside that set. The Prompt skill does not state that limit. | `skills/prompt/SKILL.md:36-40`; `skills/prompt/SKILL.md:66`; `skills/implementer/SKILL.md:4`; `skills/implementer/SKILL.md:18-25`; `skills/coordinator/SKILL.md:14` |

`skills/prompt/SKILL.md:4-6` says the composer does not select roles. Step 1 at `skills/prompt/SKILL.md:23-26` says "Select one role/session" and then says the index does not override the canonical skill. Read with `skills/prompt/references/role-loops.md:9-11`, step 1 selects the row of an already selected role. That pair is consistent. It is not counted as a contradiction.

### Genuinely necessary constraints

These stay. They are not overhead to delete.

| Constraint | Citation |
| --- | --- |
| Do not select roles or routes, dispatch, invent budgets, or launch | `skills/prompt/SKILL.md:4-6`; `skills/prompt/SKILL.md:15` |
| Missing inputs are gaps, not permission to invent | `skills/prompt/SKILL.md:18` |
| Binding limits: owner and session authority, role and repository rules, protected actions, outside access, credentials, destructive git, landing, and new guards | `skills/prompt/SKILL.md:34-35` |
| Stop on a protected action, an owner decision, or an authority conflict | `skills/prompt/SKILL.md:40-42` |
| An evaluator does not repair the candidate while evaluating | `skills/prompt/SKILL.md:47-48` |
| Name the repository gate first and require its exit code | `skills/prompt/SKILL.md:51-53` |
| One negative check per named trust boundary | `skills/prompt/SKILL.md:56` |
| A passing return is invalid while an acceptance item is unmet | `skills/prompt/SKILL.md:56-57` |
| Do not invent a deadline, round count, or reasoning level | `skills/prompt/SKILL.md:54-55` |

## Instruction classes

Five classes. Each Prompt procedure step and each packet-template field has one class. Mandated compliance and security verification techniques stay in `security-independence`. They are not advisory.

| Class | Meaning |
| --- | --- |
| `hard-authority` | Who may act, what must not be invented, and when to stop |
| `security-independence` | Security limits, independence of evaluators, and mandated verification technique |
| `required-outcome-evidence` | The outcome, the facts, and the evidence the return must map |
| `advisory-method` | A suggested method the packet includes |
| `model-selected-method` | A method the composing or implementing model chooses inside authority |

Design placement for a skill reference is `skills/prompt/references/instruction-classes.md`. That path is outside this slice's write set, so this report holds the classification. The Prompt skill text is unchanged.

### Procedure steps

| Step | Class | Why this class |
| --- | --- | --- |
| 1. Select the already chosen row and read its canonical skill (`skills/prompt/SKILL.md:23-26`) | `hard-authority` | The skill owns the role. The index must not override it. |
| 2. Include facts and bindings; omit raw history; preserve the provided route (`skills/prompt/SKILL.md:27-29`) | `required-outcome-evidence` | The packet carries the facts the agent must use. |
| 3. State one objective, numbered acceptance, trust boundaries, and protected actions (`skills/prompt/SKILL.md:30-31`) | `required-outcome-evidence` | These are the conditions the return must meet. |
| 4a. Binding limits: authority, protected actions, credentials, destructive git, landing, new guards (`skills/prompt/SKILL.md:34-35`) | `security-independence` | Security and authority limits. |
| 4b. "Expected files as a guide, not a fence" (`skills/prompt/SKILL.md:36-38`) | `advisory-method` | Suggests where to work. Contradicts the exact write set; see the contradiction row. |
| 4c. Smallest authorized approach, record each decision (`skills/prompt/SKILL.md:39-40`) | `model-selected-method` | The model chooses the approach inside authority. This is the only model-selected method in the procedure. |
| 4d. Stop conditions (`skills/prompt/SKILL.md:40-44`) | `hard-authority` | Protected actions, owner decisions, and authority conflicts stop the agent. |
| 5a. Include the selected loop (`skills/prompt/SKILL.md:45-46`) | `advisory-method` | Prescribes the method sequence. |
| 5b. Evaluators do not repair while evaluating; Light Implementer does not repair (`skills/prompt/SKILL.md:47-48`) | `security-independence` | Independence constraint. |
| 6. Wait on events; do not poll; do not add reviews or invocations (`skills/prompt/SKILL.md:49-50`) | `hard-authority` | The controller must not invent extra work. |
| 7a. Repository gate first, with its exit code (`skills/prompt/SKILL.md:51-53`) | `security-independence` | Mandated verification technique. Not advisory. |
| 7b. Do not invent a deadline, round count, or reasoning level (`skills/prompt/SKILL.md:54-55`) | `hard-authority` | Only supplied limits are real. |
| 7c. One negative check per trust boundary; map every acceptance item (`skills/prompt/SKILL.md:56-57`) | `security-independence` | Mandated verification technique. Not advisory. |
| 8. Use the role's typed outcomes and stop conditions (`skills/prompt/SKILL.md:58`) | `required-outcome-evidence` | The return shape is required evidence. |

### Packet template

Each field in `skills/prompt/SKILL.md:63-69` has one class.

| Field | Class |
| --- | --- |
| `ROLE / SESSION` | `hard-authority` |
| `STATE / INPUTS` | `required-outcome-evidence` |
| `OBJECTIVE / ACCEPTANCE` | `required-outcome-evidence` |
| `AUTHORITY` | `hard-authority` |
| `LOOP` | `advisory-method` |
| `VERIFY` | `security-independence` |
| `RETURN / STOP` | `required-outcome-evidence` |

The phrase "expected files as a guide" inside the `AUTHORITY` field (`skills/prompt/SKILL.md:66`) is the same advisory sentence as step 4b. The field's class stays `hard-authority` because the field's job is the binding limits. The phrase is the contradiction recorded above. It is not reclassified as a way to drop a security or compliance check.
