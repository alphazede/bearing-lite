#!/usr/bin/env python3
"""CMD-LITE-SCHEMA-VALIDATE — Draft 2020-12 regressions for Lite artifact schemas.

Binds pass/fail to SEIT-EMV-021/022/024/028 (AC-EMV-021/022/024/028).
Required fields come from CONTRACT-EMV-007/008/009, design interfaces/data,
and the public checkout-lease identity — not from candidate schema required
arrays. Fixtures are public-safe synthetics.
"""
from __future__ import annotations

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

# CONTRACT-EMV-007 always-on sections.
ALWAYS_ON_SECTIONS = (
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

# CONTRACT-EMV-008 slice fields.
SLICE_FIELDS = (
    "role",
    "goal",
    "type",
    "requirement_ids",
    "design_ids",
    "seit_proof_rows",
    "design_lenses",
    "model_route",
    "reasoning",
    "review_path",
    "write_set",
    "command_ids",
    "stop_condition",
    "human_decision",
    "authority_id",
)

# CONTRACT-EMV-009 envelope fields.
ENVELOPE_FIELDS = (
    "schema",
    "id",
    "state",
    "subject",
    "repositories",
    "baseline",
    "granting_owner_decision",
    "allowed",
    "prohibited",
    "role_grants",
    "effective",
    "expiry",
    "supersedes",
    "approval_receipt",
)

SYN_JOURNEY = "synthetic-core-schema-fixture"
SYN_AUTH = "AUTH-SYN-001"


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


def load_schemas() -> dict[str, dict]:
    names = {
        "journey": "journey.schema.json",
        "authority": "authority.schema.json",
        "implementation": "implementation.schema.json",
        "seit": "seit.schema.json",
    }
    out: dict[str, dict] = {}
    for key, filename in names.items():
        path = SCHEMAS_DIR / filename
        if not path.is_file():
            die_env(f"missing {path.relative_to(ROOT)}")
        with path.open(encoding="utf-8") as fh:
            out[key] = json.load(fh)
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
        "candidate_revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "acquired_at": "2026-01-01T00:00:00Z",
        "generation": 1,
        "state": "active",
    }
    lease.update(overrides)
    return lease


def complete_journey(**overrides: object) -> dict:
    doc = {
        "schema_version": "1",
        "journey": {"id": SYN_JOURNEY},
        "checkout_lease": complete_lease(),
        "decisions": [],
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
        "baseline": {"candidate_revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
        "granting_owner_decision": "DEC-SYN-001",
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
        "role_grants": [{"role": "Crewmate"}],
        "effective": True,
        "expiry": None,
        "supersedes": [],
        "approval_receipt": {"id": "SYN-RECEIPT-001"},
    }
    doc.update(overrides)
    return doc


def complete_slice(**overrides: object) -> dict:
    slice_ = {
        "id": "SYN-S1",
        "role": "Crewmate",
        "goal": "Validate portable Lite artifact schemas with synthetic fixtures.",
        "type": "test-first",
        "requirement_ids": ["AC-SYN-001"],
        "design_ids": ["CONTRACT-SYN-008"],
        "seit_proof_rows": ["SEIT-SYN-001"],
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
    slice_.update(overrides)
    return slice_


def complete_implementation(slices: list[dict] | None = None, **overrides: object) -> dict:
    doc = {
        "schema_version": "1",
        "journey_settings": {"review_cardinality": {}},
        "slices": slices if slices is not None else [complete_slice()],
    }
    doc.update(overrides)
    return doc


def complete_proof(**overrides: object) -> dict:
    proof = {
        "id": "SEIT-SYN-001",
        "method": "inspection",
        "evidence": "synthetic observable artifact bytes",
        "pass_fail": "PASS if required structure is present; FAIL if it is missing",
    }
    proof.update(overrides)
    return proof


def complete_seit(**overrides: object) -> dict:
    doc = {
        "schema_version": "1",
        "always_on_sections": list(ALWAYS_ON_SECTIONS),
        "decision_baseline": {"kind": "stable-identities-and-statuses"},
        "proof_cases": [complete_proof()],
    }
    doc.update(overrides)
    return doc


def omit(doc: dict, *keys: str) -> dict:
    out = dict(doc)
    for key in keys:
        out.pop(key, None)
    return out


def cases() -> list[tuple[str, str, str, object, str]]:
    """(seit_id, name, schema_key, instance, expect accept|reject)."""
    missing_lease_journey = complete_journey(
        checkout_lease=omit(complete_lease(), "journey")
    )
    missing_lease_controller = complete_journey(
        checkout_lease=omit(complete_lease(), "controller")
    )
    slice_missing_contract_fields = omit(complete_slice(), "reasoning", "review_path")
    return [
        ("SEIT-EMV-024", "incomplete_journey_document", "journey", {"schema_version": "1"}, "reject"),
        ("SEIT-EMV-024", "incomplete_authority_document", "authority", {
            "schema_version": "1",
            "id": SYN_AUTH,
            "state": "active",
            "effective": True,
        }, "reject"),
        ("SEIT-EMV-022", "incomplete_implementation_document", "implementation", {"schema_version": "1"}, "reject"),
        ("SEIT-EMV-021", "incomplete_seit_document", "seit", {"schema_version": "1"}, "reject"),
        ("SEIT-EMV-021", "seit_missing_always_on_sections", "seit", omit(complete_seit(), "always_on_sections"), "reject"),
        ("SEIT-EMV-021", "seit_partial_always_on_sections", "seit", complete_seit(
            always_on_sections=["scope/baseline"]
        ), "reject"),
        ("SEIT-EMV-021", "seit_empty_proof_case", "seit", complete_seit(proof_cases=[{}]), "reject"),
        ("SEIT-EMV-021", "seit_proof_case_missing_structure", "seit", complete_seit(
            proof_cases=[{"id": "SEIT-SYN-002", "method": "inspection"}]
        ), "reject"),
        ("SEIT-EMV-022", "slice_empty_object", "implementation", complete_implementation(slices=[{}]), "reject"),
        ("SEIT-EMV-022", "slice_missing_contract_fields", "implementation", complete_implementation(
            slices=[slice_missing_contract_fields]
        ), "reject"),
        ("SEIT-EMV-024", "checkout_lease_missing_journey", "journey", missing_lease_journey, "reject"),
        ("SEIT-EMV-024", "checkout_lease_missing_controller", "journey", missing_lease_controller, "reject"),
        ("SEIT-EMV-024", "invalid_lease_generation_type", "journey", complete_journey(
            checkout_lease=complete_lease(generation="1")
        ), "reject"),
        ("SEIT-EMV-022", "invalid_human_decision_type", "implementation", complete_implementation(
            slices=[complete_slice(human_decision=3)]
        ), "reject"),
        ("SEIT-EMV-022", "invalid_slices_type", "implementation", complete_implementation(slices={"id": "SYN-S1"}), "reject"),
        ("SEIT-EMV-021", "invalid_proof_cases_type", "seit", complete_seit(proof_cases={}), "reject"),
        ("SEIT-EMV-024", "complete_journey_document", "journey", complete_journey(), "accept"),
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
        ("SEIT-EMV-022", "authority_id_null_on_dispatchable", "implementation", complete_implementation(
            slices=[complete_slice(authority_id=None, dispatchable=True)]
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
    ]


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
    missing = []
    slice_ = complete_slice()
    for field in SLICE_FIELDS:
        if field not in slice_:
            missing.append(f"slice.{field}")
    authority = complete_authority()
    for field in ENVELOPE_FIELDS:
        if field not in authority:
            missing.append(f"authority.{field}")
    lease = complete_lease()
    for field in LEASE_IDENTITY_FIELDS:
        if field not in lease:
            missing.append(f"checkout_lease.{field}")
    sections = complete_seit()["always_on_sections"]
    for field in ALWAYS_ON_SECTIONS:
        if field not in sections:
            missing.append(f"always_on_sections:{field}")
    if missing:
        return False, "complete fixtures omit " + ", ".join(missing)
    return True, "complete fixtures include CONTRACT-EMV-007/008/009 and lease identity fields"


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

    for seit_id, name, schema_key, instance, expect in cases():
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

    print(f"# passed={passed} failed={failed}")
    return 1 if failed else 0


def main() -> None:
    bootstrap()
    raise SystemExit(run_cases())


if __name__ == "__main__":
    main()
