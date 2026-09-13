#!/usr/bin/env python3
"""CMD-LITE-SCHEMA-VALIDATE — Draft 2020-12 regressions for Lite artifact schemas.

Binds pass/fail to SEIT-EMV-021/022/024/028 (AC-EMV-021/022/024/028) and
SEIT-EMV-026 populated lineups structure (ROUTER-EMV-002-001).
Required fields come from CONTRACT-EMV-007/008/009, design interfaces/data,
the public checkout-lease identity, and the selected lineup catalog contract —
not from candidate schema required arrays. Fixtures are public-safe synthetics
of the approved structures. Lineups extra oracles stay in this test file.
"""
from __future__ import annotations

import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMAS_DIR = ROOT / "schemas"
REQUIREMENTS = Path(__file__).resolve().parent / "schema-validator-requirements.txt"
ISOLATED_ROOT_ENV = "BEARING_LITE_SCHEMA_ISOLATED_ROOT"
WHEELHOUSE_ENV = "BEARING_LITE_SCHEMA_WHEELHOUSE"

# CONTRACT-EMV-007 labels retained only as the former sparse always_on_sections
# dialect. Complete documents use named section objects, not this label array.
SPARSE_ALWAYS_ON_SECTION_LABELS = (
    "scope/baseline",
    "responsibility/change authority",
    "applicable documents/precedence",
    "requirements flowdown/architecture context",
    "V&V methods",
    "verification and validation matrices",
    "levels/integration sequence",
    "environments/fixtures/data/simulations/support",
    "procedures/commands",
    "evidence/pass-fail",
    "anomaly/corrective/closure",
)

# Approved named always-on SEIT sections (objects/lists with content).
NAMED_SEIT_SECTIONS = (
    "source_baseline",
    "decision_baseline",
    "responsibility_and_change_authority",
    "applicable_documents_and_precedence",
    "system_description_and_requirements_flowdown",
    "vv_methods",
    "levels",
    "environments_fixtures_data_simulations_support",
    "procedures_and_commands",
    "evidence_and_pass_fail",
    "anomaly_corrective_closure",
    "integration_vv_sequence",
)

# Public checkout_lease identity (skills/bearing-lite/templates/task.md).
LEASE_IDENTITY_FIELDS = (
    "journey",
    "controller",
    "repository",
    "checkout",
    "branch",
    "candidate_revision",
    "acquired_at",
    "generation",
    "state",
)

JOURNEY_IDENTITY_FIELDS = (
    "id",
    "title",
    "status",
    "planning_repository",
)

JOURNEY_TOP_FIELDS = (
    "schema_version",
    "journey",
    "checkout_lease",
    "decisions",
    "open_decisions",
    "planning_receipts",
    "profile_selection",
)

# CONTRACT-EMV-008 slice fields with the canonical reasoning_level object.
SLICE_FIELDS = (
    "role",
    "goal",
    "type",
    "requirement_ids",
    "design_ids",
    "seit_proof_rows",
    "design_lenses",
    "model_route",
    "reasoning_level",
    "review_path",
    "write_set",
    "command_ids",
    "stop_condition",
    "human_decision",
    "authority_id",
)

IMPLEMENTATION_TOP_FIELDS = (
    "schema_version",
    "artifact",
    "source_baseline",
    "journey_settings",
    "profile_freeze",
    "waves",
    "dependencies",
    "slices",
    "traceability",
)

CARDINALITY_FIELDS = ("n", "k", "c")

# CONTRACT-EMV-009 envelope fields with canonical array names/types.
ENVELOPE_FIELDS = (
    "schema",
    "id",
    "state",
    "subject",
    "repositories",
    "baseline",
    "granting_owner_decisions",
    "allowed",
    "prohibited",
    "role_grants",
    "effective",
    "expiry_conditions",
    "supersedes",
    "approval_receipt",
)

AUTHORITY_TOP_FIELDS = ("schema_version",) + ENVELOPE_FIELDS

ALLOWED_PROHIBITED_FIELDS = ("scope", "actions", "paths")

PROOF_FIELDS = (
    "id",
    "kind",
    "requirement_id",
    "design_id",
    "command_id",
    "method",
    "preconditions",
    "stimulus_or_procedure",
    "expected_result",
    "observable_evidence",
    "pass_fail_rule",
    "method_fields",
    "negative_or_failure_case",
)

SYN_JOURNEY = "synthetic-core-schema-fixture"
SYN_AUTH = "AUTH-SYN-001"
SYN_SLICE = "SYN-S1"
SYN_WAVE = "SYN-W1"
SYN_PROOF = "SEIT-SYN-001"
SYN_DEC = "DEC-SYN-001"
SYN_REV = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

FORBIDDEN_SLICE_ALIASES = ("reasoning",)
FORBIDDEN_AUTHORITY_ALIASES = ("granting_owner_decision", "expiry")
FORBIDDEN_PROOF_ALIASES = ("evidence", "pass_fail")

PROFILES_SCHEMA_NAME = "profiles.schema.json"
VERIFICATION_SCHEMA_NAME = "verification.schema.json"
VERIFICATION_MISSING_SCHEMA = f"missing schemas/{VERIFICATION_SCHEMA_NAME}"
VERIFICATION_REQUEST_FIELDS = (
    "schema_version",
    "kind",
    "candidate_ref",
    "candidate_revision",
    "claim_id",
    "claim_type",
    "backend",
    "stage",
    "authority",
    "expected_result",
    "command_configuration",
    "selected",
    "required",
)
VERIFICATION_RECEIPT_FIELDS = (
    "schema_version",
    "kind",
    "status",
    "candidate_ref",
    "candidate_revision",
    "claim_id",
    "backend",
    "backend_version",
    "command_configuration",
    "evidence_digest",
    "authority",
    "produced_by",
)
SYN_DIGEST = "b" * 64
PROFILES_FIXTURE_PATH = ROOT / "test" / "fixtures" / "profiles-populated.example.json"
PROFILES_SHIPPED_PATH = ROOT / "profiles.json"
PROFILES_MISSING_SCHEMA = f"missing schemas/{PROFILES_SCHEMA_NAME}"
PROFILES_PRIMARY_FIELDS = ("harness", "model", "reasoning")
PROFILES_FALLBACK_FIELDS = ("condition", "harness", "model", "reasoning")
PROFILES_PACKAGED_DEFAULT_FIELDS = ("default", "providers", "models", "lineups")
PROFILES_ROOT_FIELDS = ("schema_version", "profiles")
PROFILES_DEFAULT_FIELDS = ("planning", "implementation")
PROFILES_INVALID_NAMES = (
    ("profile_name_leading_digit", "1fixture"),
    ("profile_name_with_space", "fixture alpha"),
    ("profile_name_path_like", "fixture/alpha"),
    ("profile_name_leading_underscore", "_fixture"),
    ("profile_name_empty", ""),
)
RETIRED_ROLE_KEYS = (
    "surveyor",
    "explorer",
    "crewmate",
    "navigator",
    "park_ranger",
    "validator",
)


def die_env(message: str, code: int = 2) -> None:
    print(f"ENVIRONMENT_FAILURE: {message}", file=sys.stderr)
    raise SystemExit(code)


def pip_install(target: str) -> None:
    if sys.version_info[:2] != (3, 12):
        die_env("scanned rpds-py wheel is cp312; python3.12 is required")
    cmd = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--isolated",
        "--disable-pip-version-check",
        "--no-input",
        "--no-compile",
        "--upgrade-strategy",
        "only-if-needed",
        "--target",
        target,
        "--require-hashes",
        "--no-deps",
        "-r",
        str(REQUIREMENTS),
    ]
    wheelhouse = os.environ.get(WHEELHOUSE_ENV)
    if wheelhouse:
        cmd.extend(["--no-index", "--find-links", wheelhouse])
    try:
        subprocess.check_call(cmd, stdout=sys.stderr)
    except (OSError, subprocess.CalledProcessError) as exc:
        die_env(f"isolated pip --require-hashes install failed: {exc}")


def bootstrap() -> None:
    isolated = os.environ.get(ISOLATED_ROOT_ENV)
    if isolated:
        sys.path.insert(0, isolated)
        return
    target = tempfile.mkdtemp(prefix="lite-schema-validator-")
    try:
        pip_install(target)
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            ISOLATED_ROOT_ENV: target,
            "LANG": "C",
        }
        proc = subprocess.run(
            [sys.executable, "-I", "-S", str(Path(__file__).resolve())],
            env=env,
        )
        raise SystemExit(proc.returncode)
    finally:
        shutil.rmtree(target, ignore_errors=True)


def load_schemas() -> dict[str, dict | None]:
    names = {
        "journey": "journey.schema.json",
        "authority": "authority.schema.json",
        "implementation": "implementation.schema.json",
        "seit": "seit.schema.json",
    }
    out: dict[str, dict | None] = {}
    for key, filename in names.items():
        path = SCHEMAS_DIR / filename
        if not path.is_file():
            die_env(f"missing {path.relative_to(ROOT)}")
        with path.open(encoding="utf-8") as fh:
            out[key] = json.load(fh)
    profiles_path = SCHEMAS_DIR / PROFILES_SCHEMA_NAME
    if profiles_path.is_file():
        with profiles_path.open(encoding="utf-8") as fh:
            out["profiles"] = json.load(fh)
    else:
        out["profiles"] = None
    verification_path = SCHEMAS_DIR / VERIFICATION_SCHEMA_NAME
    if verification_path.is_file():
        with verification_path.open(encoding="utf-8") as fh:
            out["verification"] = json.load(fh)
    else:
        out["verification"] = None
    return out


def validator_for(schema: dict):
    from jsonschema import Draft202012Validator
    from referencing import Registry

    return Draft202012Validator(schema, registry=Registry())


def errors_for(schema: dict, instance: object) -> list[str]:
    validator = validator_for(schema)
    messages = []
    for err in validator.iter_errors(instance):
        path = ".".join(str(p) for p in err.absolute_path) or "<root>"
        messages.append(f"{path}: {err.message}")
    return messages


def collect_properties(node: object) -> dict[str, dict]:
    found: dict[str, dict] = {}

    def walk(value: object) -> None:
        if not isinstance(value, dict):
            if isinstance(value, list):
                for item in value:
                    walk(item)
            return
        props = value.get("properties")
        if isinstance(props, dict):
            for name, spec in props.items():
                if isinstance(spec, dict):
                    found[name] = spec
                else:
                    found[name] = {}
        for child in value.values():
            walk(child)

    walk(node)
    return found


def complete_lease(**overrides: object) -> dict:
    lease = {
        "journey": SYN_JOURNEY,
        "controller": "Router",
        "repository": "example/bearing-lite",
        "checkout": "synthetic-checkout",
        "branch": "synthetic-branch",
        "candidate_revision": SYN_REV,
        "acquired_at": "2026-01-01T00:00:00Z",
        "generation": 1,
        "state": "active",
    }
    lease.update(overrides)
    return lease


def complete_journey(**overrides: object) -> dict:
    doc = {
        "schema_version": "1",
        "journey": {
            "id": SYN_JOURNEY,
            "title": "Synthetic portable schema fixture",
            "status": "planning",
            "planning_repository": "example/bearing-lite",
        },
        "checkout_lease": complete_lease(),
        "decisions": [
            {
                "id": SYN_DEC,
                "status": "confirmed",
                "decision": "Public schema tests use synthetic portable fixtures.",
            }
        ],
        "open_decisions": [],
        "planning_receipts": [
            {
                "id": "SYN-RECEIPT-PLAN-001",
                "role": "Router",
                "status": "recorded",
            }
        ],
        "profile_selection": {
            "status": "owner-confirmed",
            "selection_is_authority_grant": False,
        },
    }
    doc.update(overrides)
    return doc


def complete_authority(**overrides: object) -> dict:
    doc = {
        "schema_version": "1",
        "schema": "CONTRACT-SYN-009",
        "id": SYN_AUTH,
        "state": "active",
        "subject": {"journey_id": SYN_JOURNEY},
        "repositories": [{"identity": "example/bearing-lite"}],
        "baseline": {"candidate_revision": SYN_REV},
        "granting_owner_decisions": [SYN_DEC],
        "allowed": {
            "scope": ["synthetic-schema-tests"],
            "actions": ["validate"],
            "paths": ["test/schema-validation.py"],
        },
        "prohibited": {
            "scope": ["publication"],
            "actions": ["publish"],
            "paths": [],
        },
        "role_grants": [{"role": "Implementer"}],
        "effective": True,
        "expiry_conditions": [
            "The granting owner revokes this synthetic envelope.",
            "A later synthetic envelope supersedes this one.",
        ],
        "supersedes": [],
        "approval_receipt": {"id": "SYN-RECEIPT-001"},
    }
    doc.update(overrides)
    return doc


def complete_reasoning_level() -> dict:
    return {"status": "owner-selected", "value": "synthetic"}


def complete_review_path() -> dict:
    return {"status": "owner-selected"}


def complete_slice(**overrides: object) -> dict:
    slice_ = {
        "id": SYN_SLICE,
        "role": "Implementer",
        "goal": "Validate portable Lite artifact schemas with synthetic fixtures.",
        "type": "test-first",
        "requirement_ids": ["AC-SYN-001"],
        "design_ids": ["CONTRACT-SYN-008"],
        "seit_proof_rows": [SYN_PROOF],
        "design_lenses": ["synthetic-portable-lens"],
        "model_route": {"status": "owner-selected"},
        "reasoning_level": complete_reasoning_level(),
        "review_path": complete_review_path(),
        "write_set": ["test/schema-validation.py"],
        "command_ids": ["CMD-LITE-SCHEMA-VALIDATE"],
        "stop_condition": "Stop after schema contract cases.",
        "human_decision": "none",
        "authority_id": SYN_AUTH,
        "dispatchable": True,
    }
    slice_.update(overrides)
    return slice_


def complete_implementation(slices: list[dict] | None = None, **overrides: object) -> dict:
    resolved = slices if slices is not None else [complete_slice()]
    slice_ids = [
        item["id"]
        for item in resolved
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    ] or [SYN_SLICE]
    doc = {
        "schema_version": "1",
        "artifact": {
            "id": "SYN-IMPL-001",
            "type": "implementation.json",
            "status": "draft",
        },
        "source_baseline": {
            "planning_repository": "example/bearing-lite",
            "branch": "synthetic-branch",
            "candidate_revision": SYN_REV,
        },
        "journey_settings": {
            "review_cardinality": {
                "n": 3,
                "k": 2,
                "c": 1,
            }
        },
        "profile_freeze": {
            "state": "frozen",
            "selection_is_authority_grant": False,
        },
        "waves": [
            {
                "id": SYN_WAVE,
                "name": "synthetic-schema-wave",
                "slice_ids": slice_ids,
                "execution_authorized": True,
                "entry": "Synthetic artifacts are complete before the wave starts.",
                "exit": "Synthetic schema-contract evidence is recorded.",
            }
        ],
        "dependencies": [{"from": SYN_WAVE, "to": slice_ids[0]}],
        "slices": resolved,
        "traceability": {
            "requirements": [{"id": "AC-SYN-001"}],
            "contracts": [{"id": "CONTRACT-SYN-008"}],
            "seit_proof_rows": [{"id": SYN_PROOF}],
        },
    }
    doc.update(overrides)
    return doc


def complete_proof(**overrides: object) -> dict:
    proof = {
        "id": SYN_PROOF,
        "kind": "verification",
        "requirement_id": "AC-SYN-001",
        "design_id": "CONTRACT-SYN-007",
        "command_id": "CMD-LITE-SCHEMA-VALIDATE",
        "method": "inspection",
        "preconditions": [
            "Synthetic portable schema documents exist.",
            "CMD-LITE-SCHEMA-VALIDATE uses isolated Draft 2020-12 validation.",
        ],
        "stimulus_or_procedure": (
            "Validate the synthetic SEIT record, including named always-on "
            "sections and the complete proof-case field set."
        ),
        "expected_result": (
            "Draft 2020-12 accepts a complete synthetic SEIT and rejects "
            "labels-only sections and four-field proof stubs."
        ),
        "observable_evidence": (
            "CMD-LITE-SCHEMA-VALIDATE pass/fail lines for synthetic SEIT fixtures."
        ),
        "pass_fail_rule": (
            "PASS if named sections and complete proof fields are present and "
            "incomplete records are rejected; FAIL otherwise."
        ),
        "method_fields": {
            "inspection_article": "synthetic seit.json",
            "inspection_criteria": (
                "named always-on sections with content and complete proof-case fields"
            ),
            "inspection_record": "CMD-LITE-SCHEMA-VALIDATE output",
        },
        "negative_or_failure_case": (
            "Reject always_on_sections labels and method/evidence/pass_fail stubs."
        ),
    }
    proof.update(overrides)
    return proof


def complete_seit(**overrides: object) -> dict:
    doc = {
        "schema_version": "1",
        "source_baseline": {
            "planning_repository": "example/bearing-lite",
            "branch": "synthetic-branch",
            "candidate_revision": SYN_REV,
        },
        "decision_baseline": {
            "kind": "stable-identities-and-statuses",
            "not_whole_file_journey_digest": True,
            "confirmed_decisions": {
                "first_id": SYN_DEC,
                "last_id": SYN_DEC,
                "count": 1,
                "status": "confirmed",
            },
            "open_items": [],
        },
        "responsibility_and_change_authority": {
            "author": "Planning Test Engineer",
            "change_authority": "owner-approved planning artifacts",
            "publication_not_implied": True,
        },
        "applicable_documents_and_precedence": {
            "order": [
                "synthetic-technical-plan",
                "synthetic-design",
                "synthetic-seit",
            ],
            "tailoring": "Always-on V&V sections stay required for portable Lite artifacts.",
        },
        "system_description_and_requirements_flowdown": {
            "system": "synthetic portable planning engine",
            "flowdown": "Acceptance rows allocate to named V&V sections and proof cases.",
            "architecture_context": "Public schema tests use synthetic fixtures only.",
        },
        "vv_methods": {
            "analysis": {"use": "structure and allocation checks"},
            "inspection": {"use": "artifact field inspection"},
            "demonstration": {"use": "command output observation"},
            "test": {"use": "executable schema regressions"},
            "evaluation": {"use": "independent assurance later"},
        },
        "levels": [
            {"id": "SYN-L1", "description": "Synthetic artifact completeness"},
            {"id": "SYN-L2", "description": "Synthetic integration of the four documents"},
        ],
        "environments_fixtures_data_simulations_support": {
            "environments": [{"id": "SYN-ENV-LOCAL", "kind": "isolated-python"}],
            "fixtures": [{"id": "SYN-FIX-SCHEMA", "kind": "public-safe-json"}],
            "datasets": ["synthetic-schema-records"],
            "simulations": "none",
            "support": ["python3.12", "isolated-jsonschema"],
        },
        "procedures_and_commands": [
            {
                "id": "CMD-LITE-SCHEMA-VALIDATE",
                "type": "existing-command",
                "command": "python3 test/schema-validation.py",
                "source": "alphazede/bearing-lite",
            }
        ],
        "evidence_and_pass_fail": {
            "rules": [
                "Complete synthetic records of the approved structures must be accepted.",
                "Labels-only sections and four-field proof stubs must be rejected.",
            ]
        },
        "anomaly_corrective_closure": {
            "on_anomaly": "Record the schema mismatch and stop.",
            "rollback": "Do not edit product schemas from this test packet.",
            "closure": "Close after a later product repair makes complete synthetics pass.",
        },
        "integration_vv_sequence": [
            {
                "step": 1,
                "name": "validate-synthetic-seit",
                "post_step_proof_ids": [SYN_PROOF],
            }
        ],
        "proof_cases": [complete_proof()],
    }
    doc.update(overrides)
    return doc


def sparse_slice() -> dict:
    """Former complete_slice: sibling reasoning string, no reasoning_level."""
    return {
        "id": SYN_SLICE,
        "role": "Implementer",
        "goal": "Validate portable Lite artifact schemas with synthetic fixtures.",
        "type": "test-first",
        "requirement_ids": ["AC-SYN-001"],
        "design_ids": ["CONTRACT-SYN-008"],
        "seit_proof_rows": [SYN_PROOF],
        "design_lenses": ["synthetic-portable-lens"],
        "model_route": {"status": "owner-selected"},
        "reasoning": "synthetic owner-selected route",
        "review_path": {"status": "owner-selected"},
        "write_set": ["test/schema-validation.py"],
        "command_ids": ["CMD-LITE-SCHEMA-VALIDATE"],
        "stop_condition": "Stop after schema contract cases.",
        "human_decision": "none",
        "authority_id": SYN_AUTH,
        "dispatchable": True,
    }


def sparse_implementation() -> dict:
    """Former complete_implementation: schema_version, empty cardinality, one slice."""
    return {
        "schema_version": "1",
        "journey_settings": {"review_cardinality": {}},
        "slices": [sparse_slice()],
    }


def sparse_proof() -> dict:
    """Former four-field proof stub."""
    return {
        "id": SYN_PROOF,
        "method": "inspection",
        "evidence": "synthetic observable artifact bytes",
        "pass_fail": "PASS if required structure is present; FAIL if it is missing",
    }


def sparse_seit() -> dict:
    """Former complete_seit: always_on_sections labels plus four-field proof."""
    return {
        "schema_version": "1",
        "always_on_sections": list(SPARSE_ALWAYS_ON_SECTION_LABELS),
        "decision_baseline": {"kind": "stable-identities-and-statuses"},
        "proof_cases": [sparse_proof()],
    }


def omit(doc: dict, *keys: str) -> dict:
    out = dict(doc)
    for key in keys:
        out.pop(key, None)
    return out


def omit_nested(doc: dict, *keys: str) -> dict:
    out = copy.deepcopy(doc)
    cur: object = out
    for key in keys[:-1]:
        if isinstance(cur, list):
            cur = cur[int(key)]
        elif isinstance(cur, dict):
            cur = cur[key]
        else:
            raise TypeError(f"cannot descend into {type(cur).__name__} at {keys}")
    last = keys[-1]
    if isinstance(cur, dict):
        cur.pop(last, None)
    elif isinstance(cur, list):
        del cur[int(last)]
    else:
        raise TypeError(f"cannot omit from {type(cur).__name__}")
    return out


def has_content(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return True


def empty_shipped_catalog() -> dict:
    with PROFILES_SHIPPED_PATH.open(encoding="utf-8") as fh:
        return copy.deepcopy(json.load(fh))


def complete_user_catalog(**overrides: object) -> dict:
    with PROFILES_FIXTURE_PATH.open(encoding="utf-8") as fh:
        doc = json.load(fh)
    doc.update(overrides)
    return doc


def complete_profile() -> dict:
    return copy.deepcopy(complete_user_catalog()["profiles"]["fixture-alpha"])


def catalog_named(name: str) -> dict:
    return {
        "schema_version": 1,
        "profiles": {name: complete_profile()},
    }


def profile_session_route(*, enabled: bool = True, cadence: str | None = None) -> dict:
    route = {
        "enabled": enabled,
        "primary": {
            "harness": "harness-a",
            "model": "model-a",
            "reasoning": "reasoning-a",
        },
        "ordered_fallbacks": [],
    }
    if cadence is not None:
        route["cadence"] = cadence
    return route


def catalog_with_role_sessions(role: str, sessions: dict) -> dict:
    doc = complete_user_catalog()
    doc["profiles"]["fixture-alpha"]["roles"][role] = {
        "sessions": copy.deepcopy(sessions),
    }
    return doc


def catalog_omitting_roles(*roles: str) -> dict:
    doc = complete_user_catalog()
    profile_roles = doc["profiles"]["fixture-alpha"]["roles"]
    for role in roles:
        profile_roles.pop(role, None)
    return doc


def duplicate_raw_key_messages(raw: str) -> list[str]:
    found: list[str] = []

    def hook(pairs: list[tuple[str, object]]) -> dict:
        seen: dict[str, object] = {}
        for key, value in pairs:
            if key in seen:
                found.append(f'duplicate raw JSON key "{key}"')
            seen[key] = value
        return seen

    try:
        json.loads(raw, object_pairs_hook=hook)
    except json.JSONDecodeError:
        found.append("catalog is not JSON")
    return found


def profiles_extra_oracle_messages(instance: object, raw: str | None) -> list[str]:
    """Checks JSON Schema cannot solely express. Not a catalog service."""
    messages: list[str] = []
    if raw is not None:
        messages.extend(duplicate_raw_key_messages(raw))
    if not isinstance(instance, dict):
        return messages
    if "lineups" in instance:
        messages.append("catalog uses retired live field lineups")
    profiles = instance.get("profiles")
    if isinstance(profiles, dict):
        folded: dict[str, str] = {}
        for name in profiles:
            key = name.lower()
            prior = folded.get(key)
            if prior is not None and prior != name:
                messages.append(
                    f"profiles: ASCII case-fold collision {prior!r} and {name!r}"
                )
            else:
                folded[key] = name
        for name, profile in profiles.items():
            if not isinstance(profile, dict):
                continue
            roles = profile.get("roles")
            if not isinstance(roles, dict):
                continue
            for role_key in roles:
                if role_key in RETIRED_ROLE_KEYS:
                    messages.append(f"profiles.{name}.roles: retired role {role_key!r}")
    defaults = instance.get("defaults")
    if isinstance(defaults, dict) and isinstance(profiles, dict):
        for field in PROFILES_DEFAULT_FIELDS:
            if field not in defaults:
                continue
            value = defaults[field]
            if value not in profiles:
                messages.append(
                    f"defaults.{field}: does not resolve to an existing profile name"
                )
    return messages


def profiles_errors(schema: dict, instance: object, raw: str | None) -> list[str]:
    parsed = instance
    if parsed is None and raw is not None:
        parsed = json.loads(raw)
    messages = errors_for(schema, parsed)
    messages.extend(profiles_extra_oracle_messages(parsed, raw))
    return messages


def raw_duplicate_profile_keys() -> str:
    profile = json.dumps(complete_profile(), separators=(",", ":"))
    return (
        '{"schema_version":1,"profiles":{'
        f'"fixture-alpha":{profile},'
        f'"fixture-alpha":{profile}'
        "}}"
    )


def cases() -> list[tuple[str, str, str, object, str]]:
    """(seit_id, name, schema_key, instance, expect accept|reject)."""
    out: list[tuple[str, str, str, object, str]] = [
        ("SEIT-EMV-024", "incomplete_journey_document", "journey", {"schema_version": "1"}, "reject"),
        ("SEIT-EMV-024", "incomplete_authority_document", "authority", {
            "schema_version": "1",
            "id": SYN_AUTH,
            "state": "active",
            "effective": True,
        }, "reject"),
        ("SEIT-EMV-022", "incomplete_implementation_document", "implementation", {"schema_version": "1"}, "reject"),
        ("SEIT-EMV-021", "incomplete_seit_document", "seit", {"schema_version": "1"}, "reject"),
        ("SEIT-EMV-021", "sparse_complete_seit_labels_only", "seit", sparse_seit(), "reject"),
        ("SEIT-EMV-021", "seit_four_field_proof_stub", "seit", complete_seit(
            proof_cases=[sparse_proof()]
        ), "reject"),
        ("SEIT-EMV-021", "seit_empty_proof_case", "seit", complete_seit(proof_cases=[{}]), "reject"),
        ("SEIT-EMV-021", "seit_proof_case_missing_structure", "seit", complete_seit(
            proof_cases=[{"id": "SEIT-SYN-002", "method": "inspection"}]
        ), "reject"),
        ("SEIT-EMV-022", "sparse_complete_implementation", "implementation", sparse_implementation(), "reject"),
        ("SEIT-EMV-022", "implementation_light_slice_complete", "implementation", complete_implementation(
            slices=[complete_slice(role="Light Implementer", work_class="light", work_class_reason="scaffold run", command_ids=["CMD-1"])]
        ), "accept"),
        ("SEIT-EMV-022", "implementation_light_slice_without_command", "implementation", complete_implementation(
            slices=[complete_slice(role="Light Implementer", work_class="light", work_class_reason="scaffold run", command_ids=[])]
        ), "reject"),
        ("SEIT-EMV-022", "implementation_light_slice_wrong_role", "implementation", complete_implementation(
            slices=[complete_slice(role="Implementer", work_class="light", work_class_reason="scaffold run", command_ids=["CMD-1"])]
        ), "reject"),
        ("SEIT-EMV-022", "implementation_work_class_outside_enum", "implementation", complete_implementation(
            slices=[complete_slice(work_class="easy")]
        ), "reject"),
        ("SEIT-EMV-022", "implementation_sparse_reasoning_string", "implementation", complete_implementation(
            slices=[omit(complete_slice(), "reasoning_level") | {"reasoning": "synthetic owner-selected route"}]
        ), "reject"),
        ("SEIT-EMV-022", "slice_empty_object", "implementation", complete_implementation(slices=[{}]), "reject"),
        ("SEIT-EMV-024", "invalid_lease_generation_type", "journey", complete_journey(
            checkout_lease=complete_lease(generation="1")
        ), "reject"),
        ("SEIT-EMV-022", "invalid_human_decision_type", "implementation", complete_implementation(
            slices=[complete_slice(human_decision=3)]
        ), "reject"),
        ("SEIT-EMV-022", "invalid_slices_type", "implementation", complete_implementation(slices={"id": SYN_SLICE}), "reject"),
        ("SEIT-EMV-021", "invalid_proof_cases_type", "seit", complete_seit(proof_cases={}), "reject"),
        ("SEIT-EMV-024", "authority_sparse_granting_owner_decision", "authority", omit(
            complete_authority(), "granting_owner_decisions"
        ) | {"granting_owner_decision": SYN_DEC}, "reject"),
        ("SEIT-EMV-024", "authority_sparse_expiry", "authority", omit(
            complete_authority(), "expiry_conditions"
        ) | {"expiry": None}, "reject"),
        # R1: effective is a boolean gate. The string "false" is truthy under
        # ordinary consumption, so a string must be rejected outright.
        ("SEIT-EMV-024", "authority_effective_string_false", "authority", complete_authority(
            effective="false"
        ), "reject"),
        ("SEIT-EMV-024", "authority_expiry_conditions_object", "authority", complete_authority(
            expiry_conditions={"note": "synthetic-object-expiry"}
        ), "reject"),
    ]

    for field in JOURNEY_TOP_FIELDS:
        out.append((
            "SEIT-EMV-024",
            f"journey_missing_{field}",
            "journey",
            omit_nested(complete_journey(), field),
            "reject",
        ))
    for field in JOURNEY_IDENTITY_FIELDS:
        out.append((
            "SEIT-EMV-024",
            f"journey_identity_missing_{field}",
            "journey",
            omit_nested(complete_journey(), "journey", field),
            "reject",
        ))
    for field in LEASE_IDENTITY_FIELDS:
        out.append((
            "SEIT-EMV-024",
            f"checkout_lease_missing_{field}",
            "journey",
            omit_nested(complete_journey(), "checkout_lease", field),
            "reject",
        ))
    for field in AUTHORITY_TOP_FIELDS:
        out.append((
            "SEIT-EMV-024",
            f"authority_missing_{field}",
            "authority",
            omit_nested(complete_authority(), field),
            "reject",
        ))
    for field in ALLOWED_PROHIBITED_FIELDS:
        out.append((
            "SEIT-EMV-024",
            f"authority_allowed_missing_{field}",
            "authority",
            omit_nested(complete_authority(), "allowed", field),
            "reject",
        ))
        out.append((
            "SEIT-EMV-024",
            f"authority_prohibited_missing_{field}",
            "authority",
            omit_nested(complete_authority(), "prohibited", field),
            "reject",
        ))
    for field in IMPLEMENTATION_TOP_FIELDS:
        out.append((
            "SEIT-EMV-022",
            f"implementation_missing_{field}",
            "implementation",
            omit_nested(complete_implementation(), field),
            "reject",
        ))
    for field in CARDINALITY_FIELDS:
        out.append((
            "SEIT-EMV-028",
            f"implementation_cardinality_missing_{field}",
            "implementation",
            omit_nested(complete_implementation(), "journey_settings", "review_cardinality", field),
            "reject",
        ))
    for field in SLICE_FIELDS:
        out.append((
            "SEIT-EMV-022",
            f"slice_missing_{field}",
            "implementation",
            omit_nested(complete_implementation(), "slices", "0", field),
            "reject",
        ))
    for field in NAMED_SEIT_SECTIONS:
        out.append((
            "SEIT-EMV-021",
            f"seit_missing_{field}",
            "seit",
            omit_nested(complete_seit(), field),
            "reject",
        ))
    out.append((
        "SEIT-EMV-021",
        "seit_missing_proof_cases",
        "seit",
        omit_nested(complete_seit(), "proof_cases"),
        "reject",
    ))
    for field in PROOF_FIELDS:
        out.append((
            "SEIT-EMV-021",
            f"proof_missing_{field}",
            "seit",
            omit_nested(complete_seit(), "proof_cases", "0", field),
            "reject",
        ))

    out.extend([
        ("SEIT-EMV-024", "complete_journey_document", "journey", complete_journey(), "accept"),
        ("SEIT-EMV-024", "journey_released_lease_without_release_fields", "journey", complete_journey(
            checkout_lease=complete_lease(state="released")
        ), "reject"),
        ("SEIT-EMV-024", "journey_released_lease_with_release_fields", "journey", complete_journey(
            checkout_lease=complete_lease(
                state="released", released_at="2026-01-02T00:00:00Z", release_reason="COMPLETE"
            )
        ), "accept"),
        ("SEIT-EMV-024", "journey_status_outside_enum", "journey", complete_journey(
            journey={
                "id": SYN_JOURNEY,
                "title": "Synthetic portable schema fixture",
                "status": "done",
                "planning_repository": "example/bearing-lite",
            }
        ), "reject"),
        ("SEIT-EMV-024", "complete_authority_document", "authority", complete_authority(), "accept"),
        ("SEIT-EMV-022", "complete_implementation_document", "implementation", complete_implementation(), "accept"),
        ("SEIT-EMV-021", "complete_seit_document", "seit", complete_seit(), "accept"),
        ("SEIT-EMV-022", "human_decision_null", "implementation", complete_implementation(
            slices=[complete_slice(human_decision=None)]
        ), "accept"),
        ("SEIT-EMV-022", "human_decision_string", "implementation", complete_implementation(
            slices=[complete_slice(human_decision="owner-confirmed")]
        ), "accept"),
        ("SEIT-EMV-022", "human_decision_object", "implementation", complete_implementation(
            slices=[complete_slice(human_decision={"required": False, "status": "none"})]
        ), "accept"),
        ("SEIT-EMV-022", "dispatchable_slice_with_authority_id", "implementation", complete_implementation(
            slices=[complete_slice(authority_id=SYN_AUTH, dispatchable=True)]
        ), "accept"),
        ("SEIT-EMV-022", "authority_id_null_on_dispatchable", "implementation", complete_implementation(
            slices=[complete_slice(authority_id=None, dispatchable=True)]
        ), "reject"),
        # R1: a dispatchable slice must name a real authority envelope. An empty
        # string is not an identity, so it must be rejected exactly like null.
        ("SEIT-EMV-022", "authority_id_empty_string_on_dispatchable", "implementation", complete_implementation(
            slices=[complete_slice(authority_id="", dispatchable=True)]
        ), "reject"),
        ("SEIT-EMV-022", "authority_id_null_on_not_dispatchable", "implementation", complete_implementation(
            slices=[complete_slice(
                id="SYN-S-BLOCKED",
                type="release-gated",
                authority_id=None,
                dispatchable=False,
            )]
        ), "accept"),
        ("SEIT-EMV-024", "authority_id_null_on_publication_blocked", "implementation", complete_implementation(
            slices=[complete_slice(
                id="SYN-S-PUB",
                type="release-gated",
                authority_id=None,
                dispatchable=False,
                slice_status="publication-blocked",
            )]
        ), "accept"),
    ])
    return out


def profiles_cases() -> list[tuple[str, str, object, str, str | None]]:
    """(seit_id, name, instance, expect accept|reject, raw)."""
    wrong_primary = complete_user_catalog()
    wrong_primary["profiles"]["fixture-alpha"]["roles"]["implementer"]["primary"] = "harness-a"
    wrong_fallbacks = complete_user_catalog()
    wrong_fallbacks["profiles"]["fixture-alpha"]["roles"]["implementer"]["ordered_fallbacks"] = {
        "condition": "condition-first",
    }
    collision = complete_user_catalog()
    collision["profiles"]["Fixture-Alpha"] = copy.deepcopy(collision["profiles"]["fixture-alpha"])
    retired = complete_user_catalog()
    retired["profiles"]["fixture-alpha"]["roles"]["surveyor"] = {
        "enabled": True,
        "primary": {"harness": "harness-a", "model": "model-a", "reasoning": "reasoning-a"},
        "ordered_fallbacks": [],
    }
    bad_cadence = complete_user_catalog()
    bad_cadence["profiles"]["fixture-alpha"]["roles"]["reviewer"]["cadence"] = "wave"
    missing_roles = omit_nested(complete_user_catalog(), "profiles", "fixture-alpha", "roles")

    out: list[tuple[str, str, object, str, str | None]] = [
        ("SEIT-BDL-002", "complete_populated_user_catalog_with_resolving_defaults", complete_user_catalog(), "accept", None),
        ("SEIT-BDL-002", "populated_catalog_without_defaults_field", omit(complete_user_catalog(), "defaults"), "accept", None),
        ("SEIT-BDL-002", "unlimited_profile_keys", {
            "schema_version": 1,
            "profiles": {
                "fixture-alpha": complete_profile(),
                "fixture-beta": complete_profile(),
                "fixture-gamma": complete_profile(),
            },
            "defaults": {
                "planning": "fixture-alpha",
                "implementation": "fixture-gamma",
            },
        }, "accept", None),
        ("SEIT-BDL-002", "long_profile_name_no_128_ceiling", catalog_named("A" + ("a" * 128)), "accept", None),
        ("SEIT-BDL-002", "schema_version_string_1", complete_user_catalog(schema_version="1"), "reject", None),
        ("SEIT-BDL-002", "schema_version_not_1", complete_user_catalog(schema_version=2), "reject", None),
        ("SEIT-BDL-002", "profiles_array_not_object", complete_user_catalog(profiles=[]), "reject", None),
        ("SEIT-BDL-002", "profile_not_object", {
            "schema_version": 1,
            "profiles": {"fixture-alpha": "not-an-object"},
        }, "reject", None),
        ("SEIT-BDL-002", "primary_not_object", wrong_primary, "reject", None),
        ("SEIT-BDL-002", "ordered_fallbacks_not_array", wrong_fallbacks, "reject", None),
        ("SEIT-BDL-002", "duplicate_raw_json_keys", None, "reject", raw_duplicate_profile_keys()),
        ("SEIT-BDL-002", "ascii_case_fold_collision", collision, "reject", None),
        ("SEIT-BDL-002", "defaults_planning_does_not_resolve", complete_user_catalog(
            defaults={"planning": "missing-profile", "implementation": "fixture-beta"}
        ), "reject", None),
        ("SEIT-BDL-002", "defaults_implementation_does_not_resolve", complete_user_catalog(
            defaults={"planning": "fixture-alpha", "implementation": "missing-profile"}
        ), "reject", None),
        ("SEIT-BDL-002", "retired_surveyor_role_rejected", retired, "reject", None),
        ("SEIT-BDL-002", "invalid_cadence_rejected", bad_cadence, "reject", None),
        ("SEIT-BDL-002", "profile_missing_roles", missing_roles, "reject", None),
        ("SEIT-BDL-002", "legacy_lineups_root_rejected", complete_user_catalog() | {"lineups": {}}, "reject", None),
    ]

    if PROFILES_SHIPPED_PATH.is_file():
        out.insert(0, (
            "SEIT-BDL-002",
            "empty_shipped_catalog_without_defaults",
            empty_shipped_catalog(),
            "accept",
            None,
        ))
    else:
        out.insert(0, (
            "SEIT-BDL-002",
            "empty_shipped_catalog_without_defaults",
            {"schema_version": 1, "profiles": {"not-empty": complete_profile()}},
            "reject",
            None,
        ))

    for field in PROFILES_ROOT_FIELDS:
        out.append((
            "SEIT-BDL-002",
            f"catalog_missing_{field}",
            omit_nested(complete_user_catalog(), field),
            "reject",
            None,
        ))
    for field in PROFILES_PRIMARY_FIELDS:
        out.append((
            "SEIT-BDL-002",
            f"primary_missing_{field}",
            omit_nested(
                complete_user_catalog(),
                "profiles", "fixture-alpha", "roles", "implementer", "primary", field,
            ),
            "reject",
            None,
        ))
    for field in PROFILES_FALLBACK_FIELDS:
        out.append((
            "SEIT-BDL-002",
            f"fallback_missing_{field}",
            omit_nested(
                complete_user_catalog(),
                "profiles", "fixture-alpha", "roles", "implementer",
                "ordered_fallbacks", "0", field,
            ),
            "reject",
            None,
        ))
    for field in PROFILES_PACKAGED_DEFAULT_FIELDS:
        out.append((
            "SEIT-BDL-002",
            f"extra_packaged_{field}_field",
            complete_user_catalog() | {field: {"fixture": "no"}},
            "reject",
            None,
        ))
    for name, value in PROFILES_INVALID_NAMES:
        out.append((
            "SEIT-BDL-002",
            name,
            catalog_named(value),
            "reject",
            None,
        ))

    planning = profile_session_route()
    disabled_planning = profile_session_route(enabled=False)
    assurance = profile_session_route(cadence="phase")
    disabled_assurance = profile_session_route(enabled=False, cadence="phase")
    execution = profile_session_route(cadence="lifecycle")
    disabled_execution = profile_session_route(enabled=False, cadence="lifecycle")
    out.extend([
        ("SEIT-BDL-002", "systems_modeler_execution_session_rejected", catalog_with_role_sessions(
            "systems_modeler", {"execution": execution}
        ), "reject", None),
        ("SEIT-BDL-002", "systems_modeler_assurance_session_rejected", catalog_with_role_sessions(
            "systems_modeler", {"assurance": assurance}
        ), "reject", None),
        ("SEIT-BDL-002", "systems_modeler_planning_and_execution_rejected", catalog_with_role_sessions(
            "systems_modeler", {"planning": planning, "execution": execution}
        ), "reject", None),
        ("SEIT-BDL-002", "requirements_engineer_execution_session_rejected", catalog_with_role_sessions(
            "requirements_engineer", {"execution": execution}
        ), "reject", None),
        ("SEIT-BDL-002", "requirements_engineer_assurance_session_rejected", catalog_with_role_sessions(
            "requirements_engineer", {"assurance": assurance}
        ), "reject", None),
        ("SEIT-BDL-002", "test_engineer_execution_session_rejected", catalog_with_role_sessions(
            "test_engineer", {"execution": execution}
        ), "reject", None),
        ("SEIT-BDL-002", "test_engineer_planning_and_execution_rejected", catalog_with_role_sessions(
            "test_engineer", {"planning": planning, "execution": execution}
        ), "reject", None),
        ("SEIT-BDL-002", "integration_engineer_assurance_session_rejected", catalog_with_role_sessions(
            "integration_engineer", {"assurance": assurance}
        ), "reject", None),
        ("SEIT-BDL-002", "integration_engineer_planning_and_assurance_rejected", catalog_with_role_sessions(
            "integration_engineer", {"planning": planning, "assurance": assurance}
        ), "reject", None),
        ("SEIT-BDL-002", "omitted_sessioned_roles_accepted", catalog_omitting_roles(
            "systems_modeler",
            "requirements_engineer",
            "test_engineer",
            "integration_engineer",
        ), "accept", None),
        ("SEIT-BDL-002", "systems_modeler_planning_explicitly_disabled", catalog_with_role_sessions(
            "systems_modeler", {"planning": disabled_planning}
        ), "accept", None),
        ("SEIT-BDL-002", "requirements_engineer_planning_explicitly_disabled", catalog_with_role_sessions(
            "requirements_engineer", {"planning": disabled_planning}
        ), "accept", None),
        ("SEIT-BDL-002", "test_engineer_assurance_explicitly_disabled", catalog_with_role_sessions(
            "test_engineer", {"assurance": disabled_assurance}
        ), "accept", None),
        ("SEIT-BDL-002", "integration_engineer_execution_explicitly_disabled", catalog_with_role_sessions(
            "integration_engineer", {"execution": disabled_execution}
        ), "accept", None),
        ("SEIT-BDL-002", "test_engineer_planning_only_omits_assurance", catalog_with_role_sessions(
            "test_engineer", {"planning": planning}
        ), "accept", None),
        ("SEIT-BDL-002", "integration_engineer_planning_only_omits_execution", catalog_with_role_sessions(
            "integration_engineer", {"planning": planning}
        ), "accept", None),
        ("SEIT-BDL-002", "sessioned_planning_primary_missing_harness", catalog_with_role_sessions(
            "systems_modeler",
            {
                "planning": {
                    "enabled": True,
                    "primary": {"model": "model-a", "reasoning": "reasoning-a"},
                    "ordered_fallbacks": [],
                }
            },
        ), "reject", None),
    ])
    return out


def complete_verification_request(**overrides: object) -> dict:
    doc = {
        "schema_version": "1",
        "kind": "request",
        "candidate_ref": "cand-syn-001",
        "candidate_revision": SYN_REV,
        "candidate_digest": SYN_DIGEST,
        "claim_id": "SEIT-SYN-BIN-001",
        "claim_type": "binary_reachability",
        "backend": "reverify",
        "stage": "assurance",
        "authority": "assurance",
        "expected_result": "VERIFIED",
        "command_configuration": {"command": "reverify check --claim SEIT-SYN-BIN-001"},
        "selected": True,
        "required": True,
    }
    doc.update(overrides)
    return doc


def complete_verification_receipt(**overrides: object) -> dict:
    doc = {
        "schema_version": "1",
        "kind": "receipt",
        "status": "VERIFIED",
        "candidate_ref": "cand-syn-001",
        "candidate_revision": SYN_REV,
        "candidate_digest": SYN_DIGEST,
        "claim_id": "SEIT-SYN-BIN-001",
        "backend": "reverify",
        "backend_version": "reverify-0.0-test",
        "command_configuration": {"command": "reverify check --claim SEIT-SYN-BIN-001"},
        "evidence_digest": SYN_DIGEST,
        "authority": "assurance",
        "produced_by": {
            "role": "test_engineer.assurance",
            "identity": "ate-syn-001",
            "session": "sess-ate-syn",
        },
        "stage": "assurance",
    }
    doc.update(overrides)
    return doc


def verification_cases() -> list[tuple[str, str, object, str]]:
    """(seit_id, name, instance, expect accept|reject)."""
    out: list[tuple[str, str, object, str]] = [
        ("SEIT-BDL-004", "complete_verification_request", complete_verification_request(), "accept"),
        ("SEIT-BDL-004", "complete_verification_receipt", complete_verification_receipt(), "accept"),
        ("SEIT-BDL-004", "complete_diagnostic_request", complete_verification_request(
            authority="diagnostic", stage="implementation", selected=False, required=False
        ), "accept"),
        ("SEIT-BDL-004", "complete_diagnostic_receipt", complete_verification_receipt(
            authority="diagnostic", stage="implementation",
            produced_by={"role": "implementer", "identity": "author-syn", "session": "sess-impl-syn"},
        ), "accept"),
        ("SEIT-BDL-004", "receipt_inconclusive_status", complete_verification_receipt(status="INCONCLUSIVE"), "accept"),
        ("SEIT-BDL-004", "receipt_error_status", complete_verification_receipt(status="ERROR"), "accept"),
        ("SEIT-BDL-004", "request_schema_version_integer", complete_verification_request(schema_version=1), "reject"),
        ("SEIT-BDL-004", "receipt_invalid_status", complete_verification_receipt(status="PASS"), "reject"),
        ("SEIT-BDL-004", "request_invalid_authority", complete_verification_request(authority="self"), "reject"),
        ("SEIT-BDL-004", "receipt_evidence_digest_not_sha256", complete_verification_receipt(
            evidence_digest="not-a-digest"
        ), "reject"),
        ("SEIT-BDL-004", "request_empty_command_configuration", complete_verification_request(
            command_configuration={}
        ), "reject"),
        ("SEIT-BDL-004", "receipt_produced_by_missing_session", complete_verification_receipt(
            produced_by={"role": "test_engineer.assurance", "identity": "ate-syn-001"}
        ), "reject"),
        ("SEIT-BDL-004", "request_kind_receipt_hybrid", complete_verification_request(kind="receipt"), "reject"),
    ]
    for field in VERIFICATION_REQUEST_FIELDS:
        out.append((
            "SEIT-BDL-004",
            f"request_missing_{field}",
            omit(complete_verification_request(), field),
            "reject",
        ))
    for field in VERIFICATION_RECEIPT_FIELDS:
        out.append((
            "SEIT-BDL-004",
            f"receipt_missing_{field}",
            omit(complete_verification_receipt(), field),
            "reject",
        ))
    return out


def check_remote_ref_fails_closed() -> tuple[bool, str]:
    from referencing.exceptions import Unresolvable

    schema = {"$ref": "https://example.invalid/missing-schema"}
    try:
        list(validator_for(schema).iter_errors({"x": 1}))
    except Unresolvable:
        return True, "missing remote $ref failed closed without retrieval"
    except Exception as exc:
        return False, f"missing remote $ref raised {type(exc).__name__}: {exc}"
    return False, "missing remote $ref was retrieved or ignored"


def check_fixture_contract_fields() -> tuple[bool, str]:
    problems = []
    slice_ = complete_slice()
    for field in SLICE_FIELDS:
        if field not in slice_:
            problems.append(f"slice.{field}")
    for alias in FORBIDDEN_SLICE_ALIASES:
        if alias in slice_:
            problems.append(f"slice uses forbidden alias {alias}")
    if not isinstance(slice_.get("reasoning_level"), dict) or not slice_["reasoning_level"]:
        problems.append("slice.reasoning_level must be a non-empty object")
    if not isinstance(slice_.get("review_path"), dict):
        problems.append("slice.review_path must be an object")

    authority = complete_authority()
    for field in ENVELOPE_FIELDS:
        if field not in authority:
            problems.append(f"authority.{field}")
    for alias in FORBIDDEN_AUTHORITY_ALIASES:
        if alias in authority:
            problems.append(f"authority uses forbidden alias {alias}")
    expiry = authority.get("expiry_conditions")
    if not isinstance(expiry, list) or not expiry or not all(isinstance(item, str) and item for item in expiry):
        problems.append("authority.expiry_conditions must be a non-empty array of strings")
    grants = authority.get("granting_owner_decisions")
    if not isinstance(grants, list) or not grants:
        problems.append("authority.granting_owner_decisions must be a non-empty array")

    lease = complete_lease()
    for field in LEASE_IDENTITY_FIELDS:
        if field not in lease:
            problems.append(f"checkout_lease.{field}")

    journey = complete_journey()
    for field in JOURNEY_TOP_FIELDS:
        if field not in journey:
            problems.append(f"journey.{field}")
    identity = journey.get("journey")
    if not isinstance(identity, dict):
        problems.append("journey.journey must be an object")
    else:
        for field in JOURNEY_IDENTITY_FIELDS:
            if field not in identity:
                problems.append(f"journey.journey.{field}")

    implementation = complete_implementation()
    for field in IMPLEMENTATION_TOP_FIELDS:
        if field not in implementation:
            problems.append(f"implementation.{field}")
    cardinality = (
        implementation.get("journey_settings", {}).get("review_cardinality")
        if isinstance(implementation.get("journey_settings"), dict)
        else None
    )
    if not isinstance(cardinality, dict):
        problems.append("implementation.journey_settings.review_cardinality must be an object")
    else:
        for field in CARDINALITY_FIELDS:
            if not isinstance(cardinality.get(field), int):
                problems.append(f"implementation.review_cardinality.{field}")

    seit = complete_seit()
    if "always_on_sections" in seit:
        problems.append("complete_seit uses labels-only always_on_sections")
    for field in NAMED_SEIT_SECTIONS:
        if field not in seit:
            problems.append(f"seit.{field}")
        elif not has_content(seit[field]):
            problems.append(f"seit.{field} lacks content")
    if "proof_cases" not in seit:
        problems.append("seit.proof_cases")
    proof = complete_proof()
    for field in PROOF_FIELDS:
        if field not in proof:
            problems.append(f"proof.{field}")
        elif not has_content(proof[field]):
            problems.append(f"proof.{field} lacks content")
    for alias in FORBIDDEN_PROOF_ALIASES:
        if alias in proof:
            problems.append(f"proof uses forbidden alias {alias}")

    names = {name for _seit, name, _schema, _instance, _expect in cases()}
    for required in (
        "sparse_complete_seit_labels_only",
        "sparse_complete_implementation",
        "dispatchable_slice_with_authority_id",
        "authority_id_null_on_not_dispatchable",
        "authority_id_null_on_publication_blocked",
    ):
        if required not in names:
            problems.append(f"missing case {required}")

    if problems:
        return False, "complete fixtures omit or misuse " + ", ".join(problems)
    return True, "complete fixtures include CONTRACT-EMV-007/008/009 named structures and lease identity fields"


def check_nkc(implementation_schema: dict) -> tuple[bool, str]:
    props = collect_properties(implementation_schema)
    missing = []
    defaulted = []
    for name in ("n", "k", "c"):
        node = props.get(name) or props.get(name.upper())
        if not node:
            missing.append(name)
            continue
        default = node.get("default")
        if isinstance(default, int):
            defaulted.append(name)
    if missing:
        return False, f"implementation schema missing N/K/C fields: {', '.join(missing)}"
    if defaulted:
        return False, f"implementation schema has assistant default integers on: {', '.join(defaulted)}"
    return True, "n/k/c present without assistant default integers"


def owner_stop_cases() -> list:
    grant = {"granted": True, "owner_decision_id": SYN_DEC, "expires_at": None,
             "exclusions": ["scope_change", "budget_exhaustion", "owner_hold", "owner_only_actions"]}
    question = {"record_type": "owner_stop", "id": "Q1", "class": "F",
                "question": "Authorize action?", "why_owner": "Excluded action",
                "evidence_ref": "AUTH-1", "affected_slices": ["S1"], "blocking": True,
                "status": "queued", "created_at": "2026-09-11T10:00:00Z",
                "asked_at": None, "answered_at": None, "cancelled_at": None, "round_trip_id": None}
    out = [("OWNER-STOP", "explicit_continuation", "authority", complete_authority(continuation=grant), "accept"),
           ("OWNER-STOP", "tracked_queue", "journey", complete_journey(
               owner_wait_tracking=True, owner_blocked_intervals=[], open_decisions=[question]), "accept")]
    for key in grant:
        out.append(("OWNER-STOP", "grant_missing_" + key, "authority",
                    complete_authority(continuation=omit(grant, key)), "reject"))
    out.append(("OWNER-STOP", "grant_missing_exclusions", "authority",
                complete_authority(continuation=grant | {"exclusions": []}), "reject"))
    out.append(("OWNER-STOP", "grant_without_expiry_conditions", "authority",
                complete_authority(continuation=grant, expiry_conditions=[]), "reject"))
    out.append(("OWNER-STOP", "tracking_without_intervals", "journey",
                complete_journey(owner_wait_tracking=True), "reject"))
    for key in question.keys() - {"record_type"}:
        out.append(("OWNER-STOP", "question_missing_" + key, "journey",
                    complete_journey(open_decisions=[omit(question, key)]), "reject"))
    for value in ["2026-09-11T10:00:00+00:00", "2026-09-11T10:00:00.123456Z"]:
        out.append(("OWNER-STOP", "timestamp_precision_" + value, "journey",
                    complete_journey(open_decisions=[question | {"created_at": value}]), "reject"))
        out.append(("OWNER-STOP", "grant_timestamp_precision_" + value, "authority",
                    complete_authority(continuation=grant | {"expires_at": value}), "reject"))
    for status in ["asked", "answered", "cancelled"]:
        out.append(("OWNER-STOP", "missing_" + status + "_timestamp", "journey",
                    complete_journey(open_decisions=[question | {"status": status}]), "reject"))
    return out


def run_cases() -> int:
    schemas = load_schemas()
    print("CMD-LITE-SCHEMA-VALIDATE")
    failed = 0
    passed = 0

    ok, detail = check_remote_ref_fails_closed()
    label = "HARNESS remote_ref_no_retrieval"
    if ok:
        print(f"PASS {label}: {detail}")
        passed += 1
    else:
        print(f"FAIL {label}: {detail}")
        failed += 1

    ok, detail = check_fixture_contract_fields()
    label = "HARNESS complete_fixture_contract_fields"
    if ok:
        print(f"PASS {label}: {detail}")
        passed += 1
    else:
        print(f"FAIL {label}: {detail}")
        failed += 1

    for seit_id, name, schema_key, instance, expect in cases() + owner_stop_cases():
        messages = errors_for(schemas[schema_key], instance)
        accepted = not messages
        want_accept = expect == "accept"
        ok = accepted if want_accept else not accepted
        line = f"{seit_id} {name}"
        if ok:
            print(f"PASS {line}")
            passed += 1
            continue
        failed += 1
        if want_accept:
            first = messages[0] if messages else "rejected with no message"
            print(f"FAIL {line}: rejected (expected accept): {first}")
        else:
            print(f"FAIL {line}: accepted (expected reject)")

    ok, detail = check_nkc(schemas["implementation"])
    line = "SEIT-EMV-028 nkc_fields_without_defaults"
    if ok:
        print(f"PASS {line}: {detail}")
        passed += 1
    else:
        print(f"FAIL {line}: {detail}")
        failed += 1

    if not PROFILES_SHIPPED_PATH.is_file():
        print("FAIL SEIT-BDL-002 empty_shipped_catalog_without_defaults: missing profiles.json (pending S1L)")
        failed += 1
    profiles_schema = schemas.get("profiles")
    try:
        profile_case_list = profiles_cases()
    except OSError as exc:
        print(f"FAIL SEIT-BDL-002 profiles_populated_fixture: {exc}")
        failed += 1
        profile_case_list = []
    for seit_id, name, instance, expect, raw in profile_case_list:
        line = f"{seit_id} {name}"
        if not isinstance(profiles_schema, dict):
            print(f"FAIL {line}: {PROFILES_MISSING_SCHEMA}")
            failed += 1
            continue
        if name == "empty_shipped_catalog_without_defaults" and not PROFILES_SHIPPED_PATH.is_file():
            continue
        messages = profiles_errors(profiles_schema, instance, raw)
        accepted = not messages
        want_accept = expect == "accept"
        ok = accepted if want_accept else not accepted
        if ok:
            print(f"PASS {line}")
            passed += 1
            continue
        failed += 1
        if want_accept:
            first = messages[0] if messages else "rejected with no message"
            print(f"FAIL {line}: rejected (expected accept): {first}")
        else:
            print(f"FAIL {line}: accepted (expected reject)")

    verification_schema = schemas.get("verification")
    for seit_id, name, instance, expect in verification_cases():
        line = f"{seit_id} {name}"
        if not isinstance(verification_schema, dict):
            print(f"FAIL {line}: {VERIFICATION_MISSING_SCHEMA}")
            failed += 1
            continue
        messages = errors_for(verification_schema, instance)
        accepted = not messages
        want_accept = expect == "accept"
        ok = accepted if want_accept else not accepted
        if ok:
            print(f"PASS {line}")
            passed += 1
            continue
        failed += 1
        if want_accept:
            first = messages[0] if messages else "rejected with no message"
            print(f"FAIL {line}: rejected (expected accept): {first}")
        else:
            print(f"FAIL {line}: accepted (expected reject)")

    print(f"# passed={passed} failed={failed}")
    return 1 if failed else 0


def main() -> None:
    bootstrap()
    raise SystemExit(run_cases())


if __name__ == "__main__":
    main()
