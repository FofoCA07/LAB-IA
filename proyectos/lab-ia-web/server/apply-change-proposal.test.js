import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createProposalStore, createWorkspaceLocks } from './proposal-store.js';
import { repositoryIdentity, trackedModes, fileFingerprints, sha256 } from './proposal-safety.js';
import { createApplyChangeProposalHandler, runApplyGit } from './apply-change-proposal.js';
import { runProposalGit, createChangeProposalHandler } from './change-proposal.js';
import { generateDeterministicDiff } from './deterministic-diff.js';

const old = 'FUNCIONAAA X2'; const proposed = 'LAB-IA funcionando correctamente.';
const forbidden = new Set(['commit', 'push', 'reset', 'restore', 'checkout', 'clean']);
// Fixtures create a commit object using plumbing; no git commit invocation, no live server or model.
function fixtureGit(workspace, args, input) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: workspace, shell: false,
    input, encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
      GIT_OPTIONAL_LOCKS: '0', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
}
async function fixture(t, { paths = ['README.md'], executable = false, storeOptions = {} } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'lab-apply-test-'));
  t.after(async () => {
    await chmod(join(workspace, 'locked'), 0o755).catch(() => {});
    await rm(workspace, { recursive: true, force: true });
  });
  fixtureGit(workspace, ['init', '-q']);
  for (const path of paths) {
    await mkdir(join(workspace, path, '..'), { recursive: true });
    await writeFile(join(workspace, path), old, { mode: executable ? 0o755 : 0o644 });
  }
  fixtureGit(workspace, ['add', '--', ...paths]);
  const tree = fixtureGit(workspace, ['write-tree']).trim();
  const baseHead = fixtureGit(workspace, ['commit-tree', tree], 'Fixture baseline\n').trim();
  fixtureGit(workspace, ['update-ref', 'HEAD', baseHead]);
  const identity = await repositoryIdentity(workspace, runProposalGit, Date.now() + 10000);
  const modes = await trackedModes(workspace, paths, runProposalGit, Date.now() + 10000);
  const originals = await fileFingerprints(workspace, paths, modes, Date.now() + 10000);
  let patch = '';
  for (const path of paths) patch += (await generateDeterministicDiff({ path, originalContent: old,
    proposedContent: proposed, deadline: Date.now() + 10000 })).patch;
  const store = createProposalStore(storeOptions); const locks = createWorkspaceLocks();
  const data = { workspace, repoRoot: workspace, repoIdentity: identity, baseHead, paths, patch, modes,
    originalFingerprints: originals.fingerprints, permissions: originals.permissions,
    proposedFingerprints: Object.fromEntries(paths.map((path) => [path, sha256(proposed)])) };
  const record = store.register(data); const indexBefore = await readFile(join(workspace, '.git/index'));
  const calls = []; let intercept; let workspaceStatus = { available: true, running: true, workspace };
  const handler = createApplyChangeProposalHandler({ store, locks,
    getWorkspaceStatus: async () => workspaceStatus,
    git: async (cwd, args, options) => {
      assert.ok(!forbidden.has(args[0])); calls.push({ args, options });
      if (intercept) await intercept(cwd, args, options);
      return runApplyGit(cwd, args, options);
    }, json: (response, status, data) => Object.assign(response, { status, data }) });
  async function invoke(body = { proposalId: record.proposalId }, settings = {}) {
    const request = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
    Object.assign(request, { method: 'POST', url: '/api/opencode/apply-change-proposal', ...settings,
      headers: { host: 'localhost', 'content-type': 'application/json', ...settings.headers } });
    const response = { setHeader() {} }; await handler(request, response); return response;
  }
  return { workspace, record, data, store, locks, calls, invoke, indexBefore,
    set intercept(value) { intercept = value; }, set workspaceStatus(value) { workspaceStatus = value; } };
}
async function assertSuccess(h) {
  const response = await h.invoke(); assert.equal(response.status, 200); assert.deepEqual(response.data, { applied: true, files: h.record.paths });
  assert.equal(fixtureGit(h.workspace, ['diff', '--cached']), '');
  assert.equal(fixtureGit(h.workspace, ['rev-parse', 'HEAD']).trim(), h.record.baseHead);
  assert.deepEqual(await readFile(join(h.workspace, '.git/index')), h.indexBefore);
  assert.equal(fixtureGit(h.workspace, ['ls-files', '--others', '-z']), '');
  for (const path of h.record.paths) {
    assert.equal(await readFile(join(h.workspace, path), 'utf8'), proposed);
    assert.equal((await stat(join(h.workspace, path))).mode & 0o7777, h.record.permissions[path]);
  }
  assert.equal(h.store.get(h.record.proposalId).state, 'applied');
  const writes = h.calls.filter(({ args }) => args[0] === 'apply' && !args.includes('--check'));
  assert.equal(writes.length, 1); assert.ok(writes[0].options.temporaryIndex.path.startsWith('/dev/shm/lab-proposal-'));
  await assert.rejects(stat(writes[0].options.temporaryIndex.path));
}
for (const [name, options] of [['exact no newline', {}], ['100755', { executable: true }],
  ['two files', { paths: ['README.md', 'second.txt'] }], ['space', { paths: ['docs/Guia de usuario.md'] }]]) {
  test(`successful apply ${name}: real index unchanged, HEAD unchanged, no staged`, async (t) => {
    const h = await fixture(t, options); await assertSuccess(h);
    if (options.paths === undefined) assert.equal(fixtureGit(h.workspace, ['status', '--short']), ' M README.md\n');
  });
}
test('executor denies mutating apply without backend capability and unsafe apply options', async () => {
  await assert.rejects(runApplyGit('/tmp', ['apply', '--recount', '--index', '--whitespace=error', '-'], { input: 'private' }));
  await assert.rejects(runApplyGit('/tmp', ['apply', '--reject', '-']));
});
test('invalid body, extra client authority, invalid ID and unknown ID do not claim or run Git', async (t) => {
  const h = await fixture(t);
  for (const body of [{}, null, [], { proposalId: 'bad' }, { proposalId: h.record.proposalId, patch: 'private' },
    { proposalId: h.record.proposalId, workspace: '/private' }, '{']) assert.equal((await h.invoke(body)).status, 400);
  assert.equal((await h.invoke({ proposalId: '00000000-0000-4000-8000-000000000000' })).status, 409);
  assert.equal(h.calls.length, 0); assert.equal(h.store.get(h.record.proposalId).state, 'ready');
});
test('method, origin, query and content type rejected before claim', async (t) => {
  const h = await fixture(t);
  for (const [settings, status] of [[{ method: 'GET' }, 405], [{ url: '/api/opencode/apply-change-proposal?x=1' }, 400],
    [{ headers: { origin: 'http://evil.invalid' } }, 403], [{ headers: { 'content-type': 'text/plain' } }, 415]]) {
    assert.equal((await h.invoke(undefined, settings)).status, status);
  }
  assert.equal(h.calls.length, 0);
});
test('expired proposal is not applied', async (t) => {
  let time = 0; const h = await fixture(t, { storeOptions: { now: () => time } }); time = 600000;
  assert.equal((await h.invoke()).status, 409); assert.equal(h.store.get(h.record.proposalId).state, 'expired'); assert.equal(h.calls.length, 0);
});
test('single use after success', async (t) => {
  const h = await fixture(t); await assertSuccess(h); const count = h.calls.length;
  assert.equal((await h.invoke()).status, 409); assert.equal(h.calls.length, count);
});
test('double click and second proposal see consumed ID and workspace BUSY', async (t) => {
  const h = await fixture(t); const second = h.store.register(h.data);
  let release; let entered; const gate = new Promise((resolve) => { release = resolve; });
  const entry = new Promise((resolve) => { entered = resolve; }); let first = true;
  h.intercept = async () => { if (first) { first = false; entered(); await gate; } };
  const running = h.invoke(); await entry;
  assert.equal((await h.invoke()).data.code, 'PROPOSAL_UNAVAILABLE');
  assert.equal((await h.invoke({ proposalId: second.proposalId })).data.code, 'BUSY');
  assert.equal(h.store.get(second.proposalId).state, 'ready'); release(); assert.equal((await running).status, 200);
});
async function assertRejected(h) {
  const response = await h.invoke(); assert.equal(response.data.code, 'APPLY_FAILED');
  assert.match(response.data.error, /cambios parciales.*revisión manual/);
  assert.ok(!JSON.stringify(response.data).includes(h.workspace));
  assert.ok(!JSON.stringify(response.data).includes(old));
  assert.equal(h.store.get(h.record.proposalId).state, 'failed');
  assert.ok(!h.calls.some(({ args }) => args[0] === 'apply' && !args.includes('--check')));
  assert.ok(h.calls.some(({ args }) => args[0] === 'diff' && args.includes('--cached')), 'final audit runs');
  const count = h.calls.length; assert.equal((await h.invoke()).status, 409); assert.equal(h.calls.length, count);
}
for (const name of ['HEAD', 'working tree', 'index', 'fingerprint', 'symlink', 'submodule', 'split', 'sparse',
  'assume unchanged', 'skip worktree', 'filter', 'encoding', 'autocrlf', 'workspace', 'mode', 'untracked', 'ignored untracked']) {
  test(`preflight rejects ${name}, audits and consumes`, async (t) => {
    const h = await fixture(t); const p = h.workspace;
    if (name === 'HEAD') {
      const tree = fixtureGit(p, ['write-tree']).trim(); const next = fixtureGit(p, ['commit-tree', tree, '-p', h.record.baseHead], 'Competing HEAD\n').trim();
      fixtureGit(p, ['update-ref', 'HEAD', next]);
    }
    if (name === 'working tree') await writeFile(join(p, 'README.md'), 'external');
    if (name === 'index') { await writeFile(join(p, 'README.md'), 'external'); fixtureGit(p, ['add', 'README.md']); await writeFile(join(p, 'README.md'), old); }
    if (name === 'fingerprint') {
      const other = h.store.register({ ...h.data, originalFingerprints: { 'README.md': sha256('different') } });
      const result = await h.invoke({ proposalId: other.proposalId }); assert.equal(result.data.code, 'APPLY_FAILED');
      assert.equal(h.store.get(other.proposalId).state, 'failed'); return;
    }
    if (name === 'symlink') { await unlink(join(p, 'README.md')); await symlink('/dev/null', join(p, 'README.md')); }
    if (name === 'submodule') fixtureGit(p, ['update-index', '--cacheinfo', `160000,${h.record.baseHead},README.md`]);
    if (name === 'split') fixtureGit(p, ['update-index', '--split-index']);
    if (name === 'sparse') fixtureGit(p, ['sparse-checkout', 'init', '--cone', '--sparse-index']);
    if (name === 'assume unchanged') fixtureGit(p, ['update-index', '--assume-unchanged', 'README.md']);
    if (name === 'skip worktree') fixtureGit(p, ['update-index', '--skip-worktree', 'README.md']);
    if (name === 'filter') fixtureGit(p, ['config', 'filter.custom.clean', 'private-command']);
    if (name === 'encoding') await writeFile(join(p, '.git/info/attributes'), 'README.md working-tree-encoding=UTF-8\n');
    if (name === 'autocrlf') fixtureGit(p, ['config', 'core.autocrlf', 'true']);
    if (name === 'workspace') h.workspaceStatus = { available: true, running: true, workspace: '/unavailable' };
    if (name === 'mode') await chmod(join(p, 'README.md'), 0o755);
    if (name === 'untracked') await writeFile(join(p, 'extra.txt'), 'external');
    if (name === 'ignored untracked') { await writeFile(join(p, '.git/info/exclude'), 'extra.txt\n'); await writeFile(join(p, 'extra.txt'), 'external'); }
    await assertRejected(h);
  });
}
for (const race of ['working tree', 'index', 'HEAD']) {
  test(`race after temporary check: ${race} is rejected before mutation`, async (t) => {
    const h = await fixture(t); let injected = false;
    h.intercept = async (p, args, options) => {
      if (!injected && args[0] === 'apply' && args.includes('--check') && options.temporaryIndex) {
        injected = true;
        if (race === 'working tree') await writeFile(join(p, 'README.md'), 'external');
        if (race === 'index') { await writeFile(join(p, 'README.md'), 'external'); fixtureGit(p, ['add', 'README.md']); await writeFile(join(p, 'README.md'), old); }
        if (race === 'HEAD') {
          const tree = fixtureGit(p, ['write-tree']).trim(); const head = fixtureGit(p, ['commit-tree', tree, '-p', h.record.baseHead], 'Race\n').trim();
          fixtureGit(p, ['update-ref', 'HEAD', head]);
        }
      }
    };
    await assertRejected(h);
  });
}
test('late multi-file write failure audits every invariant, leaves partial change, cleans temp and consumes', async (t) => {
  const h = await fixture(t, { paths: ['README.md', 'locked/second.txt'] }); let tempPath;
  h.intercept = async (p, args, options) => {
    if (args[0] === 'apply' && !args.includes('--check')) {
      tempPath = options.temporaryIndex.path;
      assert.equal((await stat(join(tempPath, '..'))).mode & 0o777, 0o700);
      assert.equal((await stat(tempPath)).mode & 0o777, 0o600);
      await chmod(join(p, 'locked'), 0o555);
    }
  };
  const response = await h.invoke(); assert.equal(response.status, 500);
  assert.match(response.data.error, /cambios parciales.*revisión manual/);
  assert.equal(h.store.get(h.record.proposalId).state, 'failed');
  assert.equal(await readFile(join(h.workspace, 'README.md'), 'utf8'), proposed);
  assert.equal(await readFile(join(h.workspace, 'locked/second.txt'), 'utf8'), old);
  assert.deepEqual(await readFile(join(h.workspace, '.git/index')), h.indexBefore);
  assert.equal(fixtureGit(h.workspace, ['rev-parse', 'HEAD']).trim(), h.record.baseHead);
  assert.equal(fixtureGit(h.workspace, ['status', '--short']), ' M README.md\n');
  await assert.rejects(stat(tempPath));
  const mutation = h.calls.findIndex(({ args }) => args[0] === 'apply' && !args.includes('--check'));
  const audit = h.calls.slice(mutation + 1);
  for (const command of ['rev-parse', 'diff', 'ls-files', 'status']) assert.ok(audit.some(({ args }) => args[0] === command));
  assert.equal((await h.invoke()).status, 409); assert.ok(h.locks.acquire(h.workspace));
});
test('failure of one audit does not prevent remaining audits', async (t) => {
  const h = await fixture(t); let applied = false;
  h.intercept = async (p, args) => {
    if (args[0] === 'apply' && !args.includes('--check')) applied = true;
    if (applied && args[0] === 'rev-parse') throw new Error('private stdout stderr hash');
  };
  const result = await h.invoke(); assert.equal(result.status, 500);
  assert.equal(h.store.get(h.record.proposalId).state, 'failed');
  assert.ok(h.calls.some(({ args }) => applied && args[0] === 'status'));
  assert.ok(!JSON.stringify(result.data).includes('private'));
});
test('generation registers after final audit and retains exact fingerprints without inference', async (t) => {
  const h = await fixture(t); const handler = createChangeProposalHandler({ store: h.store, locks: h.locks,
    getWorkspaceStatus: async () => ({ available: true, running: true, workspace: h.workspace }),
    selectFiles: async () => ({ files: ['README.md'] }),
    generateProposal: async () => ({ summary: 'Fixture change', files: [{ path: 'README.md', content: proposed }] }),
    json: (response, status, data) => Object.assign(response, { status, data }) });
  const request = Readable.from([Buffer.from(JSON.stringify({ request: 'Fixture' }))]);
  Object.assign(request, { method: 'POST', url: '/api/opencode/change-proposal', headers: { 'content-type': 'application/json', host: 'localhost' } });
  const response = { setHeader() {} }; await handler(request, response); assert.equal(response.status, 200);
  const saved = h.store.get(response.data.proposalId);
  assert.equal(saved.patch, response.data.proposal.patch); assert.equal(saved.originalFingerprints['README.md'], sha256(old));
  assert.equal(saved.proposedFingerprints['README.md'], sha256(proposed));
  assert.equal((await h.invoke({ proposalId: saved.proposalId })).status, 200);
});

test('generation final audit failure never registers a proposal', async (t) => {
  const h = await fixture(t); let registers = 0;
  const handler = createChangeProposalHandler({ locks: h.locks,
    store: { register() { registers++; assert.fail('must not register'); } },
    getWorkspaceStatus: async () => ({ available: true, running: true, workspace: h.workspace }),
    selectFiles: async () => ({ files: ['README.md'] }),
    generateProposal: async () => ({ summary: 'Fixture', files: [{ path: 'README.md', content: proposed }] }),
    git: async (cwd, args, options) => {
      if (args[0] === 'apply') {
        await writeFile(join(cwd, 'README.md'), 'external final change');
        throw new Error('PRIVATE git output');
      }
      return runProposalGit(cwd, args, options);
    }, json: (response, status, data) => Object.assign(response, { status, data }) });
  const request = Readable.from([Buffer.from('{"request":"fixture"}')]);
  Object.assign(request, { method: 'POST', url: '/api/opencode/change-proposal', headers: { 'content-type': 'application/json', host: 'localhost' } });
  const response = { setHeader() {} }; await handler(request, response);
  assert.equal(registers, 0); assert.equal(response.data.proposalId, undefined);
  assert.equal(response.data.success, false);
});

test('split detection still rejects when core.splitIndex is false', async (t) => {
  const h = await fixture(t); fixtureGit(h.workspace, ['update-index', '--split-index']);
  fixtureGit(h.workspace, ['config', 'core.splitIndex', 'false']); await assertRejected(h);
});

test('late external real-index mutation fails final audit without unstaging it', async (t) => {
  const h = await fixture(t); let changedIndex;
  h.intercept = async (p, args) => {
    if (args[0] === 'apply' && !args.includes('--check')) {
      const externalBlob = fixtureGit(p, ['hash-object', '-w', '--stdin'], 'external index').trim();
      fixtureGit(p, ['update-index', '--cacheinfo', `100644,${externalBlob},README.md`]);
      changedIndex = await readFile(join(p, '.git/index'));
    }
  };
  const result = await h.invoke(); assert.equal(result.status, 500);
  assert.equal(h.store.get(h.record.proposalId).state, 'failed');
  assert.equal(await readFile(join(h.workspace, 'README.md'), 'utf8'), proposed);
  assert.deepEqual(await readFile(join(h.workspace, '.git/index')), changedIndex);
  assert.equal(fixtureGit(h.workspace, ['status', '--short']), 'MM README.md\n');
});

test('late external HEAD mutation fails final audit without changing the new HEAD', async (t) => {
  const h = await fixture(t); let changedHead;
  h.intercept = async (p, args) => {
    if (args[0] === 'apply' && !args.includes('--check')) {
      const tree = fixtureGit(p, ['write-tree']).trim(); changedHead = fixtureGit(p, ['commit-tree', tree, '-p', h.record.baseHead], 'Late race\n').trim();
      fixtureGit(p, ['update-ref', 'HEAD', changedHead]);
    }
  };
  const result = await h.invoke(); assert.equal(result.status, 500);
  assert.equal(h.store.get(h.record.proposalId).state, 'failed');
  assert.equal(fixtureGit(h.workspace, ['rev-parse', 'HEAD']).trim(), changedHead);
  assert.deepEqual(await readFile(join(h.workspace, '.git/index')), h.indexBefore);
});

test('unsafe configured clean filter is never executed during rejection or audit', async (t) => {
  const h = await fixture(t); const marker = join(h.workspace, 'filter-ran');
  // If Git ever launches this filter it creates a detectable fixture marker.
  const script = join(h.workspace, '.git', 'filter.js');
  await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`);
  fixtureGit(h.workspace, ['config', 'filter.fixture.clean', `node ${script}`]);
  await writeFile(join(h.workspace, '.git/info/attributes'), 'README.md filter=fixture\n');
  await assertRejected(h); await assert.rejects(stat(marker));
});

test('frontend remains untouched and endpoint wires the same store and locks', async () => {
  const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(source, /path === '\/api\/opencode\/apply-change-proposal'/);
  assert.match(source, /createChangeProposalHandler\(\{ store: proposalStore, locks: proposalLocks/);
  assert.match(source, /createApplyChangeProposalHandler\(\{ store: proposalStore, locks: proposalLocks/);
  assert.match(source, /proposalLocks\.acquireExclusive\(\)/);
});
