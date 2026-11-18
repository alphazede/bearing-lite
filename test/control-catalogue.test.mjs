/**
 * Alphazedehq#584: Reusable security control catalogue schema, seed entries,
 * skill selection guidance, parameterization, and plan-package validation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planningContract } from "./planning-contract-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const planPackage = require(path.join(ROOT, "hooks/plan-package.cjs"));
const { checkRegister } = require(path.join(ROOT, "hooks/register-precheck.cjs"));
const sha = (s) => createHash("sha256").update(s).digest("hex");

const EXPECTED_SEEDS = [
  { file: "luks-disk-encryption.json", id: "CTRL-SEC-LUKS" },
  { file: "nftables-one-way-firewall.json", id: "CTRL-SEC-NFTABLES-ONEWAY" },
  { file: "apparmor-mac.json", id: "CTRL-SEC-APPARMOR" },
  { file: "vtpm-attestation.json", id: "CTRL-SEC-VTPM" },
];

describe("security control catalogue (Alphazedehq#584)", () => {
  it("ships schema, all four seed entries, and packs catalog/ in npm pack", () => {
    assert.equal(existsSync(path.join(ROOT, "schemas/control-catalogue.schema.json")), true);
    const dir = path.join(ROOT, "catalog/controls");
    assert.equal(existsSync(dir), true);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    for (const seed of EXPECTED_SEEDS) {
      assert.ok(files.includes(seed.file), `missing seed file ${seed.file}`);
      const parsed = JSON.parse(readFileSync(path.join(dir, seed.file), "utf8"));
      assert.equal(parsed.id, seed.id);
      assert.equal(typeof parsed.requirement?.statement, "string");
      assert.equal(typeof parsed.positive_case?.pass_fail_rule, "string");
      assert.equal(typeof parsed.negative_case?.pass_fail_rule, "string");
      assert.ok(Object.keys(parsed.parameters || {}).length > 0);
    }

    const catalogue = planPackage.loadControlCatalogue();
    assert.ok(catalogue instanceof Map);
    for (const seed of EXPECTED_SEEDS) {
      assert.ok(catalogue.has(seed.id), `catalogue missing ${seed.id}`);
    }

    const packJson = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const packed = JSON.parse(packJson)[0].files.map((f) => f.path);
    assert.ok(packed.includes("schemas/control-catalogue.schema.json"));
    for (const seed of EXPECTED_SEEDS) {
      assert.ok(packed.includes(`catalog/controls/${seed.file}`), `npm pack missing ${seed.file}`);
    }
  });

  it("MBSE and Integration and Test skills reference the control catalogue for selection and parameterization", () => {
    const mbse = readFileSync(path.join(ROOT, "skills/mbse/SKILL.md"), "utf8");
    const integrationTest = readFileSync(path.join(ROOT, "skills/integration-test/SKILL.md"), "utf8");
    for (const [name, text] of [["mbse", mbse], ["integration-test", integrationTest]]) {
      assert.match(text, /catalog\/controls\//, `${name} must name catalog/controls/`);
      assert.match(text, /control-catalogue\.schema\.json/, `${name} must name control-catalogue.schema.json`);
      assert.match(text.replace(/\s+/g, " "), /select and parameterize/i, `${name} must instruct selection and parameterization`);
    }
    assert.match(integrationTest, /selected_controls/);
  });

  it("selects and parameterizes a control into a valid requirement, SEIT cases, and frozen plan package", () => {
    const catalogue = planPackage.loadControlCatalogue();
    const luks = catalogue.get("CTRL-SEC-LUKS");
    assert.ok(luks);

    const selection = {
      control_id: "CTRL-SEC-LUKS",
      requirement_id: "REQ-SEC-LUKS-01",
      positive_case_id: "SEIT-SEC-LUKS-POS-01",
      negative_case_id: "SEIT-SEC-LUKS-NEG-01",
      parameters: {
        device_path: "/dev/nvme0n1p2",
        mapper_name: "cryptroot",
      },
    };

    const rendered = planPackage.parameterizeControl(luks, selection);
    assert.equal(rendered.ok, true, JSON.stringify(rendered.findings));
    assert.deepEqual(rendered.parameters, {
      device_path: "/dev/nvme0n1p2",
      mapper_name: "cryptroot",
      cipher: "aes-xts-plain64",
      key_slot_policy: "tpm2-with-recovery-passphrase",
    });
    assert.match(rendered.requirement.statement, /\/dev\/nvme0n1p2/);
    assert.match(rendered.requirement.statement, /cryptroot/);
    assert.match(rendered.requirement.statement, /aes-xts-plain64/);
    assert.doesNotMatch(JSON.stringify(rendered), /\{\{[^}]+\}\}/);
    assert.equal(rendered.positive_case.id, "SEIT-SEC-LUKS-POS-01");
    assert.equal(rendered.positive_case.requirement_id, "REQ-SEC-LUKS-01");
    assert.equal(rendered.negative_case.id, "SEIT-SEC-LUKS-NEG-01");
    assert.equal(rendered.negative_case.requirement_id, "REQ-SEC-LUKS-01");

    // Parameterized requirement passes register-precheck at both stages.
    const sdoc = [
      "[DOCUMENT]",
      "TITLE: Security Controls",
      "",
      "[REQUIREMENT]",
      `UID: ${rendered.requirement.uid}`,
      `TITLE: ${rendered.requirement.title}`,
      "STATEMENT: >>>",
      rendered.requirement.statement,
      "<<<",
      "RATIONALE: >>>",
      `${rendered.requirement.rationale} Traces to DEC-SEC-01.`,
      "<<<",
      `VERIFICATION_METHOD: ${rendered.requirement.verification_method}`,
      `VERIFICATION_CASE_ID: ${rendered.positive_case.id}, ${rendered.negative_case.id}`,
      "[/REQUIREMENT]",
      "",
    ].join("\n");
    const planMd = "# Technical Plan\n\n### DEC-SEC-01: Encrypt persistent storage\n";
    const regResult = checkRegister({
      register: sdoc,
      technicalPlan: planMd,
      stage: "final",
      seitCaseIds: [rendered.positive_case.id, rendered.negative_case.id],
    });
    assert.equal(regResult.outcome, "PASS", JSON.stringify(regResult.findings));

    // Full plan-package freeze with selected_controls passes.
    const repo = mkdtempSync(path.join(os.tmpdir(), "ctrl-freeze-"));
    try {
      const dir = path.join(repo, "docs/plans/sec");
      mkdirSync(path.join(repo, ".git"), { recursive: true });
      mkdirSync(dir, { recursive: true });
      const designMd = "# Design\n";
      writeFileSync(path.join(dir, "plan.md"), planMd);
      writeFileSync(path.join(dir, "design.md"), designMd);
      const seitDoc = {
        schema_version: "1",
        source_baseline: {
          planning_inputs: [
            { path: "docs/plans/sec/plan.md", sha256: sha(planMd) },
            { path: "docs/plans/sec/design.md", sha256: sha(designMd) },
          ],
        },
        procedures_and_commands: [{ id: "CMD-SEC-LUKS", actor: "Implementer" }],
        proof_cases: [
          {
            ...rendered.positive_case,
            design_id: "DES-SEC-01",
            command_id: "CMD-SEC-LUKS",
            method_fields: {
              test_article: "/dev/nvme0n1p2",
              stimulus: rendered.positive_case.stimulus_or_procedure,
              measured_response: rendered.positive_case.expected_result,
              test_environment: "qemu-luks-vm",
            },
          },
          {
            ...rendered.negative_case,
            design_id: "DES-SEC-01",
            command_id: "CMD-SEC-LUKS",
            method_fields: {
              test_article: "/dev/nvme0n1p2",
              stimulus: rendered.negative_case.stimulus_or_procedure,
              measured_response: rendered.negative_case.expected_result,
              test_environment: "qemu-luks-vm",
            },
          },
        ],
      };
      const seitBytes = JSON.stringify(seitDoc);
      writeFileSync(path.join(dir, "seit.json"), seitBytes);
      const candidateDigest = sha([sha(planMd), sha(designMd), sha(seitBytes)].join("\n"));
      const contract = planningContract(candidateDigest, { dir });
      writeFileSync(
        path.join(dir, "implementation.json"),
        JSON.stringify({
          selected_controls: [selection],
          boundary_contract: contract.boundary_contract,
          journey_settings: {
            planning_review: { candidate_digest: candidateDigest },
            ...contract.journey_settings,
          },
        })
      );
      const verdict = planPackage.freeze(dir);
      assert.equal(verdict.outcome, "PASS", JSON.stringify(verdict.findings));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("negative: rejects missing/unknown/invalid control selections and unresolved SEIT case links", () => {
    const catalogue = planPackage.loadControlCatalogue();
    const nft = catalogue.get("CTRL-SEC-NFTABLES-ONEWAY");
    assert.ok(nft);

    const missingParam = planPackage.parameterizeControl(nft, {
      control_id: "CTRL-SEC-NFTABLES-ONEWAY",
      requirement_id: "REQ-SEC-NFT-01",
      positive_case_id: "SEIT-NFT-POS-01",
      negative_case_id: "SEIT-NFT-NEG-01",
      parameters: { table_name: "inet filter", source_zone: "wg0" },
    });
    assert.equal(missingParam.ok, false);
    assert.ok(missingParam.findings.some((f) => f.code === "control_parameter_missing"));

    const invalidEnum = planPackage.parameterizeControl(nft, {
      control_id: "CTRL-SEC-NFTABLES-ONEWAY",
      requirement_id: "REQ-SEC-NFT-01",
      positive_case_id: "SEIT-NFT-POS-01",
      negative_case_id: "SEIT-NFT-NEG-01",
      parameters: {
        table_name: "inet filter",
        source_zone: "wg0",
        destination_zone: "eth0",
        protocol: "icmp",
        destination_port: 443,
      },
    });
    assert.equal(invalidEnum.ok, false);
    assert.ok(invalidEnum.findings.some((f) => f.code === "control_parameter_invalid" && f.parameter === "protocol"));

    const unknownParam = planPackage.parameterizeControl(nft, {
      control_id: "CTRL-SEC-NFTABLES-ONEWAY",
      requirement_id: "REQ-SEC-NFT-01",
      positive_case_id: "SEIT-NFT-POS-01",
      negative_case_id: "SEIT-NFT-NEG-01",
      parameters: {
        table_name: "inet filter",
        source_zone: "wg0",
        destination_zone: "eth0",
        protocol: "tcp",
        destination_port: 443,
        extra_key: "nope",
      },
    });
    assert.equal(unknownParam.ok, false);
    assert.ok(unknownParam.findings.some((f) => f.code === "unknown_control_parameter"));

    const checkFindings = planPackage.checkSelectedControls(
      {
        selected_controls: [
          {
            control_id: "CTRL-DOES-NOT-EXIST",
            requirement_id: "REQ-1",
            positive_case_id: "SEIT-1-POS",
            negative_case_id: "SEIT-1-NEG",
            parameters: {},
          },
          {
            control_id: "CTRL-SEC-VTPM",
            requirement_id: "REQ-VTPM-01",
            positive_case_id: "SEIT-VTPM-SAME",
            negative_case_id: "SEIT-VTPM-SAME",
            parameters: {
              tpm_device: "/dev/tpmrm0",
              expected_pcr_indices: "0,2,7",
              sealed_object_purpose: "LUKS2 key sealing",
            },
          },
          {
            control_id: "CTRL-SEC-APPARMOR",
            requirement_id: "REQ-AA-01",
            positive_case_id: "SEIT-AA-POS",
            negative_case_id: "SEIT-AA-NEG",
            parameters: {
              profile_name: "usr.bin.app",
              executable_path: "/usr/bin/app",
              allowed_paths: "/var/lib/app/** rw",
              denied_path: "/etc/shadow",
            },
          },
        ],
      },
      {
        proof_cases: [
          { id: "SEIT-AA-POS", requirement_id: "REQ-OTHER" },
        ],
      }
    );
    const codes = new Set(checkFindings.map((f) => f.code));
    assert.ok(codes.has("unknown_control_id"), JSON.stringify(checkFindings));
    assert.ok(codes.has("control_case_ids_identical"), JSON.stringify(checkFindings));
    assert.ok(codes.has("control_case_requirement_mismatch"), JSON.stringify(checkFindings));
    assert.ok(codes.has("control_case_unresolved"), JSON.stringify(checkFindings));
  });
});
