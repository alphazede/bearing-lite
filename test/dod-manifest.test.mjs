/**
 * SEIT-BDL-003 / AC-BDL-008 / AC-BDL-012
 * Deterministic DoD Manifest renderer: double-render, escaping, missing/stale
 * views, N/A, append-only closeout, sanitized SVG/PNG, unsafe rejection.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TEMPLATE_VERSION,
  bindingRequirement,
  renderDodManifest,
  renderFile,
  sanitizeSvg,
  sha256Hex,
} from "../tools/render-dod-manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RENDERER = path.join(ROOT, "tools/render-dod-manifest.mjs");
const TEMPLATE = path.join(ROOT, "templates/dod-manifest-v1.html");
const SCHEMA = path.join(ROOT, "schemas/implementation.schema.json");
const temps = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" role="img" aria-labelledby="t d"><title id="t">Fixture view</title><desc id="d">Safe inline fixture. Not a SysML authority.</desc><rect x="1" y="1" width="38" height="18" fill="#d4e4e6" stroke="#0e5c66" stroke-width="2" /></svg>';

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "dod-manifest-"));
  temps.push(dir);
  return dir;
}

function baseManifest(overrides = {}) {
  return {
    template_version: TEMPLATE_VERSION,
    output_name: "fixture-dod-manifest.html",
    state: "planning",
    title: "Fixture Plan — Definition of Done Manifest",
    bluf: "Bounded fixture outcome with visible evidence and gaps.",
    identity: [
      { label: "Lifecycle", value: "FIX-2026-09-13" },
      { label: "Repository", value: "alphazede/bearing-lite" },
    ],
    outcome: "A reviewable fixture lifecycle with deterministic rendering.",
    scope: ["fixture renderer"],
    exclusions: ["No publication"],
    definition_of_done: [
      { id: "AC-FIX-001", criterion: "Renderer is byte-deterministic", evidence: "SEIT-FIX-001", status: "PROPOSED" },
    ],
    requirements: [
      { id: "AC-FIX-001", statement: "Deterministic accessible DoD Manifest", source: "fixture", status: "PROPOSED" },
    ],
    architecture: [
      { id: "DES-FIX-001", decision: "Fixed template and stdlib renderer", interfaces: "dod_manifest → HTML", status: "PLANNED" },
    ],
    models: [],
    lineup: [
      { role: "Implementer", session: "implementation", configured_primary: "Grok Build", effective_route: "Grok Build", status: "READY" },
    ],
    tasks: [
      { id: "S3", role: "Implementer", depends_on: "none", write_set: "template, renderer, tests", status: "READY" },
    ],
    vv: [
      { id: "SEIT-FIX-001", method: "deterministic render comparison", cadence: "phase", evidence: "pending", status: "PLANNED" },
    ],
    documentation: [
      { surface: "README", impact: "none in fixture", owner: "S4", timing: "before assurance", verification: "CMD-BDL-DOCS", status: "PLANNED" },
    ],
    risks: [
      { id: "RISK-FIX-001", risk: "Unsafe embed", control: "sanitization", recovery: "reject", status: "OPEN" },
    ],
    authority: [
      { event: "Scope decisions", owner: "Human owner", status: "CONFIRMED", evidence: "DEC-FIX-001" },
    ],
    closeout: {
      candidate: "pending",
      changed_paths: [],
      evidence: [],
      open_gaps: [],
      owner_acceptance: "pending",
    },
    ...overrides,
  };
}

function boundSvgModel(overrides = {}) {
  const digest = `sha256:${sha256Hex(Buffer.from(SAFE_SVG, "utf8"))}`;
  return {
    id: "MODEL-FIX-001",
    mode: "diagram-assisted",
    source: "views/model.svg",
    revision: "fixture",
    digest,
    viewpoint: "How is the fixture bounded?",
    trace: "AC-FIX-001",
    limitations: "Fixture projection, not SysML",
    render_status: "READY",
    required: true,
    selected: true,
    view: { format: "svg", path: "views/model.svg" },
    ...overrides,
  };
}

function writeFixture(dir, doc, files = {}) {
  mkdirSync(path.join(dir, "views"), { recursive: true });
  writeFileSync(path.join(dir, "views/model.svg"), SAFE_SVG, "utf8");
  writeFileSync(path.join(dir, "views/model.png"), PNG_1x1);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    if (Buffer.isBuffer(content)) writeFileSync(abs, content);
    else writeFileSync(abs, content, "utf8");
  }
  const input = path.join(dir, "implementation.json");
  writeFileSync(input, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return input;
}

function cli(args, cwd = ROOT) {
  return spawnSync(process.execPath, [RENDERER, ...args], {
    encoding: "utf8",
    cwd,
  });
}

describe("S3 DoD Manifest template, schema, and renderer", () => {
  it("ships the versioned Grok-visual template with accessible contrast, focus, and print rules", () => {
    assert.equal(existsSync(TEMPLATE), true);
    const html = readFileSync(TEMPLATE, "utf8");
    assert.match(html, /dod-manifest-template 1\.0\.1/);
    assert.match(html, /--paper: #e7edf1/);
    assert.match(html, /:focus-visible/);
    assert.match(html, /@media print/);
    assert.match(html, /--paper: #ffffff/);
    assert.match(html, /<!--DOD_TITLE-->/);
    assert.match(html, /<!--DOD_BODY-->/);
    assert.equal(html.includes("javascript:"), false);
    assert.equal(/<script/i.test(html), false);
  });

  it("ships the approved CSP under template version 1.0.1 in template, renderer, and rendered output", () => {
    const csp =
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`;
    const template = readFileSync(TEMPLATE, "utf8");
    assert.equal(TEMPLATE_VERSION, "1.0.1");
    assert.match(template, /<!-- dod-manifest-template 1\.0\.1 -->/);
    assert.equal(template.includes(csp), true);
    assert.equal([...template.matchAll(/http-equiv="Content-Security-Policy"/gi)].length, 1);

    const dir = tempDir();
    const pngDigest = `sha256:${sha256Hex(PNG_1x1)}`;
    const doc = {
      dod_manifest: baseManifest({
        models: [
          boundSvgModel(),
          boundSvgModel({
            id: "MODEL-FIX-PNG",
            digest: pngDigest,
            view: { format: "png", path: "views/model.png" },
          }),
        ],
      }),
    };
    const input = writeFixture(dir, doc);
    const first = renderFile(input);
    const second = renderFile(input);
    assert.equal(first.html, second.html);
    assert.equal(first.html.includes(csp), true);
    assert.match(first.html, /<!-- dod-manifest-template 1\.0\.1 -->/);
    assert.match(first.html, /<style>/);
    assert.match(first.html, /<svg /);
    assert.match(first.html, /data:image\/png;base64,/);
  });

  it("declares dod_manifest on implementation.schema.json without requiring historical documents to carry views", () => {
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
    assert.equal(schema.$defs.dodManifest.required.includes("template_version"), true);
    assert.equal(schema.properties.dod_manifest.$ref, "#/$defs/dodManifest");
    assert.equal(schema.$defs.dodView.properties.format.enum.join(","), "svg,png");
    assert.equal(schema.required.includes("dod_manifest"), false);
    assert.equal(
      schema.$defs.dodManifest.properties.closeout.properties.model_views.items.required.join(","),
      "model_id,digest,view"
    );
  });

  it("renders nine fixed sections twice to identical bytes and supports --check", () => {
    const dir = tempDir();
    const doc = {
      dod_manifest: baseManifest({ models: [boundSvgModel()] }),
      journey_settings: {
        development_strategy: { mode: "single_implementer" },
        assurance_cadence: {
          test_engineer: { assurance: "phase" },
          reviewer: "phase",
          integration_engineer: { execution: "lifecycle" },
        },
      },
    };
    const input = writeFixture(dir, doc);
    const first = renderFile(input);
    const second = renderFile(input);
    assert.equal(first.html, second.html);
    assert.equal(first.digest, second.digest);
    for (const id of ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"]) {
      assert.match(first.html, new RegExp(`id="${id}"`));
    }
    assert.match(first.html, /Skip to content/);
    assert.match(first.html, /id="main"/);
    assert.match(first.html, /status-key/);
    assert.match(first.html, /<svg /);
    assert.match(first.html, /MODEL-FIX-001/);
    assert.match(first.html, /single_implementer/);
    assert.match(first.html, /Documentation impact/);
    assert.match(first.html, /Append-only closeout/);
    const generated = cli([input]);
    assert.equal(generated.status, 0, generated.stderr);
    const checked = cli([input, "--check"]);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /RENDER_CHECK_PASS/);
    writeFileSync(path.join(dir, "fixture-dod-manifest.html"), `${first.html}x`, "utf8");
    const mismatch = cli([input, "--check"]);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /CHECK_MISMATCH/);
  });

  it("escapes long hostile input and never emits it as markup or javascript: links", () => {
    const dir = tempDir();
    const attack = `<script>alert(1)</script>&"' javascript:alert(1) ${"A".repeat(8000)}`;
    const doc = {
      dod_manifest: baseManifest({
        bluf: attack,
        outcome: attack,
        models: [boundSvgModel()],
        requirements: [{ id: "AC-FIX-X", statement: attack, source: attack, status: "PROPOSED" }],
      }),
    };
    const input = writeFixture(dir, doc);
    const { html } = renderFile(input);
    assert.equal(html.includes("<script>alert(1)</script>"), false);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal(/href\s*=\s*["']javascript:/i.test(html), false);
    assert.match(html, /A{8000}/);
  });

  it("fails closed on a selected/required missing view and still exposes a visible gap", () => {
    const dir = tempDir();
    const doc = {
      dod_manifest: baseManifest({
        models: [
          {
            id: "MODEL-FIX-MISSING",
            mode: "diagram-assisted",
            source: "views/missing.svg",
            viewpoint: "Missing required view",
            trace: "AC-FIX-001",
            limitations: "Cannot assess without the view",
            render_status: "MISSING",
            required: true,
            selected: true,
          },
        ],
      }),
    };
    const input = writeFixture(dir, doc);
    assert.throws(
      () => renderFile(input),
      (err) => {
        assert.equal(err.code, "MISSING_VIEW");
        assert.match(err.message, /MODEL-FIX-MISSING/);
        assert.match(err.html, /MODEL-FIX-MISSING/);
        assert.match(err.html, /status-gap/);
        assert.match(err.html, /id="s4"/);
        return true;
      }
    );
    const result = cli([input, "--out", path.join(dir, "out.html")]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /MISSING_VIEW/);
    assert.match(result.stderr, /BINDING_REQUIRED/);
    assert.equal(existsSync(path.join(dir, "out.html")), false);
  });

  it("fails closed on a stale digest and on path traversal", () => {
    const dir = tempDir();
    const staleDoc = {
      dod_manifest: baseManifest({
        models: [boundSvgModel({ digest: `sha256:${"0".repeat(64)}` })],
      }),
    };
    const staleInput = writeFixture(dir, staleDoc);
    assert.throws(
      () => renderFile(staleInput),
      (err) => {
        assert.equal(err.code, "STALE_VIEW");
        assert.match(err.html, /status-gap/);
        return true;
      }
    );
    const traversal = {
      dod_manifest: baseManifest({
        models: [
          boundSvgModel({
            view: { format: "svg", path: "../outside.svg" },
            digest: `sha256:${sha256Hex(Buffer.from(SAFE_SVG, "utf8"))}`,
          }),
        ],
      }),
    };
    const traversalInput = writeFixture(dir, traversal);
    assert.throws(() => renderFile(traversalInput), (err) => err.code === "PATH_TRAVERSAL");
  });

  it("keeps explicit N/A sections visible and does not fail inactive unselected/unrequired models", () => {
    const dir = tempDir();
    const doc = {
      dod_manifest: baseManifest({
        models: {
          not_applicable: true,
          reason: "Modeling mode was not selected for this fixture.",
        },
        definition_of_done: [
          {
            id: "AC-FIX-NA",
            criterion: "Production deploy",
            evidence: "Not required",
            status: "Not applicable",
            reason: "Deployment is an exclusion.",
          },
        ],
      }),
    };
    const input = writeFixture(dir, doc);
    const { html } = renderFile(input);
    assert.match(html, /not applicable/i);
    assert.match(html, /Modeling mode was not selected/);
    assert.match(html, /status-na/);
    assert.match(html, /id="s4"/);

    const inactive = {
      dod_manifest: baseManifest({
        models: [
          {
            id: "MODEL-FIX-IDLE",
            mode: "diagram-assisted",
            source: "none",
            viewpoint: "Unselected",
            trace: "none",
            limitations: "Not used",
            render_status: "PLANNED",
            required: false,
            selected: false,
          },
        ],
      }),
    };
    const idleInput = writeFixture(dir, inactive);
    const idle = renderFile(idleInput);
    assert.match(idle.html, /MODEL-FIX-IDLE/);
    assert.equal(idle.html.includes("<svg"), false);
  });

  it("preserves planning projection and appends closeout actuals plus owner amendments", () => {
    const dir = tempDir();
    const plannedOutcome = "Planned fixture outcome must remain visible.";
    const doc = {
      dod_manifest: baseManifest({
        outcome: plannedOutcome,
        models: [boundSvgModel()],
        closeout: {
          candidate: "deadbeef",
          changed_paths: ["tools/render-dod-manifest.mjs"],
          evidence: ["SEIT-FIX-001"],
          open_gaps: ["residual gap"],
          owner_acceptance: "pending",
          documentation_completion: "in progress",
          anomalies: ["none used"],
          repairs: ["none"],
          recovery_used: "none",
          slice_receipts: [
            { slice: "S3", status: "PASS", route: "Grok Build", residual: "none recorded" },
          ],
          amendments: [
            { id: "DEC-FIX-060", decision: "Continue implementation", evidence: "owner" },
          ],
        },
      }),
    };
    const input = writeFixture(dir, doc);
    const { html } = renderFile(input);
    assert.match(html, /Planned fixture outcome must remain visible/);
    assert.match(html, /deadbeef/);
    assert.match(html, /tools\/render-dod-manifest\.mjs/);
    assert.match(html, /residual gap/);
    assert.match(html, /DEC-FIX-060/);
    assert.match(html, /Continue implementation/);
    assert.match(html, /Slice receipts/);
    assert.match(html, /Documentation completion/);
    assert.equal(html.includes("deadbeef"), true);
    assert.equal(html.includes(plannedOutcome), true);
  });

  it("renders current task and risk status with planning status as fallback", () => {
    const dir = tempDir();
    const doc = {
      dod_manifest: baseManifest({
        models: [boundSvgModel()],
        tasks: [
          {
            id: "S1L",
            role: "Light Implementer",
            depends_on: "S1",
            write_set: "fixture",
            status: "BLOCKED",
          },
        ],
        risks: [
          {
            id: "RISK-FIX-001",
            risk: "Unsafe embed",
            control: "sanitization",
            recovery: "reject",
            status: "OPEN",
          },
        ],
        closeout: {
          candidate: "deadbeef",
          changed_paths: [],
          evidence: [],
          open_gaps: [],
          owner_acceptance: "pending",
          current_execution_state: {
            slice_state: {
              S1L: "PASS",
            },
          },
          risk_disposition: [
            {
              id: "RISK-FIX-001",
              status: "CLOSED_MITIGATED",
              mitigation: "Host version bound; unsupported controls remain procedural.",
              evidence: "phase3-host-validation.json",
            },
          ],
        },
      }),
    };
    const plannedTasks = JSON.stringify(doc.dod_manifest.tasks);
    const plannedRisks = JSON.stringify(doc.dod_manifest.risks);
    const input = writeFixture(dir, doc);
    const { html } = renderFile(input);
    assert.equal(JSON.stringify(doc.dod_manifest.tasks), plannedTasks);
    assert.equal(JSON.stringify(doc.dod_manifest.risks), plannedRisks);
    assert.match(html, /id="cap-task"/);
    assert.match(html, /id="cap-risk"/);
    assert.doesNotMatch(html, /Planned status/);
    assert.doesNotMatch(html, /Current status/);
    assert.match(html, /Current mitigation/);
    assert.match(html, /Current evidence/);
    const taskRow = html.split('<th scope="row" class="id">S1L</th>')[1].split("</tr>")[0];
    assert.doesNotMatch(taskRow, />BLOCKED<\/span>/);
    assert.match(taskRow, />PASS<\/span>/);
    assert.match(taskRow, /status-pass/);
    const riskRow = html.split('<th scope="row" class="id">RISK-FIX-001</th>')[1].split("</tr>")[0];
    assert.doesNotMatch(riskRow, />OPEN<\/span>/);
    assert.match(riskRow, /CLOSED_MITIGATED/);
    assert.match(riskRow, /Host version bound; unsupported controls remain procedural/);
    assert.match(riskRow, /phase3-host-validation\.json/);

    const planningOnly = renderFile(writeFixture(tempDir(), { dod_manifest: baseManifest({ models: [boundSvgModel()] }) })).html;
    const planningTaskRow = planningOnly.split('<th scope="row" class="id">S3</th>')[1].split("</tr>")[0];
    const planningRiskRow = planningOnly.split('<th scope="row" class="id">RISK-FIX-001</th>')[1].split("</tr>")[0];
    assert.match(planningTaskRow, />READY<\/span>/);
    assert.match(planningRiskRow, />OPEN<\/span>/);
  });

  it("embeds sanitized inline SVG and PNG fallback, and rejects unsafe assets", () => {
    const dir = tempDir();
    const svgDoc = {
      dod_manifest: baseManifest({
        models: [
          boundSvgModel({
            view: { format: "svg", inline: SAFE_SVG },
            digest: `sha256:${sha256Hex(Buffer.from(SAFE_SVG, "utf8"))}`,
          }),
        ],
      }),
    };
    const svgHtml = renderDodManifest(svgDoc, { assetRoot: dir }).html;
    assert.match(svgHtml, /<svg /);
    assert.match(svgHtml, /Fixture view/);

    const pngDigest = `sha256:${sha256Hex(PNG_1x1)}`;
    const pngDoc = {
      dod_manifest: baseManifest({
        models: [
          boundSvgModel({
            id: "MODEL-FIX-PNG",
            digest: pngDigest,
            view: { format: "png", path: "views/model.png" },
          }),
        ],
      }),
    };
    const pngInput = writeFixture(dir, pngDoc);
    const pngHtml = renderFile(pngInput).html;
    assert.match(pngHtml, /data:image\/png;base64,/);

    assert.throws(
      () => sanitizeSvg('<svg><script>alert(1)</script></svg>'),
      (err) => err.code === "UNSAFE_ASSET"
    );
    assert.throws(
      () => sanitizeSvg('<svg><rect onclick="alert(1)" x="0" y="0" width="1" height="1" /></svg>'),
      (err) => err.code === "UNSAFE_ASSET"
    );
    assert.throws(
      () => sanitizeSvg('<svg><a href="javascript:alert(1)"><text>x</text></a></svg>'),
      (err) => err.code === "UNSAFE_ASSET"
    );
    const badPng = {
      dod_manifest: baseManifest({
        models: [
          boundSvgModel({
            digest: `sha256:${sha256Hex(Buffer.from("not-a-png"))}`,
            view: { format: "png", path: "views/bad.png" },
          }),
        ],
      }),
    };
    const badInput = writeFixture(dir, badPng, { "views/bad.png": "not-a-png" });
    assert.throws(() => renderFile(badInput), (err) => err.code === "UNSAFE_ASSET");
  });

  it("preserves predefined and numeric XML entities in SVG text and attributes without double-escaping", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<text aria-label="A &amp; B &#38; C &#x26; D &lt;E&gt; &quot;F&quot; &apos;G&apos;">' +
      "A &amp; B &#38; C &#x26; D &lt;E&gt; &quot;F&quot; &apos;G&apos;" +
      "</text></svg>";
    const once = sanitizeSvg(input);
    assert.equal(once.includes("&amp;amp;"), false);
    assert.equal(once.includes("&amp;lt;"), false);
    assert.equal(once.includes("&amp;gt;"), false);
    assert.equal(once.includes("&amp;quot;"), false);
    assert.match(
      once,
      /aria-label="A &amp; B &amp; C &amp; D &lt;E&gt; &quot;F&quot; &#39;G&#39;"/
    );
    assert.match(once, />A &amp; B &amp; C &amp; D &lt;E&gt; &quot;F&quot; &#39;G&#39;</);
    assert.equal(sanitizeSvg(once), once);
    assert.equal(
      sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><text>A &amp; B</text></svg>'),
      '<svg xmlns="http://www.w3.org/2000/svg"><text>A &amp; B</text></svg>'
    );
  });

  it("isolates embedded SVG styles so they cannot select Manifest sections", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><style>#s8, #s9 { display: none !important; }</style><text x="0" y="20">Model</text></svg>';
    const html = renderDodManifest(
      {
        dod_manifest: baseManifest({
          models: [
            boundSvgModel({
              digest: `sha256:${sha256Hex(Buffer.from(svg, "utf8"))}`,
              view: { format: "svg", inline: svg },
            }),
          ],
        }),
      },
      { assetRoot: tempDir() }
    ).html;
    assert.match(html, /<svg /);
    assert.match(html, />Model</);
    assert.match(html, /id="s8"/);
    assert.match(html, /id="s9"/);
    assert.doesNotMatch(html, /<style>#s8,\s*#s9\s*\{/);
    assert.match(html, /\.dod-svg-[0-9a-f]+ #s8,\s*\.dod-svg-[0-9a-f]+ #s9/);
    const safe =
      '<svg xmlns="http://www.w3.org/2000/svg"><style>text { fill: #0e5c66; }</style><text x="0" y="20">Model</text></svg>';
    const safeHtml = renderDodManifest(
      {
        dod_manifest: baseManifest({
          models: [
            boundSvgModel({
              digest: `sha256:${sha256Hex(Buffer.from(safe, "utf8"))}`,
              view: { format: "svg", inline: safe },
            }),
          ],
        }),
      },
      { assetRoot: tempDir() }
    ).html;
    assert.match(safeHtml, /text\s*\{\s*fill:\s*#0e5c66/);
  });

  it("rejects CSS-escaped imports and resource-bearing CSS in stylesheets and style attributes", () => {
    const escapedImport =
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@im\\70ort "https://example.invalid/model.css";</style></svg>';
    assert.throws(() => sanitizeSvg(escapedImport), (err) => err.code === "UNSAFE_ASSET");
    assert.throws(
      () =>
        renderDodManifest(
          {
            dod_manifest: baseManifest({
              models: [
                boundSvgModel({
                  digest: `sha256:${sha256Hex(Buffer.from(escapedImport, "utf8"))}`,
                  view: { format: "svg", inline: escapedImport },
                }),
              ],
            }),
          },
          { assetRoot: tempDir() }
        ),
      (err) => err.code === "UNSAFE_ASSET"
    );
    assert.throws(
      () =>
        sanitizeSvg(
          '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="1" height="1" style="fill: u\\72l(https://example.invalid/x)" /></svg>'
        ),
      (err) => err.code === "UNSAFE_ASSET"
    );
  });

  it("rejects encoded unsafe SVG href and style values after entity decoding", () => {
    const unsafe = (svg) =>
      assert.throws(() => sanitizeSvg(svg), (err) => err.code === "UNSAFE_ASSET");
    unsafe('<svg xmlns="http://www.w3.org/2000/svg"><use href="javascript&#58;alert(1)" /></svg>');
    unsafe('<svg xmlns="http://www.w3.org/2000/svg"><use href="&#106;avascript:alert(1)" /></svg>');
    unsafe(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="1" height="1" style="fill: url&#40;javascript&#58;alert(1)&#41;" /></svg>'
    );
    unsafe(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="1" height="1" clip-path="url&#40;http://evil.example/&#41;" /></svg>'
    );
    unsafe('<svg xmlns="http://www.w3.org/2000/svg"><text>A &amp B</text></svg>');
  });

  it("prints the frozen-input binding contract used by S3L", () => {
    const text = bindingRequirement("MODEL-BDL-001");
    assert.match(text, /MODEL-BDL-001/);
    assert.match(text, /view": \{ "format": "svg"\|"png"/);
    assert.match(text, /digest/);
    const usage = cli([]);
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /Usage: node tools\/render-dod-manifest\.mjs/);
  });

  it("embeds closeout.model_views without mutating planning model rows", () => {
    const dir = tempDir();
    const planningModels = [
      {
        id: "MODEL-FIX-001",
        mode: "diagram-assisted",
        source: "design.md Mermaid context view",
        revision: "planning",
        viewpoint: "Lifecycle context",
        trace: "AC-FIX-001",
        limitations: "Workflow projection, not SysML",
        render_status: "READY",
      },
    ];
    const plannedBytes = JSON.stringify(planningModels);
    const digest = `sha256:${sha256Hex(Buffer.from(SAFE_SVG, "utf8"))}`;
    const doc = {
      dod_manifest: baseManifest({
        models: planningModels,
        closeout: {
          candidate: "pending",
          changed_paths: [],
          evidence: [],
          open_gaps: [],
          owner_acceptance: "pending",
          model_views: [
            {
              model_id: "MODEL-FIX-001",
              digest,
              view: { format: "svg", path: "views/model.svg" },
            },
          ],
        },
      }),
    };
    const input = writeFixture(dir, doc);
    const { html } = renderDodManifest(doc, { assetRoot: dir });
    assert.equal(JSON.stringify(doc.dod_manifest.models), plannedBytes);
    assert.equal("view" in doc.dod_manifest.models[0], false);
    assert.equal("digest" in doc.dod_manifest.models[0], false);
    const reloaded = JSON.parse(readFileSync(input, "utf8"));
    assert.equal(JSON.stringify(reloaded.dod_manifest.models), plannedBytes);
    assert.match(html, /<svg /);
    assert.match(html, /MODEL-FIX-001/);
    assert.match(html, new RegExp(`sha256:${digest.slice("sha256:".length)}`));
  });

  it("rejects supplemental digest mismatch, duplicates, unknown ids, and semantic overrides", () => {
    const dir = tempDir();
    const unbound = {
      id: "MODEL-FIX-001",
      mode: "diagram-assisted",
      source: "fixture",
      viewpoint: "Fixture",
      trace: "AC-FIX-001",
      limitations: "Fixture",
      render_status: "READY",
    };
    const digest = `sha256:${sha256Hex(Buffer.from(SAFE_SVG, "utf8"))}`;
    const view = { format: "svg", path: "views/model.svg" };

    const stale = writeFixture(dir, {
      dod_manifest: baseManifest({
        models: [unbound],
        closeout: {
          candidate: "pending",
          changed_paths: [],
          evidence: [],
          open_gaps: [],
          owner_acceptance: "pending",
          model_views: [{ model_id: "MODEL-FIX-001", digest: `sha256:${"0".repeat(64)}`, view }],
        },
      }),
    });
    assert.throws(() => renderFile(stale), (err) => err.code === "STALE_VIEW");

    const duplicate = writeFixture(dir, {
      dod_manifest: baseManifest({
        models: [unbound],
        closeout: {
          candidate: "pending",
          changed_paths: [],
          evidence: [],
          open_gaps: [],
          owner_acceptance: "pending",
          model_views: [
            { model_id: "MODEL-FIX-001", digest, view },
            { model_id: "MODEL-FIX-001", digest, view },
          ],
        },
      }),
    });
    assert.throws(() => renderFile(duplicate), (err) => err.code === "DUPLICATE_VIEW_BINDING");

    const unknown = writeFixture(dir, {
      dod_manifest: baseManifest({
        models: [unbound],
        closeout: {
          candidate: "pending",
          changed_paths: [],
          evidence: [],
          open_gaps: [],
          owner_acceptance: "pending",
          model_views: [{ model_id: "MODEL-UNKNOWN", digest, view }],
        },
      }),
    });
    assert.throws(() => renderFile(unknown), (err) => err.code === "UNKNOWN_VIEW_BINDING");

    const override = writeFixture(dir, {
      dod_manifest: baseManifest({
        models: [unbound],
        closeout: {
          candidate: "pending",
          changed_paths: [],
          evidence: [],
          open_gaps: [],
          owner_acceptance: "pending",
          model_views: [
            { model_id: "MODEL-FIX-001", digest, view, mode: "sysml-v2", viewpoint: "rewritten" },
          ],
        },
      }),
    });
    assert.throws(() => renderFile(override), (err) => err.code === "SEMANTIC_OVERRIDE");

    const planned = writeFixture(dir, {
      dod_manifest: baseManifest({
        models: [boundSvgModel()],
        closeout: {
          candidate: "pending",
          changed_paths: [],
          evidence: [],
          open_gaps: [],
          owner_acceptance: "pending",
          model_views: [{ model_id: "MODEL-FIX-001", digest, view }],
        },
      }),
    });
    assert.throws(() => renderFile(planned), (err) => err.code === "CONFLICTING_VIEW_BINDING");

    const missingStillFails = writeFixture(dir, {
      dod_manifest: baseManifest({
        models: [
          {
            id: "MODEL-FIX-MISSING",
            mode: "diagram-assisted",
            source: "views/missing.svg",
            viewpoint: "Missing required view",
            trace: "AC-FIX-001",
            limitations: "Cannot assess without the view",
            render_status: "MISSING",
            required: true,
            selected: true,
          },
        ],
        closeout: {
          candidate: "pending",
          changed_paths: [],
          evidence: [],
          open_gaps: [],
          owner_acceptance: "pending",
          model_views: [{ model_id: "MODEL-FIX-MISSING", digest, view }],
        },
      }),
    });
    assert.throws(() => renderFile(missingStillFails), (err) => err.code === "MISSING_VIEW");
  });
});
