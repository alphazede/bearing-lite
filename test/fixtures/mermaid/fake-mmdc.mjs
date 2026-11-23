#!/usr/bin/env node
// Stand-in for a local mmdc: writes the pre-rendered mmdc output named by FAKE_MMDC_SVG to `-o`.
import { copyFileSync } from "node:fs";

const out = process.argv[process.argv.indexOf("-o") + 1];
copyFileSync(process.env.FAKE_MMDC_SVG, out);
