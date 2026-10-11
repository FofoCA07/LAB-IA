import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { changeProposalConfig, createChangeProposalHandler, parseChangeProposal,
  validatePatchStructure, proposalModelBudgetSeconds, modelTimeoutSource, runProposalGit, validateChangeRequest, validateProposalPolicy, validProposalPath } from './change-proposal.js';

const head = 'a'.repeat(40);
const patch = 'diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-before\n+after\n';
const proposal = { summary: 'Actualizar el texto.', files: ['example.txt'], patch };
const readEvent = (filePath, status = 'completed', overrides = {}) => JSON.stringify({
  type: 'tool_use', sessionID: 'execution', part: {
    type: 'tool', tool: 'read', id: 'read-part', messageID: 'read-message', sessionID: 'execution',
    state: { status, input: { filePath }, time: { start: 1, end: 2 },
      output: 'PRIVATE_READ_CONTENT', metadata: { display: { type: 'file', path: filePath } }, ...overrides },
  },
});
const proposalEvent = (value = proposal) => JSON.stringify({ type: 'text', sessionID: 'execution', part: {
  type: 'text', id: 'part', messageID: 'final', sessionID: 'execution', text: JSON.stringify(value),
} });
const jsonl = (value = proposal) => [
  ...(Array.isArray(value?.files) ? value.files.filter((path) => typeof path === 'string')
    .map((path) => readEvent(`/workspace/${path}`)) : []), proposalEvent(value),
].join('\n');
const policy = {
  name: 'senior-developer', mode: 'all',
  tools: { invalid: false, read: true, glob: false, grep: false, edit: false, write: false, bash: false, task: false },
  permission: [
    { permission: '*', pattern: '*', action: 'deny' },
    ...Object.entries(JSON.parse(changeProposalConfig.split('=').slice(1).join('='))
      .agent['senior-developer'].permission.read)
      .map(([pattern, action]) => ({ permission: 'read', pattern, action })),
    ...['edit', 'write', 'bash', 'task', 'glob', 'grep'].map((permission) => ({ permission, pattern: '*', action: 'deny' })),
  ],
};

async function fixture(t) {
  const parent = resolve(import.meta.dirname, '../dist');
  await mkdir(parent, { recursive: true });
  const workspace = await mkdtemp(`${parent}/proposal-test-`);
  t.after(() => rm(workspace, { recursive: true, force: true }));
  // Fixtures only: no commit, no OpenCode call, no live LAB-IA server/SQLite.
  execFileSync('git', ['init', '--quiet', workspace], { shell: false });
  await writeFile(`${workspace}/example.txt`, 'before\n');
  await writeFile(`${workspace}/binary.bin`, Buffer.from([0, 1, 2]));
  await writeFile(`${workspace}/.env`, 'SECRET=value\n');
  await symlink('example.txt', `${workspace}/alias.txt`);
  execFileSync('git', ['add', '--', 'example.txt', 'binary.bin', '.env', 'alias.txt'], { cwd: workspace, shell: false });
  return workspace;
}

function harness(workspace, options = {}) {
  const calls = [];
  let modelCalls = 0;
  let statusCalls = 0;
  let headCalls = 0;
  const handler = createChangeProposalHandler({
    getOpenCodeStatus: async () => {
      if (options.statusError) throw options.statusError;
      return ({ available: true, running: true, cliAvailable: true, workspace, ...options.status });
    },
    queryOpenCode: async (args) => {
      assert.equal(args[args.indexOf('--env') + 1], changeProposalConfig);
      assert.equal(args[args.indexOf('--workdir') + 1], '/workspace');
      assert.equal(args.at(-1), 'senior-developer');
      assert.ok(args.includes('--pure'));
      return JSON.stringify(options.policy ?? policy);
    },
    git: async (cwd, args, settings) => {
      assert.equal(cwd, workspace);
      calls.push(args);
      if (args[0] === 'status') return options.statusOutput?.(++statusCalls) ?? '';
      if (args.join(' ') === 'rev-parse HEAD') return options.headOutput?.(++headCalls) ?? head;
      if (args[0] === 'apply') {
        assert.deepEqual(args, ['apply', '--check', '--recount', '--index', '--whitespace=error', '-']);
        options.checkInput?.(settings.input);
        if (options.rejectMetadata && settings.input.includes('index 1234567..abcdef0 100755\n')) {
          throw Object.assign(new Error('PRIVATE Git metadata rejection'), { code: 1, stderr: 'PRIVATE' });
        }
        if (options.applyError) throw options.applyError;
        if (options.applyFails) throw new Error('Internal Git detail');
      }
      return runProposalGit(cwd, args, settings);
    },
    model: async (description, deadline, reportBudget) => {
      modelCalls++;
      assert.equal(typeof description, 'string');
      assert.ok(deadline <= Date.now() + 180_000);
      if (options.model) return options.model(reportBudget);
      return jsonl(options.proposal);
    },
    json: (response, status, data) => Object.assign(response, { status, data }),
  });
  const invoke = async (body = { request: 'Cambiar el texto' }, settings = {}) => {
    const request = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
    Object.assign(request, { method: 'POST', url: '/api/opencode/change-proposal', ...settings,
      headers: { 'content-type': 'application/json', host: 'localhost', ...settings.headers } });
    const response = { setHeader() {} };
    await handler(request, response);
    return response;
  };
  return { invoke, calls, get modelCalls() { return modelCalls; } };
}

test('request accepts only trimmed development text, with bounded length and controls', () => {
  assert.equal(validateChangeRequest({ request: ' hola\n\tmundo ' }), 'hola\n\tmundo');
  for (const body of [null, [], 'hi', {}, { request: 1 }, { request: '' }, { request: ' ' },
    { request: 'x'.repeat(4001) }, { request: 'x\r' }, { request: '\0x' },
    { request: '\u0085x' }, { request: 'x', agent: 'reviewer' }, { request: 'x', path: '/tmp' }]) {
    assert.throws(() => validateChangeRequest(body), (error) => error.status === 400);
  }
});

test('paths reject traversal, absolute/Windows paths, secrets, metadata and aliases', () => {
  assert.ok(validProposalPath('src/file with spaces.txt'));
  for (const path of ['/tmp/file', '../file', 'src/../file', './file', 'src//file', 'src/file/',
    'C:/file', 'src\\file', 'src/.env.local', 'src/key.pem', 'id_ed25519.pub',
    'credentials.json', 'secrets/file', '.ssh/config', '.git/config', 'src/.npmrc']) assert.equal(validProposalPath(path), false, path);
});

test('contract and canonical patch grammar reject unsafe and mismatched patches', () => {
  assert.deepEqual(parseChangeProposal(jsonl()), proposal);
  const bad = [
    { ...proposal, extra: true }, { ...proposal, summary: '' }, { ...proposal, files: [] },
    { ...proposal, files: ['example.txt', 'example.txt'] }, { ...proposal, files: ['other.txt'] },
    { ...proposal, files: Array.from({ length: 21 }, (_, i) => `${i}.txt`) },
    { ...proposal, patch: patch.replace('--- a/example.txt', '--- /dev/null') },
    { ...proposal, patch: patch.replace('+++ b/example.txt', '+++ /dev/null') },
    { ...proposal, patch: patch.replace('--- a/', 'new file mode 100644\n--- a/') },
    { ...proposal, patch: patch.replace('--- a/', 'rename from example.txt\n--- a/') },
    { ...proposal, patch: patch.replace('--- a/', 'old mode 100644\nnew mode 100755\n--- a/') },
    { ...proposal, patch: 'GIT binary patch\nliteral 1\n' },
    { ...proposal, patch: patch.replace('+after', '+\0') },
    { ...proposal, patch: patch + patch },
    { ...proposal, patch: 'x'.repeat(512 * 1024 + 1) },
  ];
  for (const value of bad) assert.throws(() => parseChangeProposal(jsonl(value)));
});

test('effective policy fails closed on writable/unknown tools or permission exceptions', () => {
  validateProposalPolicy(policy);
  for (const bad of [
    { ...policy, name: 'reviewer' }, { ...policy, mode: 'subagent' },
    ...['edit', 'write', 'bash', 'task', 'glob', 'grep', 'custom_tool'].map((name) => ({ ...policy, tools: { ...policy.tools, [name]: true } })),
    { ...policy, permission: policy.permission.slice(1) },
    { ...policy, permission: [...policy.permission, { permission: 'bash', pattern: '*', action: 'allow' }] },
    { ...policy, permission: [...policy.permission, { permission: 'custom*', pattern: '*', action: 'allow' }] },
  ]) assert.throws(() => validateProposalPolicy(bad), (error) => error.status === 503);
});

test('sensitive access cannot be reopened, including narrow, wildcard and ask exceptions', () => {
  for (const permission of ['read', '*', 'r*', 'r?ad']) {
    for (const pattern of ['*', '.env', '.env.production', 'config/.env', 'cert.pem', 'private.key',
      'credentials.json', 'secrets/deep/key.txt', '*/secrets*', 'id_rsa', '.aws/credentials']) {
      for (const action of ['allow', 'ask']) {
        assert.throws(() => validateProposalPolicy({ ...policy, permission: [
          ...policy.permission, { permission, pattern, action },
        ] }), (error) => error.status === 503, `${permission}:${pattern}:${action}`);
      }
    }
  }
  // Moving the broad read allow after the denies also defeats last-match precedence.
  const reordered = policy.permission.filter((rule) => !(rule.permission === 'read' && rule.pattern === '*'));
  reordered.push({ permission: 'read', pattern: '*', action: 'allow' });
  assert.throws(() => validateProposalPolicy({ ...policy, permission: reordered }));
  // All expected patterns must remain present; tools.read alone is insufficient.
  for (const denied of policy.permission.filter((rule) => rule.permission === 'read' && rule.action === 'deny')) {
    assert.throws(() => validateProposalPolicy({ ...policy,
      permission: policy.permission.filter((rule) => rule !== denied),
    }), (error) => error.status === 503);
  }
});

test('a reopened sensitive read policy is rejected before the model runs', async (t) => {
  const workspace = await fixture(t);
  const h = harness(workspace, { policy: { ...policy, permission: [
    ...policy.permission, { permission: 'read', pattern: 'config/.env.production', action: 'allow' },
  ] } });
  const response = await h.invoke();
  assert.equal(response.status, 503);
  assert.equal(response.data.code, 'UNSAFE_AGENT');
  assert.equal(h.modelCalls, 0);
});

test('JSONL with glob or grep tool calls is rejected even with valid proposal JSON', () => {
  for (const tool of ['glob', 'grep']) {
    assert.throws(() => parseChangeProposal(JSON.stringify({ type: 'tool_use', part: { tool } }) + '\n' + jsonl()));
  }
});

test('simulated proposal uses real git apply --check without altering files or index', async (t) => {
  const workspace = await fixture(t);
  const originalIndex = await readFile(`${workspace}/.git/index`);
  const h = harness(workspace);
  const response = await h.invoke();
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { success: true, workspace, agent: 'senior-developer', baseHead: head, proposal });
  assert.equal(await readFile(`${workspace}/example.txt`, 'utf8'), 'before\n');
  assert.deepEqual(await readFile(`${workspace}/.git/index`), originalIndex);
  assert.equal(h.calls.filter((args) => args[0] === 'status').length, 2);
  assert.equal(h.calls.filter((args) => args[0] === 'apply').length, 1);
  // Actual staged fixture is deliberately dirty and detected by real Git.
  assert.notEqual(await runProposalGit(workspace, ['status', '--porcelain']), '');
});

test('dirty states and invalid inputs never execute the model', async (t) => {
  const workspace = await fixture(t);
  for (const dirty of [' M example.txt\n', 'M  example.txt\n', '?? new.txt\n', 'UU example.txt\n']) {
    const h = harness(workspace, { statusOutput: () => dirty });
    assert.equal((await h.invoke()).status, 409);
    assert.equal(h.modelCalls, 0);
  }
  const h = harness(workspace);
  for (const body of ['{', 'x'.repeat(33000), { request: 'x', command: 'git reset' }]) assert.notEqual((await h.invoke(body)).status, 200);
  assert.equal((await h.invoke({ request: 'x' }, { url: '/api/opencode/change-proposal?path=x' })).status, 400);
  assert.equal((await h.invoke({ request: 'x' }, { headers: { origin: 'https://other.invalid', host: 'localhost' } })).status, 403);
  assert.equal(h.modelCalls, 0);
});

test('untracked, binary, symlink, submodule and inapplicable proposals are rejected', async (t) => {
  const workspace = await fixture(t);
  await writeFile(`${workspace}/untracked.txt`, 'before\n');
  for (const name of ['binary.bin', 'alias.txt', 'untracked.txt']) {
    const value = { ...proposal, files: [name], patch: patch.replaceAll('example.txt', name) };
    const h = harness(workspace, { proposal: value });
    assert.equal((await h.invoke()).data.code, 'INVALID_TARGET_FILES');
    assert.ok(!h.calls.some((args) => args[0] === 'apply'));
  }
  // A 160000 index entry is a submodule, regardless of filesystem content.
  execFileSync('git', ['update-index', '--add', '--cacheinfo', `160000,${head},submodule`], { cwd: workspace, shell: false });
  const submodule = harness(workspace, { proposal: { ...proposal, files: ['submodule'], patch: patch.replaceAll('example.txt', 'submodule') } });
  assert.equal((await submodule.invoke()).data.code, 'INVALID_TARGET_FILES');
  const invalid = harness(workspace, { proposal: { ...proposal, patch: patch.replace('-before', '-does not exist') } });
  assert.equal((await invalid.invoke()).data.code, 'PATCH_CHECK_FAILED');
  assert.equal(await readFile(`${workspace}/example.txt`, 'utf8'), 'before\n');
});

test('final audit overrides success and model/validation failures when workspace becomes dirty', async (t) => {
  const workspace = await fixture(t);
  for (const options of [{}, { applyFails: true }, { model: async () => { throw new Error('private transcript'); } }]) {
    const h = harness(workspace, { ...options, statusOutput: (call) => call === 1 ? '' : '?? external.txt\n' });
    const r = await h.invoke();
    assert.equal(r.status, 500);
    assert.equal(r.data.code, 'WORKSPACE_NOT_SAFE');
    assert.ok(!JSON.stringify(r.data).includes('private transcript'));
    assert.ok(!Object.hasOwn(r.data, 'proposal'));
  }
  const changed = harness(workspace, { headOutput: (call) => call === 1 ? head : 'b'.repeat(40) });
  assert.equal((await changed.invoke()).data.code, 'HEAD_CHANGED');
});

test('only one proposal at a time, and lock is released after completion', async (t) => {
  const workspace = await fixture(t);
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  const h = harness(workspace, { model: async () => { entered(); await held; return jsonl(); } });
  const first = h.invoke();
  await started;
  assert.equal((await h.invoke()).data.code, 'BUSY');
  release();
  assert.equal((await first).status, 200);
  assert.equal((await h.invoke()).status, 200);
});


test('four rejection stages expose only safe codes and leave files and index unchanged', async (t) => {
  const workspace = await fixture(t);
  const paths = ['example.txt', 'binary.bin', '.env', '.git/index'];
  const before = await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`)));
  const cases = [
    ['INVALID_MODEL_RESPONSE', { model: async () => 'private transcript and prompt' }],
    ['INVALID_MODEL_RESPONSE', { proposal: { ...proposal, extra: 'SECRET=value' } }],
    ['INVALID_PATCH_STRUCTURE', { proposal: { ...proposal, patch: patch.replace('@@ -1 +1 @@', '@@ invalid @@') } }],
    ...['.env', '../secret', 'binary.bin', 'alias.txt', 'missing.txt'].map((name) =>
      ['INVALID_TARGET_FILES', { proposal: { ...proposal, files: [name], patch: patch.replaceAll('example.txt', name) } }]),
    ['PATCH_CHECK_FAILED', { proposal: { ...proposal, patch: patch.replace('-before', '-private file content') } }],
    ['PATCH_CHECK_FAILED', { applyFails: true }],
  ];
  for (const [code, options] of cases) {
    const h = harness(workspace, options);
    const response = await h.invoke();
    assert.equal(response.status, 502);
    assert.equal(response.data.code, code);
    assert.deepEqual(Object.keys(response.data).sort(), code === 'INVALID_MODEL_RESPONSE'
      ? ['code', 'error', 'modelResponseReason', 'success']
      : code === 'INVALID_PATCH_STRUCTURE' ? ['code', 'error', 'patchStructureReason', 'success']
        : code === 'PATCH_CHECK_FAILED' ? ['code', 'error', 'patchCheckReason', 'success']
          : ['code', 'error', 'success']);
    assert.equal(response.data.success, false);
    assert.ok(!/private|SECRET|Internal|diff --git|Error:|\n/.test(JSON.stringify(response.data)));
    const applyCalls = h.calls.filter((args) => args[0] === 'apply');
    assert.equal(applyCalls.length, code === 'PATCH_CHECK_FAILED' ? 1 : 0);
    assert.ok(applyCalls.every((args) => args.includes('--check')));
    const after = await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`)));
    assert.deepEqual(after, before);
    assert.equal(execFileSync('readlink', [`${workspace}/alias.txt`], { encoding: 'utf8' }), 'example.txt\n');
  }
});


test('timeout diagnostics use fixed stages, numeric timing and discard process data', async (t) => {
  const workspace = await fixture(t);
  const index = await readFile(`${workspace}/.git/index`);
  for (const source of ['container', 'client', 'endpoint', 'private stdout', undefined]) {
    const internal = Object.assign(new Error('private transcript request patch stderr'), {
      status: 504, publicCode: 'TIMEOUT', timeoutSource: source,
      stage: 'private stage', timing: { stdout: 'private stdout' },
      stdout: patch, stderr: 'private stderr', request: 'private request',
    });
    const h = harness(workspace, { model: async (reportBudget) => { reportBudget(87); throw internal; } });
    const r = await h.invoke({ request: 'private request' });
    assert.equal(r.status, 504);
    assert.equal(r.data.code, 'TIMEOUT');
    assert.equal(r.data.stage, 'opencode_run');
    assert.equal(r.data.error, 'La propuesta excedió el tiempo máximo.');
    assert.deepEqual(Object.keys(r.data.timing).sort(), ['elapsedMs', 'modelBudgetSeconds']);
    assert.ok(Object.values(r.data.timing).every((value) => Number.isFinite(value) && value >= 0));
    assert.equal(r.data.timing.modelBudgetSeconds, 87);
    assert.equal(r.data.timeoutSource, ['container', 'client', 'endpoint'].includes(source) ? source : undefined);
    assert.ok(!/private|stdout|stderr|diff --git|stack|request|patch/.test(JSON.stringify(r.data)));
    assert.ok(!h.calls.some((args) => args[0] === 'apply'));
    assert.equal(await readFile(`${workspace}/example.txt`, 'utf8'), 'before\n');
    assert.deepEqual(await readFile(`${workspace}/.git/index`), index);
  }
  const endpoint = harness(workspace, { statusError: Object.assign(new Error('private'), {
    publicCode: 'TIMEOUT', status: 504, timeoutSource: 'endpoint',
  }) });
  const r = await endpoint.invoke();
  assert.equal(r.data.stage, 'initial_opencode_status');
  assert.equal(r.data.timeoutSource, 'endpoint');
  assert.equal(r.data.timing.modelBudgetSeconds, 0);
  assert.equal(endpoint.modelCalls, 0);
});

test('model timeout source is omitted for ambiguous kills and buffer errors', () => {
  assert.equal(modelTimeoutSource({ killed: true, signal: 'SIGKILL' }, 88000, 87), 'client');
  assert.equal(modelTimeoutSource({ code: 124 }, 87000, 87), 'container');
  assert.equal(modelTimeoutSource({ code: 137 }, 87000, 87), undefined);
  assert.equal(modelTimeoutSource({ code: 124 }, 100, 87), undefined);
  assert.equal(modelTimeoutSource({ killed: true, signal: 'SIGKILL', code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, 88000, 87), undefined);
});


const privateMarker = 'PRIVATE_MODEL_REQUEST_CONTENT';
const textEvent = (text, overrides = {}) => JSON.stringify({ type: 'text', part: {
  type: 'text', id: 'part', messageID: 'final', text, ...overrides,
} });
const reasonCases = [
  ['invalid_jsonl', `{${privateMarker}`],
  ['opencode_error', JSON.stringify({ type: 'error', error: privateMarker, stdout: patch, stderr: privateMarker })],
  ['unexpected_tool', JSON.stringify({ type: 'tool_use', part: { tool: 'bash', input: privateMarker } })],
  ['invalid_text_event', textEvent(privateMarker, { id: 42 })],
  ['invalid_text_event', textEvent(privateMarker, { messageID: '' })],
  ['invalid_text_event', textEvent(privateMarker, { text: 42 })],
  ['no_text', JSON.stringify({ type: 'tool_use', part: { tool: 'read', result: privateMarker } })],
  ['no_text', textEvent('  ')],
  ['invalid_json', textEvent(`{${privateMarker}`)],
  ['invalid_contract', jsonl({ ...proposal, summary: privateMarker, extra: privateMarker })],
  ['invalid_contract', jsonl({ ...proposal, files: [42] })],
  ['invalid_contract', jsonl({ ...proposal, summary: 'x'.repeat(4001) })],
];
for (const [reason, output] of reasonCases) {
  test(`model response reason ${reason} exposes no original data`, async (t) => {
    const workspace = await fixture(t);
    const paths = ['example.txt', 'binary.bin', '.env', '.git/index'];
    const before = await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`)));
    assert.throws(() => parseChangeProposal(output), (error) =>
      error.publicCode === 'INVALID_MODEL_RESPONSE' && error.modelResponseReason === reason);
    const h = harness(workspace, { model: async () => output });
    const response = await h.invoke({ request: privateMarker });
    assert.deepEqual(response.data, {
      success: false, code: 'INVALID_MODEL_RESPONSE',
      error: 'Senior Developer no devolvió una propuesta con el formato esperado.', modelResponseReason: reason,
    });
    assert.equal(response.status, 502);
    const publicData = JSON.stringify(response.data);
    assert.ok(!publicData.includes(privateMarker));
    assert.ok(!publicData.includes(patch));
    assert.ok(!/stdout|stderr|stack|diff --git/.test(publicData));
    assert.ok(!h.calls.some((args) => args[0] === 'apply'));
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`))), before);
    assert.equal(execFileSync('readlink', [`${workspace}/alias.txt`], { encoding: 'utf8' }), 'example.txt\n');
  });
}


test('model budget caps at 150 seconds and preserves the final 20 seconds', () => {
  const now = 1_000_000;
  for (const remainingMs of [180_000, 179_000, 170_000, 160_000, 159_500, 100_000, 21_000, 20_999, 20_000, 10_000, 0]) {
    const seconds = proposalModelBudgetSeconds(now + remainingMs, now);
    assert.ok(Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 150);
    if (seconds > 0) assert.ok(remainingMs - seconds * 1000 >= 20_000);
  }
  assert.equal(proposalModelBudgetSeconds(now + 180_000, now), 150);
  assert.equal(proposalModelBudgetSeconds(now + 159_500, now), 139);
  assert.equal(proposalModelBudgetSeconds(now + 20_999, now), 0);
});

test('timeout diagnostic accepts 150 seconds and never reports a larger model budget', async (t) => {
  const workspace = await fixture(t);
  const originalIndex = await readFile(`${workspace}/.git/index`);
  for (const budget of [150, 151, 180]) {
    const h = harness(workspace, { model: async (reportBudget) => {
      reportBudget(budget);
      throw Object.assign(new Error('private transcript stdout stderr request patch'), {
        status: 504, publicCode: 'TIMEOUT', timeoutSource: 'client', stdout: patch, stderr: 'private',
      });
    } });
    const response = await h.invoke({ request: 'private request' });
    assert.equal(response.data.code, 'TIMEOUT');
    assert.equal(response.data.stage, 'opencode_run');
    assert.equal(response.data.timeoutSource, 'client');
    assert.equal(response.data.timing.modelBudgetSeconds, budget === 150 ? 150 : 0);
    assert.ok(!/private|stdout|stderr|request|patch|transcript/.test(JSON.stringify(response.data)));
    assert.equal(await readFile(`${workspace}/example.txt`, 'utf8'), 'before\n');
    assert.deepEqual(await readFile(`${workspace}/.git/index`), originalIndex);
    assert.ok(!h.calls.some((args) => args[0] === 'apply'));
  }
});


const markedPatch = patch.replace('-before', '-PRIVATE_REMOVED_LINE').replace('+after', '+PRIVATE_ADDED_LINE');
const patchReasonCases = [
  ['unexpected_diff_header', markedPatch.replace('diff --git a/example.txt b/example.txt', 'diff --git a/private-name b/private-name')],
  ['duplicate_file', markedPatch + markedPatch],
  ['invalid_index_line', markedPatch.replace('--- a/', 'index PRIVATE_INVALID_INDEX\n--- a/')],
  ['invalid_file_headers', markedPatch.replace('--- a/example.txt', '--- a/PRIVATE_HEADER')],
  ['invalid_hunk_header', markedPatch.replace('@@ -1 +1 @@', '@@ PRIVATE_HUNK @@')],
  ['invalid_hunk_body', markedPatch.replace('-PRIVATE_REMOVED_LINE', 'PRIVATE_BODY')],
  ['invalid_hunk_counts', markedPatch.replace('@@ -1 +1 @@', '@@ -1,999999999999999999999 +1 @@')],
  ['no_changes', markedPatch.replace('-PRIVATE_REMOVED_LINE\n+PRIVATE_ADDED_LINE', ' PRIVATE_CONTEXT')],
  ['declared_files_mismatch', markedPatch, ['example.txt', 'other.txt']],
];
for (const [reason, rejectedPatch, files = proposal.files] of patchReasonCases) {
  test(`patch structure reason ${reason} rejects before Git without exposing patch fragments`, async (t) => {
    const workspace = await fixture(t);
    const paths = ['example.txt', 'binary.bin', '.env', '.git/index'];
    const before = await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`)));
    const value = { ...proposal, files, patch: rejectedPatch };
    assert.throws(() => validatePatchStructure(value), (error) =>
      error.publicCode === 'INVALID_PATCH_STRUCTURE' && error.patchStructureReason === reason);
    const h = harness(workspace, { proposal: value });
    const response = await h.invoke({ request: privateMarker });
    assert.equal(response.status, 502);
    assert.deepEqual(response.data, {
      success: false, code: 'INVALID_PATCH_STRUCTURE',
      error: 'El diff generado no cumple la estructura segura requerida.', patchStructureReason: reason,
    });
    const publicData = JSON.stringify(response.data);
    assert.ok(!publicData.includes(rejectedPatch));
    assert.ok(!/PRIVATE|private-name|example.txt|other.txt|stdout|stderr|stack|diff --git/.test(publicData));
    for (const line of rejectedPatch.split('\n').filter((line) => line.length > 2)) {
      assert.ok(!publicData.includes(line), 'Rejected patch line must not appear in response');
    }
    assert.ok(!h.calls.some((args) => args[0] === 'apply'));
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`))), before);
    assert.equal(execFileSync('readlink', [`${workspace}/alias.txt`], { encoding: 'utf8' }), 'example.txt\n');
  });
}


test('flow adds only the missing final newline while direct structure validation stays strict', async (t) => {
  const workspace = await fixture(t);
  const original = patch.slice(0, -1);
  const value = { ...proposal, patch: original };
  assert.throws(() => validatePatchStructure(value), (error) =>
    error.publicCode === 'INVALID_PATCH_STRUCTURE' && error.patchStructureReason === 'missing_final_newline');
  const before = await Promise.all(['example.txt', 'binary.bin', '.env', '.git/index'].map((path) => readFile(`${workspace}/${path}`)));
  let checks = 0;
  const h = harness(workspace, { proposal: value, checkInput: (input) => {
    checks++;
    assert.equal(input, original + '\n');
  } });
  const response = await h.invoke();
  assert.equal(response.status, 200);
  assert.equal(checks, 1);
  assert.equal(response.data.proposal.patch, original + '\n');
  assert.ok(response.data.proposal.patch.endsWith('\n'));
  assert.equal(response.data.proposal.patch.slice(0, -1), original);
  assert.deepEqual(await Promise.all(['example.txt', 'binary.bin', '.env', '.git/index'].map((path) => readFile(`${workspace}/${path}`))), before);
  // Existing newlines, spaces and CR characters are never rewritten by normalization.
  assert.equal(parseChangeProposal(jsonl()).patch, patch);
  const spaced = patch.replace('+after', '+after  ');
  assert.equal(parseChangeProposal(jsonl({ ...proposal, patch: spaced.slice(0, -1) })).patch, spaced);
  const crlf = patch.replaceAll('\n', '\r\n');
  assert.throws(() => parseChangeProposal(jsonl({ ...proposal, patch: crlf })), (error) =>
    error.publicCode === 'INVALID_PATCH_STRUCTURE');
});

test('normalization enforces the 512 KiB limit after appending the newline', async (t) => {
  const workspace = await fixture(t);
  const paths = ['example.txt', '.git/index'];
  const before = await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`)));
  const limit = 512 * 1024;
  const prefix = patch.replace('@@ -1 +1 @@', '@@ -1 +1 @@ ');
  const largePatch = (bytes) => prefix.replace('@@ -1 +1 @@ ', '@@ -1 +1 @@ ' + 'x'.repeat(bytes - Buffer.byteLength(prefix.slice(0, -1)))) .slice(0, -1);
  const boundary = largePatch(limit - 1);
  assert.equal(Buffer.byteLength(boundary), limit - 1);
  assert.equal(Buffer.byteLength(parseChangeProposal(jsonl({ ...proposal, patch: boundary })).patch), limit);
  const tooLarge = largePatch(limit);
  assert.equal(Buffer.byteLength(tooLarge), limit);
  const h = harness(workspace, { proposal: { ...proposal, patch: tooLarge } });
  const response = await h.invoke();
  assert.deepEqual(response.data, { success: false, code: 'INVALID_MODEL_RESPONSE',
    error: 'Senior Developer no devolvió una propuesta con el formato esperado.', modelResponseReason: 'invalid_contract' });
  assert.equal(response.status, 502);
  assert.ok(!h.calls.some((args) => args[0] === 'apply'));
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`))), before);
});


test('explicit recount tolerates only hunk counts and Git decides applicability without writes', async (t) => {
  const workspace = await fixture(t);
  const paths = ['example.txt', 'binary.bin', '.env', '.git/index'];
  const before = await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`)));
  const incorrectCounts = patch.replace('@@ -1 +1 @@', '@@ -1,7 +1,9 @@');
  const value = { ...proposal, patch: incorrectCounts };
  assert.throws(() => validatePatchStructure(value), (error) => error.patchStructureReason === 'invalid_hunk_counts');
  assert.doesNotThrow(() => validatePatchStructure(value, { recount: true }));
  for (const matches of [true, false]) {
    const input = matches ? incorrectCounts : incorrectCounts.replace('-before', '-PRIVATE_NONMATCHING_CONTEXT');
    let checks = 0;
    const h = harness(workspace, { proposal: { ...proposal, patch: input }, checkInput: (actual) => {
      checks++;
      assert.equal(actual, input);
    } });
    const response = await h.invoke();
    assert.equal(response.status, matches ? 200 : 502);
    if (matches) assert.equal(response.data.proposal.patch, input);
    else {
      assert.equal(response.data.code, 'PATCH_CHECK_FAILED');
      assert.ok(!JSON.stringify(response.data).includes('PRIVATE_NONMATCHING_CONTEXT'));
    }
    assert.equal(checks, 1);
    assert.deepEqual(h.calls.filter((args) => args[0] === 'apply'), [
      ['apply', '--check', '--recount', '--index', '--whitespace=error', '-'],
    ]);
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`))), before);
  }
  // Recount does not relax path, file/header, body or declaration checks.
  for (const [reason, input, files = proposal.files] of patchReasonCases) {
    if (reason === 'invalid_hunk_counts') continue;
    const h = harness(workspace, { proposal: { ...proposal, files, patch: input } });
    const response = await h.invoke();
    assert.equal(response.data.code, 'INVALID_PATCH_STRUCTURE');
    assert.equal(response.data.patchStructureReason, reason);
    assert.ok(!h.calls.some((args) => args[0] === 'apply'));
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`))), before);
  }
});


test('Git metadata diagnostic removes only valid index lines and always rejects the proposal', async (t) => {
  const workspace = await fixture(t);
  const paths = ['example.txt', 'binary.bin', '.env', '.git/index'];
  const before = await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`)));
  // Git may ignore text-patch metadata. Simulate the initial rejection for this branch,
  // then use real Git for the diagnostic check; never infer failure from hashes alone.
  const metadata = 'index 1234567..abcdef0 100755\n';
  const original = patch.replace('--- a/', metadata + '--- a/');
  for (const [input, reason, count] of [
    [original, 'index_metadata_mismatch', 2],
    [original.replace('-before', '-PRIVATE_OLD_CONTENT'), 'content_or_context_mismatch', 2],
    [patch.replace('-before', '-PRIVATE_OLD_CONTENT'), 'content_or_context_mismatch', 1],
  ]) {
    const inputs = [];
    const value = { ...proposal, patch: input };
    const h = harness(workspace, { proposal: value, rejectMetadata: true, checkInput: (actual) => inputs.push(actual) });
    const response = await h.invoke({ request: privateMarker });
    assert.equal(response.status, 502);
    assert.deepEqual(response.data, { success: false, code: 'PATCH_CHECK_FAILED',
      error: 'Git comprobó el diff, pero no puede aplicarse sobre el estado actual del proyecto.', patchCheckReason: reason });
    assert.equal(inputs.length, count);
    assert.equal(inputs[0], input);
    if (count === 2) assert.equal(inputs[1], input.replace(metadata, ''));
    assert.equal(value.patch, input);
    assert.ok(h.calls.filter((args) => args[0] === 'apply').every((args) =>
      args.join(' ') === 'apply --check --recount --index --whitespace=error -'));
    assert.ok(!/1234567|abcdef0|PRIVATE|before|after|stdout|stderr|stack|diff --git/.test(JSON.stringify(response.data)));
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`))), before);
  }
  // This exact diagnostic input succeeds with real Git, without applying it.
  await runProposalGit(workspace, ['apply', '--check', '--recount', '--index', '--whitespace=error', '-'], { input: original.replace(metadata, '') });
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`))), before);
});

test('incomplete Git checks produce unknown without exposing process errors', async (t) => {
  const workspace = await fixture(t);
  const before = await readFile(`${workspace}/.git/index`);
  const h = harness(workspace, { applyError: Object.assign(new Error('PRIVATE stderr transcript'), {
    code: 'ENOENT', stdout: patch, stderr: privateMarker,
  }) });
  const response = await h.invoke();
  assert.equal(response.data.patchCheckReason, 'unknown');
  assert.equal(h.calls.filter((args) => args[0] === 'apply').length, 1);
  assert.ok(!/PRIVATE|stdout|stderr|transcript|diff --git/.test(JSON.stringify(response.data)));
  assert.deepEqual(await readFile(`${workspace}/.git/index`), before);
  assert.equal(await readFile(`${workspace}/example.txt`, 'utf8'), 'before\n');
});


test('each declared file requires successful read evidence from the same execution before response', async (t) => {
  const workspace = await fixture(t);
  await writeFile(`${workspace}/README.md`, 'before\n');
  execFileSync('git', ['add', '--', 'README.md'], { cwd: workspace });
  const value = { ...proposal, files: ['README.md'], patch: patch.replaceAll('example.txt', 'README.md') };
  const multiple = { ...value, files: ['README.md', 'example.txt'], patch: value.patch + patch };
  const good = readEvent('/workspace/README.md');
  const cases = [
    [value, [], false],
    [value, [readEvent('/workspace')], false],
    [value, [readEvent('/workspace/example.txt')], false],
    [value, [readEvent('/workspace/README.md', 'error', { error: 'PRIVATE_READ_ERROR' })], false],
    [value, [readEvent('/workspace/README.md', 'running')], false],
    [value, [readEvent('/workspace/README.md', 'completed', { metadata: { display: { type: 'directory', path: '/workspace/README.md' } } })], false],
    [value, [good.replaceAll('execution', 'other-execution')], false],
    [value, [good], true],
    [multiple, [good], false],
    [multiple, [good, readEvent('/workspace/example.txt')], true],
  ];
  const paths = ['README.md', 'example.txt', '.git/index'];
  const before = await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`)));
  for (const [input, events, accepted] of cases) {
    const h = harness(workspace, { model: async () => [...events, proposalEvent(input)].join('\n') });
    const response = await h.invoke({ request: privateMarker });
    assert.equal(response.status, accepted ? 200 : 502);
    if (!accepted) {
      assert.deepEqual(response.data, { success: false, code: 'READ_EVIDENCE_REQUIRED',
        error: 'Senior Developer no inspeccionó todos los archivos antes de generar la propuesta.' });
      assert.ok(!h.calls.some((args) => args[0] === 'apply'));
    }
    assert.ok(!/PRIVATE|stdout|stderr|transcript/.test(JSON.stringify(response.data)));
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`))), before);
  }
  assert.throws(() => parseChangeProposal(proposalEvent(value) + '\n' + good), (error) => error.publicCode === 'READ_EVIDENCE_REQUIRED');
  // Evidence is local to this parse, never carried over from a previous execution.
  assert.deepEqual(parseChangeProposal(good + '\n' + proposalEvent(value)), value);
  assert.throws(() => parseChangeProposal(proposalEvent(value)), (error) => error.publicCode === 'READ_EVIDENCE_REQUIRED');
});


for (const inputPath of ['/workspace/README.md', 'README.md', './README.md', 'workspace/README.md',
  '/workspace', '/workspace/../README.md']) {
  test(`read evidence requires exact absolute workspace path: ${inputPath}`, async (t) => {
    const workspace = await fixture(t);
    await writeFile(`${workspace}/README.md`, 'before\n');
    execFileSync('git', ['add', '--', 'README.md'], { cwd: workspace });
    const value = { ...proposal, files: ['README.md'], patch: patch.replaceAll('example.txt', 'README.md') };
    const paths = ['README.md', 'example.txt', '.git/index'];
    const before = await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`)));
    // Even a canonical metadata path cannot make a relative input qualify.
    const event = readEvent(inputPath, 'completed', {
      metadata: { display: { type: 'file', path: '/workspace/README.md' } },
    });
    const h = harness(workspace, { model: async () => event + '\n' + proposalEvent(value) });
    const response = await h.invoke();
    const accepted = inputPath === '/workspace/README.md';
    assert.equal(response.status, accepted ? 200 : 502);
    if (accepted) assert.deepEqual(response.data.proposal, value);
    else assert.equal(response.data.code, 'READ_EVIDENCE_REQUIRED');
    const calls = h.calls.filter((args) => args[0] === 'apply');
    assert.equal(calls.length, accepted ? 1 : 0);
    assert.ok(calls.every((args) => args.includes('--check')));
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`))), before);
    assert.ok(!JSON.stringify(response.data).includes('PRIVATE_READ_CONTENT'));
  });
}
