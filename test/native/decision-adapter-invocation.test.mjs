/** S11T SEIT-NATIVE-ADAPTER (B30-207, B30-209, B30-212, B30-220; F05, SM02; finding F13).
 * Opt-in: runs only with BEARING_CODEX_BIN set to the pinned codex-cli 0.162.1 (CMD-BL-NATIVE-ADAPTER).
 * Real installed Codex + candidate plugin in an owned temporary HOME/CODEX_HOME. Two loopback
 * drivers bound to port 0: a Responses driver (harmless provider substitute; it never returns a
 * tool call) and a systemone decision driver that logs every request. No hosted backend.
 *
 * Flow per run: `codex exec` creates a thread with no plan binding (negative: no adapter call),
 * the test writes plan.md binding that thread id to a task carrying an eligible
 * `decision_choice`, then `codex exec resume <id>` fires the registered SessionStart and Stop.
 * Codex 0.162.1 delivers the resumed SessionStart hook context as a developer message in the next
 * provider request; that is the observable hook output compared byte for byte. Stop output on
 * Claude/Codex carries no advice (hooks/cursor-stop.cjs), so Stop is observed through the driver
 * log only. Runs: adapter disabled (no key), positive, and timeout (driver delays past the 15 s
 * registration budget). Host-side contract as in test/decision-adapter-host-event.test.mjs.
 * Claude Code native invocation stays unverified (F13): no authenticated disposable profile.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CODEX = process.env.BEARING_CODEX_BIN;
const PIN = '0.162.1';
const CASES = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/decision-adapter/cases.json'), 'utf8'));
const KEY_VAR = 'TEST_DECISION_KEY';
const KEY = 'TESTKEY-NATIVE-CANARY-7203';
const PACKET_CANARY = 'PACKET-CANARY-5521';
const MARK = 'Bearing Lite activation';

test('SEIT-NATIVE-ADAPTER native Codex SessionStart/Stop call the decision adapter once, silent on timeout', { skip: CODEX ? false : 'opt-in: set BEARING_CODEX_BIN to the pinned codex-cli 0.162.1', timeout: 175000 }, async t => {
  const deadline = Date.now() + 170000;
  const tmp = mkdtempSync(path.join(tmpdir(), `bearing-native-adapter-${process.pid}-${process.hrtime.bigint()}-`));
  const home = path.join(tmp, 'home'), codexHome = path.join(tmp, 'codex-home'), repo = path.join(tmp, 'repo');
  for (const d of [home, codexHome, repo, path.join(tmp, 'xdg')]) mkdirSync(d);
  mkdirSync(path.join(repo, '.git')); // bounds the plan-binding walk
  const env = { PATH: process.env.PATH || '', HOME: home, XDG_CONFIG_HOME: path.join(tmp, 'xdg'), CODEX_HOME: codexHome, LANG: 'C.UTF-8', TMPDIR: tmp };
  const groups = new Set();
  const servers = [];
  let child, stderrAll = '';
  const run = (cmd, args) => {
    const p = spawnSync(cmd, args, { cwd: repo, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: Math.max(1, deadline - Date.now()) });
    if (p.pid && process.platform !== 'win32') groups.add(p.pid);
    assert.equal(p.error, undefined, `ENVIRONMENT_FAILURE: ${p.error?.message}`);
    assert.equal(p.status, 0, `ENVIRONMENT_FAILURE: ${cmd} ${args.join(' ')}: ${p.stderr?.slice(-3000)}`);
    return p.stdout;
  };
  const listen = server => new Promise((resolve, reject) => { servers.push(server); server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)); });
  try {
    const version = run(CODEX, ['--version']).trim();
    assert.ok(version.endsWith(PIN), `ENVIRONMENT_FAILURE: ${version} is not the pinned codex-cli ${PIN}`);

    // Decision driver: logs arrival time and body; answers, or delays past the budget.
    const decisions = [];
    let decisionMode = 'answer';
    const decisionUrl = await listen(http.createServer(async (req, res) => {
      let raw = ''; for await (const c of req) raw += c;
      decisions.push({ at: Date.now(), raw, authorization: req.headers.authorization });
      if (decisionMode === 'delay') { setTimeout(() => { if (!res.destroyed) res.end('{}'); }, 60000).unref(); return; }
      const body = JSON.parse(raw);
      const isFit = q => q.options.length === 2 && q.options.includes('yes') && q.options.includes('no');
      const fit = body.questions.find(isFit), choice = body.questions.find(q => !isFit(q));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ answers: { [fit.id]: { yes: 0.9, no: 0.1 }, [choice.id]: Object.fromEntries(choice.options.map((l, i) => [l, i === 0 ? 0.9 : 0.1 / (choice.options.length - 1)])) } }));
    }));

    // Responses driver: every request gets a plain final message; records inputs and arrival time.
    const provider = [];
    const sse = (res, d) => res.write(`event: ${d.type}\ndata: ${JSON.stringify(d)}\n\n`);
    const providerUrl = await listen(http.createServer(async (req, res) => {
      let raw = ''; for await (const c of req) raw += c;
      provider.push({ at: Date.now(), body: JSON.parse(raw) });
      const item = { type: 'message', id: 'msg_done', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'done', annotations: [] }] };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      sse(res, { type: 'response.created', response: { id: 'resp', status: 'in_progress', output: [] } });
      sse(res, { type: 'response.output_item.done', output_index: 0, item });
      sse(res, { type: 'response.completed', response: { id: 'resp', object: 'response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
      res.end();
    }));

    // Install the exact candidate; only its backend configuration points at the loopback driver.
    const market = path.join(tmp, 'marketplace');
    run(process.execPath, [path.join(ROOT, 'tools/prepare-codex-plugin.mjs'), '--out', market]);
    writeFileSync(path.join(market, 'bearing-lite/hooks/decision-backend.json'), JSON.stringify({ protocol: 'systemone', base_url: decisionUrl, model_id: 'test-model-1.0', key_variable_name: KEY_VAR }, null, 2) + '\n');
    run(CODEX, ['plugin', 'marketplace', 'add', market]);
    run(CODEX, ['plugin', 'add', 'bearing-lite@bearing-lite']);

    const base = ['--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust',
      '-c', 'model_provider="sentinel"', '-c', 'model="sentinel"', '-c', 'model_providers.sentinel.name="Owned local sentinel"',
      '-c', `model_providers.sentinel.base_url="${providerUrl}/v1"`, '-c', 'model_providers.sentinel.wire_api="responses"',
      '-c', 'model_providers.sentinel.requires_openai_auth=false', '-c', 'model_providers.sentinel.request_max_retries=0',
      '-c', 'model_providers.sentinel.stream_max_retries=0', '-c', 'features.shell_snapshot=false'];
    const exec = (args, withKey) => new Promise((resolve, reject) => {
      const e = withKey ? { ...env, [KEY_VAR]: KEY } : env;
      let stdout = '', stderr = '';
      // stdin ignored is /dev/null, per the native exec EOF contract.
      child = spawn(CODEX, ['exec', ...base, ...args], { cwd: repo, env: e, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      if (child.pid && process.platform !== 'win32') groups.add(child.pid);
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error(`ENVIRONMENT_FAILURE: native deadline; stderr tail ${stderr.slice(-3000)}; events ${stdout.slice(-3000)}`)); }, Math.max(1, deadline - Date.now()));
      child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => { stderr += d; stderrAll += d; });
      child.on('error', err => { clearTimeout(timer); reject(err); });
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    });
    const developerTexts = body => (body.input || []).filter(i => i.role === 'developer').flatMap(i => (i.content || []).map(c => c.text || '')).filter(x => x.includes(MARK));

    let n = 0;
    async function session(label, withKey) {
      // 1. Unbound thread: no binding means no adapter call.
      writeFileSync(path.join(repo, 'plan.md'), '# Visible native test plan (unbound)\n');
      const before = decisions.length;
      const created = await exec(['Reply done.'], withKey);
      assert.equal(created.code, 0, `${label} create exit=${created.code} signal=${created.signal}; ${created.stderr.slice(-3000)}`);
      assert.equal(decisions.length, before, `${label}: unbound session must not call the adapter`);
      const started = created.stdout.split('\n').filter(Boolean).map(l => JSON.parse(l)).find(e => e.type === 'thread.started');
      assert.ok(started?.thread_id, `ENVIRONMENT_FAILURE: no thread.started event; ${created.stdout.slice(-2000)}`);
      // 2. Bind that native session to a task carrying an eligible choice, then resume it.
      const decision = { decision_type: 'dispatch_classification', decision_point: `dispatch:native:${label}:${++n}`, evidence_revision: `ev-${label}`, facts: { role: 'implementer', gate_exit_code: 1 }, packet: CASES.packet, options: { ...CASES.options } };
      writeFileSync(path.join(repo, 'plan.md'), ['# Visible native test plan', '- journey: native-adapter',
        `- bearing_session: ${JSON.stringify({ owner_requested: true, session_id: started.thread_id, task_id: 'T1' })}`, '',
        '### task_id: T1', '- status: IN_PROGRESS', '- assigned_role: Implementer', '- next_action: implement the slice',
        `- decision_choice: ${JSON.stringify(decision)}`, ''].join('\n'));
      const mark = { decisions: decisions.length, provider: provider.length };
      const resumed = await exec(['resume', started.thread_id, 'Reply done again.'], withKey);
      assert.equal(resumed.code, 0, `${label} resume exit=${resumed.code} signal=${resumed.signal}; ${resumed.stderr.slice(-3000)}`);
      const turn = provider.slice(mark.provider);
      assert.ok(turn.length >= 1, `ENVIRONMENT_FAILURE: ${label}: resumed turn made no provider request`);
      for (const r of turn) assert.ok(!(r.body.input || []).some(i => i.type === 'function_call' || i.type === 'function_call_output'), `${label}: a model tool call occurred`);
      const context = developerTexts(turn[0].body);
      assert.equal(context.length, 1, `ENVIRONMENT_FAILURE: ${label}: resumed SessionStart context not visible; inputs ${JSON.stringify(turn[0].body.input).slice(-2000)}`);
      for (const text of [context[0], resumed.stdout, resumed.stderr]) {
        assert.ok(!text.includes(KEY), `${label}: backend key in hook-visible output`);
        assert.ok(!text.includes(PACKET_CANARY), `${label}: packet text echoed`);
      }
      return { context: context[0], calls: decisions.slice(mark.decisions), firstProviderAt: turn[0].at };
    }

    const disabled = await session('disabled', false);
    assert.equal(disabled.calls.length, 0, 'adapter-disabled run makes no backend request');

    const positive = await session('positive', true);
    assert.equal(positive.calls.length, 1, `driver must receive exactly one request inside native SessionStart/Stop (got ${positive.calls.length}); stderr tail ${stderrAll.slice(-2000)}`);
    assert.ok(positive.calls[0].at <= positive.firstProviderAt, 'request made inside SessionStart, before any model turn');
    assert.equal(positive.calls[0].authorization, `Bearer ${KEY}`);
    assert.equal(JSON.parse(positive.calls[0].raw).state.untrusted.packet, CASES.packet, 'packet sent as written in untrusted state');
    assert.ok(positive.context.includes(disabled.context), 'existing SessionStart output preserved');

    decisionMode = 'delay';
    const timedOut = await session('timeout', true);
    assert.ok(timedOut.calls.length >= 1, 'timeout run must call the adapter (otherwise identity proves nothing)');
    assert.equal(timedOut.context, disabled.context, 'timeout leaves SessionStart hook output byte-identical to the adapter-disabled run');

    t.diagnostic(`codex ${version}; decision requests disabled=0 positive=${positive.calls.length} timeout=${timedOut.calls.length}; provider requests=${provider.length}; tool calls=0; hosted backend calls=0`);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    for (const server of servers) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    // Native CLI descendants may outlive exec; stop only groups this fixture started.
    for (const pid of groups) {
      try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
