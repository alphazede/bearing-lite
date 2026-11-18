# Prompt instruction classes

These classes apply to the procedure and packet template in [Prompt](../SKILL.md).
The [prompt audit](../../../docs/architecture/bearing-3-prompt-audit.md#instruction-classes)
records the classification by procedure clause and explains the write-set
boundary.

| Class | What it covers |
| --- | --- |
| `hard-authority` | The assigned role, its authority and its stop conditions |
| `security-independence` | Protected actions, evaluator independence and mandated verification techniques |
| `required-outcome-evidence` | The objective, known facts, acceptance and the required evidence |
| `advisory-method` | The selected procedure and expected-files guidance |
| `model-selected-method` | The implementation approach chosen inside the authorized write set |

| Template field | Class |
| --- | --- |
| ROLE / SESSION | `hard-authority` |
| STATE / INPUTS | `required-outcome-evidence` |
| OBJECTIVE / ACCEPTANCE | `required-outcome-evidence` |
| AUTHORITY | `hard-authority` |
| LOOP | `advisory-method` |
| VERIFY | `security-independence` |
| RETURN / STOP | `required-outcome-evidence` |

Required compliance and security verification remain binding. The repository
gate and its exit code, independence requirements, and negative checks for
named trust boundaries stay in force.
