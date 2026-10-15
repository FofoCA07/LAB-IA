import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, symlink, mkdir, rename, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { Readable } from 'node:stream';
import { createActionStore } from './action-store.js';
import { createActionHandlers } from './actions.js';
import { readSelectedTextFiles, runProposalGit } from './change-proposal.js';
import { createWorkspaceLocks } from './proposal-store.js';

const marker = 'PRIVATE_CONTENT_ñ';
async function fixture(t, options = {}) {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'read-actions-')));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: workspace, env: { ...process.env,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: 'pipe' });
  git('init', '--quiet');
  await writeFile(join(workspace, 'file.txt'), marker);
  git('add', '--', 'file.txt');
  let reads = 0;
  const store = createActionStore({ getWorkspaceStatus: async () => ({ available: true, running: true, workspace }),
    readFiles: async (...args) => { reads++; return readSelectedTextFiles(...args); }, ...options });
  const input = { agentId: 'senior-developer', agentName: 'Senior Developer', workspace,
    projectName: 'Temporal', reason: 'Revisar validación.', paths: ['file.txt'] };
  return { workspace, git, store, input, reads: () => reads };
}
const approve = (store, action) => store.decide({ actionId: action.actionId, decision: 'approve_once' });
const deny = (store, action) => store.decide({ actionId: action.actionId, decision: 'deny' });

function http(store) {
  const handlers = createActionHandlers({ store, json: (response, status, body) => Object.assign(response, { status, body }) });
  return async (body, options = {}) => {
    const request = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
    Object.assign(request, { method: 'POST', url: '/api/actions/decision', headers: { 'content-type': 'application/json', host: 'localhost', ...options.headers }, ...options });
    const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; } };
    await handlers.decision(request, response);
    return response;
  };
}

test('internal creation and public list expose only safe detached metadata', async (t) => {
  const f = await fixture(t);
  const action = await f.store.createReadAction(f.input);
  assert.match(action.actionId, /^[0-9a-f-]{36}$/);
  assert.equal(action.type, 'read'); assert.equal(action.state, 'pending');
  assert.equal(Date.parse(action.expiresAt) - Date.parse(action.createdAt), 600_000);
  assert.deepEqual(Object.keys(action).sort(), ['actionId', 'agentId', 'agentName', 'type', 'projectName', 'reason', 'resources', 'state', 'createdAt', 'expiresAt'].sort());
  action.resources.push('injected');
  const listed = f.store.listActions();
  assert.deepEqual(listed.actions[0].resources, ['file.txt']);
  assert.ok(!JSON.stringify(listed).includes(f.workspace));
  assert.ok(!JSON.stringify(listed).includes(marker));
  assert.equal(f.reads(), 0);
});

test('deny never reads; approve after deny and repeated deny fail', async (t) => {
  const f = await fixture(t); const action = await f.store.createReadAction(f.input);
  assert.deepEqual((await deny(f.store, action)).body, { state: 'denied' });
  assert.equal((await approve(f.store, action)).status, 409);
  assert.equal((await deny(f.store, action)).status, 409);
  assert.equal(f.reads(), 0);
  assert.equal(f.store.consumeCompletedReadResult(action.actionId), undefined);
});

for (const [name, content] of [ ['Unicode', marker], ['CRLF', 'first\r\nsecond\r\n'], ['BOM', '\uFEFFtexto\n'], ['no newline', 'last'], ['empty', ''] ]) {
  test(`approve preserves exact bytes: ${name}; private result is single-use`, async (t) => {
    const f = await fixture(t); await writeFile(join(f.workspace, 'file.txt'), content);
    const action = await f.store.createReadAction(f.input);
    assert.equal(f.store.consumeCompletedReadResult(action.actionId), undefined);
    const result = await approve(f.store, action);
    assert.deepEqual(result, { status: 200, body: { state: 'completed', files: ['file.txt'] } });
    const privateResult = f.store.consumeCompletedReadResult(action.actionId);
    assert.deepEqual(Buffer.from(privateResult[0].content), Buffer.from(content));
    assert.equal(f.store.consumeCompletedReadResult(action.actionId), undefined);
    assert.equal((await deny(f.store, action)).status, 409);
    assert.equal((await approve(f.store, action)).status, 409);
    assert.equal(f.reads(), 1);
    assert.ok(!JSON.stringify(f.store.listActions()).includes('content'));
  });
}

for (const [name, paths] of [ ['none', []], ['too many', Array.from({ length: 21 }, (_, i) => `${i}.txt`)],
  ['duplicate', ['file.txt', 'file.txt']], ['absolute', ['/tmp/file']], ['traversal', ['a/../file']],
  ['backslash', ['a\\b']], ['long', ['a'.repeat(1025)]], ['sensitive', ['.env']],
  ['secret directory', ['secrets/password']], ['empty component', ['a//b']], ['sparse', Array(2)] ]) {
  test(`creation rejects paths: ${name}`, async (t) => {
    const f = await fixture(t);
    await assert.rejects(f.store.createReadAction({ ...f.input, paths }));
    assert.equal(f.store.listActions().actions.length, 0); assert.equal(f.reads(), 0);
  });
}
for (const field of ['agentId', 'agentName', 'reason', 'projectName']) {
  test(`creation bounds ${field}`, async (t) => {
    const f = await fixture(t);
    for (const value of ['', 'a'.repeat(2001), 'bad\0value']) {
      await assert.rejects(f.store.createReadAction({ ...f.input, [field]: value }));
    }
  });
}

for (const kind of ['oversized', 'total', 'missing', 'untracked', 'symlink', 'parent symlink', 'submodule', 'conflict', 'directory', 'NUL', 'invalid UTF-8']) {
  test(`unsafe read fails safely: ${kind}`, async (t) => {
    const f = await fixture(t); let paths = ['file.txt'];
    if (kind === 'oversized') await writeFile(join(f.workspace, 'file.txt'), 'x'.repeat(16385));
    if (kind === 'total') {
      paths = ['file.txt', 'two.txt', 'three.txt'];
      for (const path of paths) await writeFile(join(f.workspace, path), 'x'.repeat(16384));
      f.git('add', '--', ...paths);
    }
    if (kind === 'missing') paths = ['invented.txt'];
    if (kind === 'untracked') { await writeFile(join(f.workspace, 'new.txt'), marker); paths = ['new.txt']; }
    if (kind === 'symlink') {
      await rm(join(f.workspace, 'file.txt')); await symlink('target.txt', join(f.workspace, 'file.txt'));
      await writeFile(join(f.workspace, 'target.txt'), marker);
    }
    if (kind === 'parent symlink') {
      await mkdir(join(f.workspace, 'dir')); await writeFile(join(f.workspace, 'dir/file.txt'), marker);
      f.git('add', '--', 'dir/file.txt'); await rename(join(f.workspace, 'dir'), join(f.workspace, 'real'));
      await symlink('real', join(f.workspace, 'dir')); paths = ['dir/file.txt'];
    }
    if (kind === 'submodule') {
      f.git('update-index', '--add', '--cacheinfo', `160000,${'a'.repeat(40)},module`); paths = ['module'];
    }
    if (kind === 'conflict') {
      const hash = f.git('hash-object', 'file.txt').toString().trim();
      execFileSync('git', ['update-index', '--index-info'], { cwd: f.workspace,
        input: `0 ${'0'.repeat(40)}\tfile.txt\n100644 ${hash} 1\tfile.txt\n100644 ${hash} 2\tfile.txt\n` });
    }
    if (kind === 'directory') { await rm(join(f.workspace, 'file.txt')); await mkdir(join(f.workspace, 'file.txt')); }
    if (kind === 'NUL') await writeFile(join(f.workspace, 'file.txt'), Buffer.from([65, 0, 66]));
    if (kind === 'invalid UTF-8') await writeFile(join(f.workspace, 'file.txt'), Buffer.from([0xc3, 0x28]));
    const action = await f.store.createReadAction({ ...f.input, paths });
    const result = await approve(f.store, action);
    assert.equal(result.status, 422); assert.equal(result.body.state, 'failed');
    for (const secret of [marker, f.workspace, 'stderr', 'stdout']) assert.ok(!JSON.stringify(result).includes(secret));
    assert.equal(f.store.consumeCompletedReadResult(action.actionId), undefined);
    assert.equal((await approve(f.store, action)).status, 409);
  });
}

test('concurrent approves claim once before any await; deny cannot race running', async (t) => {
  let unblock; let entered;
  let reads = 0;
  const gate = new Promise((resolve) => { unblock = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const f = await fixture(t, { readFiles: async (...args) => { reads++; entered(); await gate; return readSelectedTextFiles(...args); } });
  const action = await f.store.createReadAction(f.input);
  const first = approve(f.store, action);
  assert.equal(f.store.listActions().actions[0].state, 'running');
  const second = await approve(f.store, action);
  assert.equal(second.status, 409); assert.equal((await deny(f.store, action)).status, 409);
  await started; unblock(); assert.equal((await first).body.state, 'completed');
  assert.equal(reads, 1);
});

test('expiration prevents reading and cleanup eventually removes receipts', async (t) => {
  let now = 0; const f = await fixture(t, { now: () => now });
  const action = await f.store.createReadAction(f.input); now = 600_000;
  assert.equal((await approve(f.store, action)).status, 409);
  assert.equal(f.store.listActions().actions[0].state, 'expired'); assert.equal(f.reads(), 0);
  now += 600_000; f.store.cleanup(); assert.deepEqual(f.store.listActions(), { actions: [] });
});

test('completed private content expires and capacity is bounded/released', async (t) => {
  let now = 0; const f = await fixture(t, { now: () => now, maxActions: 1 });
  const action = await f.store.createReadAction(f.input);
  await assert.rejects(f.store.createReadAction(f.input));
  await approve(f.store, action); now = 600_000;
  assert.equal(f.store.consumeCompletedReadResult(action.actionId), undefined);
  await f.store.createReadAction(f.input);
  const small = createActionStore({ maxBytes: 100 });
  await assert.rejects(small.createReadAction(f.input));
});

for (const kind of ['workspace changed', 'repository changed', 'private exception', 'busy']) {
  test(`approval fails before content exposure: ${kind}`, async (t) => {
    const locks = createWorkspaceLocks();
    const f = await fixture(t, { locks, ...(kind === 'workspace changed' ? { getWorkspaceStatus: async () => ({ available: true, running: true, workspace: '/different' }) } : {}),
      ...(kind === 'private exception' ? { getWorkspaceStatus: async () => { throw new Error(`${marker} /private/workspace`); } } : {}) });
    const action = await f.store.createReadAction(f.input);
    if (kind === 'repository changed') {
      await rename(join(f.workspace, '.git'), join(f.workspace, '.old-git')); f.git('init', '--quiet');
    }
    const release = kind === 'busy' ? locks.acquireExclusive() : undefined;
    try {
      const result = await approve(f.store, action);
      assert.equal(result.body.state, 'failed'); assert.equal(f.reads(), 0);
      assert.ok(!JSON.stringify(result).includes(marker)); assert.ok(!JSON.stringify(result).includes(f.workspace));
    } finally { release?.(); }
  });
}

test('HTTP decision exact schema, unknown UUID, methods, origin, content type and bounded body', async (t) => {
  const f = await fixture(t); const action = await f.store.createReadAction(f.input); const request = http(f.store);
  for (const body of [null, [], {}, { actionId: action.actionId, decision: 'approve_once', extra: true },
    { actionId: 'bad', decision: 'deny' }, { actionId: action.actionId, decision: 'approve' }, '{invalid', 'x'.repeat(1025)]) {
    assert.equal((await request(body)).status, 400);
  }
  assert.equal((await request({ actionId: randomUUID(), decision: 'deny' })).status, 409);
  assert.equal((await request({}, { method: 'GET' })).status, 405);
  assert.equal((await request({}, { url: '/api/actions/decision?x=1' })).status, 400);
  assert.equal((await request({}, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request({}, { headers: { 'content-type': 'application/json', origin: 'http://external', host: 'localhost' } })).status, 403);
  assert.deepEqual((await request({ actionId: action.actionId, decision: 'approve_once' })).body,
    { state: 'completed', files: ['file.txt'] });
  assert.equal(f.reads(), 1);
});

test('HTTP list is safe, has no creation or consumption handlers', async (t) => {
  const f = await fixture(t); const action = await f.store.createReadAction(f.input);
  await approve(f.store, action);
  const handlers = createActionHandlers({ store: f.store, json: (response, status, body) => Object.assign(response, { status, body }) });
  assert.deepEqual(Object.keys(handlers), ['list', 'decision']);
  const response = { setHeader() {} };
  handlers.list({ method: 'GET' }, response);
  assert.equal(response.status, 200); assert.equal(response.body.actions[0].state, 'completed');
  assert.ok(!JSON.stringify(response.body).includes(marker)); assert.ok(!JSON.stringify(response.body).includes(f.workspace));
  handlers.list({ method: 'POST' }, response); assert.equal(response.status, 405);
});

test('post-read workspace change discards all private contents', async (t) => {
  let calls = 0;
  const f = await fixture(t, { getWorkspaceStatus: async () => ({ available: true, running: true,
    workspace: ++calls === 1 ? f.workspace : '/changed' }) });
  const action = await f.store.createReadAction(f.input);
  assert.equal((await approve(f.store, action)).body.state, 'failed');
  assert.equal(f.store.consumeCompletedReadResult(action.actionId), undefined);
});

test('tracked executable mode is allowed and noncanonical alias is canonicalized internally', async (t) => {
  const f = await fixture(t);
  f.git('update-index', '--chmod=+x', 'file.txt');
  const action = await f.store.createReadAction({ ...f.input, workspace: `${f.workspace}/.` });
  assert.equal((await approve(f.store, action)).body.state, 'completed');
});

test('only read-only Git helper is used by default', async (t) => {
  const calls = []; const f = await fixture(t, { git: async (...args) => { calls.push(args[1][0]); return runProposalGit(...args); } });
  const action = await f.store.createReadAction(f.input); await approve(f.store, action);
  assert.ok(calls.every((command) => ['rev-parse', 'ls-files'].includes(command)));
});

test('32 KiB boundary and control text stay within reserved capacity', async (t) => {
  const f = await fixture(t, { maxBytes: 700 * 1024 });
  const content = '\x01'.repeat(16 * 1024);
  await writeFile(join(f.workspace, 'file.txt'), content);
  await writeFile(join(f.workspace, 'two.txt'), content);
  f.git('add', '--', 'two.txt');
  const action = await f.store.createReadAction({ ...f.input, paths: ['file.txt', 'two.txt'] });
  await assert.rejects(f.store.createReadAction(f.input));
  assert.equal((await approve(f.store, action)).body.state, 'completed');
  const result = f.store.consumeCompletedReadResult(action.actionId);
  assert.equal(result.length, 2); assert.equal(result[1].content, content);
  await f.store.createReadAction(f.input);
});

test('tracked symlink mode is rejected', async (t) => {
  const f = await fixture(t);
  await symlink('file.txt', join(f.workspace, 'alias.txt')); f.git('add', '--', 'alias.txt');
  const action = await f.store.createReadAction({ ...f.input, paths: ['alias.txt'] });
  assert.equal((await approve(f.store, action)).body.state, 'failed');
  assert.equal(f.store.consumeCompletedReadResult(action.actionId), undefined);
});

test('deny via HTTP has minimal response and performs no reads', async (t) => {
  const f = await fixture(t); const action = await f.store.createReadAction(f.input);
  const result = await http(f.store)({ actionId: action.actionId, decision: 'deny' });
  assert.equal(result.status, 200); assert.deepEqual(result.body, { state: 'denied' });
  assert.equal(f.reads(), 0);
});
