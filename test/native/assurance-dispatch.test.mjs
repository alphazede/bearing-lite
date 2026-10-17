/** #209 native launch barrier. Real installed Codex + candidate plugin, isolated HOME/config.
 * A local Responses protocol driver supplies fixed tool calls; it is the explicitly requested
 * harmless provider substitute, not model evidence. The launch sentinel writes only owned files.
 * Resource group: one warm loopback driver per binary, bind(0); no shared ports/config/credentials.
 * One 90s deadline covers preparation and all engine calls. No external provider endpoint exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CODEX = process.env.BEARING_CODEX_BIN || 'codex';
const json = (file, v) => writeFileSync(file, JSON.stringify(v, null, 2) + '\n');
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');

test('209 native Codex installed plugin denies excess before harmless provider-launch sentinel', { timeout: 95000 }, async t => {
  const deadline = Date.now() + 90000;
  const tmp = mkdtempSync(path.join(tmpdir(), `bearing-native-dispatch-${process.pid}-${process.hrtime.bigint()}-`));
  const home = path.join(tmp, 'home'), codexHome = path.join(tmp, 'codex-home'), repo = path.join(tmp, 'repo');
  for (const d of [home, codexHome, repo]) mkdirSync(d);
  const env = { PATH: process.env.PATH || '', HOME: home, CODEX_HOME: codexHome, LANG: 'C.UTF-8', TMPDIR: tmp };
  const run = (cmd, args) => {
    const p = spawnSync(cmd, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: Math.max(1, deadline - Date.now()) });
    assert.equal(p.error, undefined, `ENVIRONMENT_FAILURE: ${p.error?.message}`);
    assert.equal(p.status, 0, `ENVIRONMENT_FAILURE: ${p.stderr?.slice(-3000)}`);
    return p.stdout;
  };
  let server, child;
  try {
    const version = run(CODEX, ['--version']).trim();
    t.diagnostic(`native client: ${version}; pinned release target: 0.162.1; no paid provider calls`);
    run(process.execPath, [path.join(ROOT, 'tools/prepare-codex-plugin.mjs'), '--out', path.join(tmp, 'marketplace')]);
    run(CODEX, ['plugin', 'marketplace', 'add', path.join(tmp, 'marketplace')]);
    run(CODEX, ['plugin', 'add', 'bearing-lite@bearing-lite']);
    const marker = path.join(repo, 'provider-launches.txt');
    const sentinel = path.join(repo, 'provider-sentinel.cjs');
    writeFileSync(sentinel, "require('node:fs').appendFileSync(process.argv[2], process.argv[3] + '\\n');\n");
    const ids = ['first', 'peer', 'excess', 'repair', 'close', 'retry', 'renamed', 'reset', 'invalid'];
    const commands = Object.fromEntries(ids.map(id => [id, `node '${sentinel}' '${marker}' '${id}'`]));
    let toolsSeen, toolName, toolArgs, steps = 0, calls = 0, failure, stderr = '', stdout = '';
    const nativeToolReturns = [];
    const recordFile = path.join(repo, 'task-record.json');
    let slots;
    function fixtureFromNativeSchema(tools) {
      toolsSeen = tools.map(s => s.name).filter(Boolean);
      const tool = tools.find(s => s.name === 'exec_command') || tools.find(s => s.name === 'shell_command');
      assert.ok(tool, `CONTRACT_FAILURE: no native shell function in ${JSON.stringify(toolsSeen)}`);
      toolName = tool.name;
      toolArgs = id => toolName === 'exec_command' ? { cmd: commands[id], max_output_tokens: 1000 } : { command: commands[id] };
      // Codex's native Bash hook carries command; optional description is captured below if emitted.
      slots = ids.map(id => ({ id, kind: id === 'repair' ? 'repair' : id === 'close' ? 'deterministic' : 'review', group: ['first', 'peer'].includes(id) ? 'round-1' : id, unit_id: 'W1', candidate: 'candidate-a', scope: 'native-sentinel', tool_name: 'Bash', tool_input: { command: commands[id] } }));
      const declarationFile = path.join(repo, 'implementation.json');
      json(declarationFile, { waves: [{ id: 'W1' }], journey_settings: { lifecycle_id: 'native-test', assurance_dispatch: { slots } } });
      json(recordFile, { journey: 'native-test', units: [{ unit_id: 'W1', unit_kind: 'wave', assurance_rounds: 0, assurance_repairs: 0, receipts: [{ kind: 'gate_chain', unit_id: 'W1', verdict: 'PASS' }] }], dispatch_log: [], amendments: [] });
      writeFileSync(path.join(repo, 'plan.md'), `# Visible native test plan\n- assurance_dispatch: ${JSON.stringify({ journey: 'native-test', declaration_path: 'implementation.json', declaration_sha256: sha(declarationFile), task_record_path: 'task-record.json' })}\n`);
    }
    const sse = (res, data) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    server = http.createServer(async (req, res) => {
      try {
        assert.ok(req.url.endsWith('/responses'), `driver received unexpected path ${req.url}`);
        let raw = ''; for await (const chunk of req) raw += chunk;
        const input = JSON.parse(raw); calls++;
        nativeToolReturns.push(...(input.input || []).filter(item => item.type === 'function_call_output').map(item => item.output));
        assert.ok(calls <= 12, 'native driver exceeded fixed tool sequence');
        if (!toolsSeen) fixtureFromNativeSchema(input.tools || []);
        if (steps === 2) {
          const record = JSON.parse(readFileSync(recordFile));
          assert.equal(record.dispatch_log.length, 2, 'fixed native group slots must both reserve');
          assert.equal(record.units[0].assurance_rounds, 1, 'fixed group consumes exactly one round');
        }
        if (steps === 3) {
          const record = JSON.parse(readFileSync(recordFile));
          assert.equal(record.dispatch_log.length, 2, 'excess must not reserve');
          record.dispatch_log[0].result = 'REPAIR_REQUIRED'; record.dispatch_log[1].result = 'PASS'; json(recordFile, record);
        }
        if (steps === 4) {
          const record = JSON.parse(readFileSync(recordFile));
          assert.equal(record.dispatch_log[2]?.kind, 'repair'); record.dispatch_log[2].result = 'PASS'; json(recordFile, record);
        }
        if (steps === 5) {
          const record = JSON.parse(readFileSync(recordFile));
          assert.equal(record.dispatch_log[3]?.kind, 'deterministic'); record.dispatch_log[3].result = 'PASS'; record.units[0].deterministic_gate = 'PASS'; json(recordFile, record);
        }
        if (steps === 7) {
          const record = JSON.parse(readFileSync(recordFile)); record.units[0].assurance_rounds = 0; json(recordFile, record);
        }
        if (steps === 8) writeFileSync(recordFile, '{}\n');
        const id = ids[steps++];
        const item = id ? { type: 'function_call', id: `fc_${steps}`, call_id: `call_${steps}`, name: toolName, arguments: JSON.stringify(toolArgs(id === 'retry' ? 'first' : id)), status: 'completed' }
          : { type: 'message', id: 'msg_done', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Native sentinel sequence complete.', annotations: [] }] };
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        sse(res, { type: 'response.created', response: { id: `resp_${steps}`, status: 'in_progress', output: [] } });
        sse(res, { type: 'response.output_item.done', output_index: 0, item });
        sse(res, { type: 'response.completed', response: { id: `resp_${steps}`, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
        res.end();
      } catch (e) { failure = e; res.writeHead(500); res.end('owned driver failure'); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}/v1`;
    const config = path.join(codexHome, 'config.toml');
    assert.ok(existsSync(config), 'native installer must create isolated plugin config');
    // CLI overrides avoid ambiguity with plugin tables generated by the native installer.
    const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust',
      '-c', 'model_provider="sentinel"', '-c', 'model="sentinel"', '-c', 'model_providers.sentinel.name="Owned local sentinel"',
      '-c', `model_providers.sentinel.base_url="${url}"`, '-c', 'model_providers.sentinel.wire_api="responses"',
      '-c', 'model_providers.sentinel.requires_openai_auth=false', '-c', 'model_providers.sentinel.request_max_retries=0',
      '-c', 'model_providers.sentinel.stream_max_retries=0', '-c', 'features.shell_snapshot=false', 'Execute only the fixed local sentinel sequence.'];
    const exit = await new Promise((resolve, reject) => {
      // stdin ignored is /dev/null, per the native exec EOF contract.
      child = spawn(CODEX, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error(`ENVIRONMENT_FAILURE: native deadline; stderr tail ${stderr.slice(-3000)}; events ${stdout.slice(-3000)}`)); }, Math.max(1, deadline - Date.now()));
      child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    if (failure) throw failure;
    assert.equal(exit.code, 0, `native phase exit=${exit.code} signal=${exit.signal}; ${stderr.slice(-3000)}; events ${stdout.slice(-3000)}`);
    assert.equal(steps, 10, `native sequence incomplete; ${stderr.slice(-3000)}; ${stdout.slice(-3000)}`);
    assert.ok(existsSync(marker), `native allowed sentinel never started; ${stderr.slice(-3000)}; ${stdout.slice(-4000)}`);
    assert.deepEqual(readFileSync(marker, 'utf8').trim().split('\n'), ['first', 'peer', 'repair', 'close']);
    assert.match(JSON.stringify(nativeToolReturns), /assurance_round_limit|dispatch_slot_already_reserved/, 'native tool return must carry the hook denial');
    t.diagnostic(`native allow/deny/fixed group/deterministic closure/renamed activity/counter reset/invalid state proven; fixed driver requests=${calls}; real paid provider calls=0`);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    rmSync(tmp, { recursive: true, force: true });
  }
});
