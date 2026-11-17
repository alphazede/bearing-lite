"use strict";
// S10T child runner: one decide() call in its own process, so the test can capture
// the adapter's own stdout/stderr bytes and exercise the cross-process record lock.
// Usage: node run-decide.cjs <job.json> <out.json>; job = { input, ctx }.
// The result (or a thrown error) goes to <out.json>, never to stdout/stderr.
const fs = require("node:fs");
const path = require("node:path");

const [job, out] = process.argv.slice(2);
const { input, ctx } = JSON.parse(fs.readFileSync(job, "utf8"));
const MODULE = path.resolve(__dirname, "../../../hooks/decision-adapter.cjs");

Promise.resolve()
  .then(() => require(MODULE).decide(input, ctx))
  .then(
    (result) => fs.writeFileSync(out, JSON.stringify({ result })),
    (err) => fs.writeFileSync(out, JSON.stringify({ thrown: String((err && err.stack) || err) })),
  );
