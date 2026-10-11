import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, stat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { buildAuthorizedCatalog, readSelectedTextFiles, openTrackedRegularFile,
  createChangeProposalHandler, validatePatchStructure, proposalPhaseDeadline,
  runProposalGit, validateChangeRequest, validProposalPath } from './change-proposal.js';
import { selectProposalFiles } from './file-selection.js';
import { generateDeterministicProposal } from './deterministic-proposal.js';
import { generateDeterministicDiff } from './deterministic-diff.js';

const head = 'a'.repeat(40);
const patch = 'diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-before\n+after\n';
const proposal = { summary: 'Actualizar el texto.', files: ['example.txt'], patch };
const contentProposal = { summary: proposal.summary, files: [{ path: 'example.txt', content: 'after\n' }] };
const privateMarker = 'PRIVATE_REQUEST_CONTENT_RAW_HASH';
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
  const events = [];
  let selectCalls = 0;
  let generateCalls = 0;
  let statusCalls = 0;
  let headCalls = 0;
  let workspaceCalls = 0;
  const handler = createChangeProposalHandler({
    getWorkspaceStatus: async () => {
      workspaceCalls++;
      if (options.statusError) throw options.statusError;
      return { available: true, running: true, cliAvailable: false, workspace,
        ...options.workspaceStatus?.(workspaceCalls) };
    },
    // Any accidental use of old dependencies fails the test.
    queryOpenCode: () => assert.fail('OpenCode must never be called'),
    model: () => assert.fail('OpenCode model must never be called'),
    git: async (cwd, args, settings) => {
      assert.equal(cwd, workspace);
      calls.push(args);
      events.push(args[0]);
      if (args[0] === 'status') return options.statusOutput?.(++statusCalls) ?? '';
      if (args.join(' ') === 'rev-parse HEAD') return options.headOutput?.(++headCalls) ?? head;
      if (args[0] === 'ls-files' && args.length === 3 && options.catalogOutput !== undefined) return options.catalogOutput;
      if (args[0] === 'ls-files' && args.length > 3) options.readCheck?.(args.slice(4));
      if (args[0] === 'apply') {
        assert.deepEqual(args, ['apply', '--check', '--recount', '--index', '--whitespace=error', '-']);
        options.checkInput?.(settings.input);
        if (options.rejectMetadata && settings.input.includes('index 1234567..abcdef0 100755\n')) {
          throw Object.assign(new Error('PRIVATE Git metadata rejection'), { code: 1, stderr: 'PRIVATE' });
        }
        if (options.applyError) throw options.applyError;
        if (options.applyFails) throw new Error('PRIVATE Git detail');
      }
      return runProposalGit(cwd, args, settings);
    },
    selectFiles: async (input, dependencies) => {
      selectCalls++;
      events.push('selection');
      options.selectionInput?.(input, dependencies);
      if (options.nativePhases) return selectProposalFiles(input, dependencies);
      if (options.selectFiles) return options.selectFiles(input, dependencies);
      return selectProposalFiles(input, { ...dependencies,
        generate: async (args) => {
          assert.equal(args.messages.length, 2);
          assert.equal(Object.hasOwn(args, 'tools'), false);
          return JSON.stringify({ files: options.selection ?? ['example.txt'] });
        } });
    },
    generateProposal: async (input, dependencies) => {
      generateCalls++;
      events.push('generation');
      options.generationInput?.(input, dependencies);
      if (options.nativePhases) return generateDeterministicProposal(input, dependencies);
      if (options.generateProposal) return options.generateProposal(input, dependencies);
      return options.phase2 ?? { summary: (options.proposal ?? proposal).summary,
        files: (options.proposal ?? proposal).files.map((path) => ({ path, content: 'after\n' })) };
    },
    generateDiff: async (input, dependencies) => {
      events.push('diff');
      options.diffInput?.(input, dependencies);
      if (options.generateDiff) return options.generateDiff(input, dependencies);
      if (options.nativePhases || options.realDiff) return generateDeterministicDiff(input, dependencies);
      const value = options.proposal ?? proposal;
      // Malformed assembled-diff tests can deliberately omit a declared header.
      return { changed: true, path: input.path, patch: input.path === value.files[0] ? value.patch : '+after\n' };
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
  return { invoke, calls, events, get selectCalls() { return selectCalls; }, get generateCalls() { return generateCalls; } };
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
    if (files.includes('other.txt')) await addHelperFile(workspace, 'other.txt', 'before\n');
    const paths = ['example.txt', 'binary.bin', '.env', '.git/index'];
    const before = await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`)));
    const value = { ...proposal, files, patch: rejectedPatch };
    assert.throws(() => validatePatchStructure(value), (error) =>
      error.publicCode === 'INVALID_PATCH_STRUCTURE' && error.patchStructureReason === reason);
    const h = harness(workspace, { proposal: value, selection: files });
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
  assert.equal((await harness(workspace).invoke()).data.proposal.patch, patch);
  const spaced = patch.replace('+after', '+after  ');
  let actual;
  await harness(workspace, { proposal: { ...proposal, patch: spaced.slice(0, -1) }, checkInput: (input) => { actual = input; } }).invoke();
  assert.equal(actual, spaced);
  const crlf = patch.replaceAll('\n', '\r\n');
  assert.equal((await harness(workspace, { proposal: { ...proposal, patch: crlf } }).invoke()).data.code, 'INVALID_PATCH_STRUCTURE');
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
  assert.equal(Buffer.byteLength((await harness(workspace, { proposal: { ...proposal, patch: boundary } }).invoke()).data.proposal.patch), limit);
  const tooLarge = largePatch(limit);
  assert.equal(Buffer.byteLength(tooLarge), limit);
  const h = harness(workspace, { proposal: { ...proposal, patch: tooLarge } });
  const response = await h.invoke();
  assert.deepEqual(response.data, { success: false, code: 'DETERMINISTIC_MODEL_INVALID',
    error: 'El modelo no devolvió una propuesta válida.' });
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
  await addHelperFile(workspace, 'other.txt', 'before\n');
  before[3] = await readFile(`${workspace}/.git/index`);
  // Recount does not relax path, file/header, body or declaration checks.
  for (const [reason, input, files = proposal.files] of patchReasonCases) {
    if (reason === 'invalid_hunk_counts') continue;
    const h = harness(workspace, { selection: files, proposal: { ...proposal, files, patch: input } });
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


const helperDeadline = () => Date.now() + 30_000;
const indexEntry = (path, mode = '100644', stage = '0') => `${mode} ${head} ${stage}\t${path}\0`;
const simulatedIndex = (output) => async (_workspace, args, { deadline }) => {
  assert.deepEqual(args.slice(0, 3), ['ls-files', '--stage', '-z']);
  assert.ok(deadline > Date.now());
  return output;
};
async function assertSafeHelperRejection(operation, code = 'FILE_VALIDATION_FAILED') {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.code, code);
    assert.deepEqual(Object.keys(error), ['code']);
    assert.equal(error.publicCode, undefined);
    const details = String(error) + JSON.stringify(error);
    assert.ok(!/PRIVATE|SECRET|\.env|stderr|stdout|diff --git|ELOOP|ENOENT/.test(details));
    assert.equal(error.cause, undefined);
    assert.equal(error.path, undefined);
    return true;
  });
}
async function addHelperFile(workspace, path, content) {
  await writeFile(`${workspace}/${path}`, content);
  execFileSync('git', ['add', '--', path], { cwd: workspace });
}

test('catalog uses real staged modes, excludes symlinks/submodules/sensitive paths and sorts', async (t) => {
  const workspace = await fixture(t);
  await addHelperFile(workspace, 'z.txt', 'z');
  await addHelperFile(workspace, 'a.txt', 'a');
  execFileSync('git', ['update-index', '--chmod=+x', 'z.txt'], { cwd: workspace });
  execFileSync('git', ['update-index', '--add', '--cacheinfo', `160000,${head},submodule`], { cwd: workspace });
  const before = await readFile(`${workspace}/.git/index`);
  assert.deepEqual(await buildAuthorizedCatalog(workspace, helperDeadline()), ['a.txt', 'binary.bin', 'example.txt', 'z.txt']);
  assert.deepEqual(await readFile(`${workspace}/.git/index`), before);
});

test('catalog excludes nonzero stages and unknown modes without opening their paths', async (t) => {
  const workspace = await fixture(t);
  const git = simulatedIndex(indexEntry('example.txt') + indexEntry('absent.txt', '100644', '1')
    + indexEntry('other.txt', '040000') + indexEntry('alias.txt', '120000')
    + indexEntry('module', '160000') + indexEntry('.env') + indexEntry('../outside.txt'));
  assert.deepEqual(await buildAuthorizedCatalog(workspace, helperDeadline(), git), ['example.txt']);
});

test('catalog rejects duplicate records and malformed Git output safely', async (t) => {
  const workspace = await fixture(t);
  for (const output of [indexEntry('example.txt').repeat(2), 'PRIVATE_GIT_STDERR', indexEntry('example.txt').slice(0, -1)]) {
    await assertSafeHelperRejection(buildAuthorizedCatalog(workspace, helperDeadline(), simulatedIndex(output)));
  }
});

for (const kind of ['final symlink', 'intermediate symlink', 'special file']) {
  test(`secure helpers reject ${kind} even with simulated regular Git mode`, async (t) => {
    const workspace = await fixture(t);
    let path;
    if (kind === 'final symlink') path = 'alias.txt';
    else if (kind === 'intermediate symlink') {
      await mkdir(`${workspace}/real`);
      await writeFile(`${workspace}/real/data.txt`, 'PRIVATE_CONTENT');
      await symlink('real', `${workspace}/linked`);
      path = 'linked/data.txt';
    } else {
      path = 'pipe.txt';
      execFileSync('mkfifo', [`${workspace}/${path}`]);
    }
    const git = simulatedIndex(indexEntry(path));
    await assertSafeHelperRejection(buildAuthorizedCatalog(workspace, helperDeadline(), git));
    await assertSafeHelperRejection(readSelectedTextFiles(workspace, [path], helperDeadline(), git));
  });
}

test('catalog accepts all 1000 authorized files and never truncates 1001', async (t) => {
  const workspace = await fixture(t);
  const paths = Array.from({ length: 1000 }, (_, i) => `catalog-${String(i).padStart(4, '0')}.txt`);
  for (const path of paths) await writeFile(`${workspace}/${path}`, '');
  assert.deepEqual(await buildAuthorizedCatalog(workspace, helperDeadline(),
    simulatedIndex([...paths].reverse().map((path) => indexEntry(path)).join(''))), paths);
  await assertSafeHelperRejection(buildAuthorizedCatalog(workspace, helperDeadline(),
    simulatedIndex([...paths, 'extra.txt'].map((path) => indexEntry(path)).join(''))), 'AUTHORIZED_CATALOG_TOO_LARGE');
});

for (const [name, bytes, expected] of [
  ['ASCII', Buffer.from('exact text\n'), 'exact text\n'],
  ['CRLF', Buffer.from('first\r\nsecond\r\n'), 'first\r\nsecond\r\n'],
  ['no final newline', Buffer.from('last line'), 'last line'],
  ['Unicode across chunks', Buffer.from('x'.repeat(4095) + '€ñ😀'), 'x'.repeat(4095) + '€ñ😀'],
  ['UTF-8 BOM', Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63]), '\uFEFFabc'],
]) {
  test(`selected read preserves ${name} exactly`, async (t) => {
    const workspace = await fixture(t);
    await addHelperFile(workspace, 'data.txt', bytes);
    const before = await readFile(`${workspace}/.git/index`);
    assert.deepEqual(await readSelectedTextFiles(workspace, ['data.txt'], helperDeadline()), [{ path: 'data.txt', content: expected }]);
    assert.deepEqual(await readFile(`${workspace}/data.txt`), bytes);
    assert.deepEqual(await readFile(`${workspace}/.git/index`), before);
  });
}

for (const [name, bytes] of [
  ['NUL', Buffer.from('PRIVATE_CONTENT\0')],
  ['invalid UTF-8', Buffer.from([0xff])],
  ['incomplete UTF-8', Buffer.from([0xe2, 0x82])],
  ['over 16 KiB', Buffer.from('x'.repeat(16385))],
]) {
  test(`selected read rejects ${name} safely`, async (t) => {
    const workspace = await fixture(t);
    await addHelperFile(workspace, 'data.txt', bytes);
    await assertSafeHelperRejection(readSelectedTextFiles(workspace, ['data.txt'], helperDeadline()),
      name === 'over 16 KiB' ? 'SELECTED_FILE_TOO_LARGE' : 'FILE_VALIDATION_FAILED');
    assert.deepEqual(await readFile(`${workspace}/data.txt`), bytes);
  });
}

test('selected read accepts exactly 16 KiB/file and 32 KiB total; rejects excess total', async (t) => {
  const workspace = await fixture(t);
  const content = 'x'.repeat(16384);
  await addHelperFile(workspace, 'a.txt', content);
  await addHelperFile(workspace, 'b.txt', content);
  await addHelperFile(workspace, 'c.txt', 'x');
  const before = await readFile(`${workspace}/.git/index`);
  assert.deepEqual(await readSelectedTextFiles(workspace, ['a.txt', 'b.txt'], helperDeadline()), [
    { path: 'a.txt', content }, { path: 'b.txt', content },
  ]);
  await assertSafeHelperRejection(readSelectedTextFiles(workspace, ['a.txt', 'b.txt', 'c.txt'], helperDeadline()),
    'SELECTED_CONTENT_TOO_LARGE');
  assert.deepEqual(await readFile(`${workspace}/.git/index`), before);
});

test('selected read rejects 21 distinct paths before Git', async (t) => {
  const workspace = await fixture(t);
  const paths = Array.from({ length: 21 }, (_, i) => `selected-${i}.txt`);
  assert.equal(new Set(paths).size, 21);
  let calls = 0;
  await assertSafeHelperRejection(readSelectedTextFiles(workspace, paths, helperDeadline(), async () => { calls++; return ''; }));
  assert.equal(calls, 0);
});

test('selected read rejects duplicate paths before Git', async (t) => {
  const workspace = await fixture(t);
  let calls = 0;
  await assertSafeHelperRejection(readSelectedTextFiles(workspace, ['example.txt', 'example.txt'], helperDeadline(),
    async () => { calls++; return ''; }));
  assert.equal(calls, 0);
});

test('selected read rejects invalid and untracked paths', async (t) => {
  const workspace = await fixture(t);
  let calls = 0;
  const git = async () => { calls++; return ''; };
  for (const paths of [[],
    ['../example.txt'], ['/example.txt'], ['.env']]) {
    await assertSafeHelperRejection(readSelectedTextFiles(workspace, paths, helperDeadline(), git));
  }
  assert.equal(calls, 0);
  await assertSafeHelperRejection(readSelectedTextFiles(workspace, ['missing.txt'], helperDeadline()));
  for (const entry of [indexEntry('example.txt', '160000'), indexEntry('example.txt', '100644', '1')]) {
    await assertSafeHelperRejection(readSelectedTextFiles(workspace, ['example.txt'], helperDeadline(), simulatedIndex(entry)));
  }
});

test('helpers check deadline before Git and after Git without exposing process failures', async (t) => {
  const workspace = await fixture(t);
  const never = async () => assert.fail('expired deadline must not execute Git');
  await assertSafeHelperRejection(buildAuthorizedCatalog(workspace, Date.now() - 1, never), 'FILE_OPERATION_TIMEOUT');
  await assertSafeHelperRejection(readSelectedTextFiles(workspace, ['example.txt'], Date.now() - 1, never), 'FILE_OPERATION_TIMEOUT');
  const deadline = Date.now() + 10;
  const slow = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return indexEntry('example.txt');
  };
  await assertSafeHelperRejection(buildAuthorizedCatalog(workspace, deadline, slow), 'FILE_OPERATION_TIMEOUT');
  const failing = async () => { throw Object.assign(new Error('PRIVATE_GIT'), {
    code: 'FILE_OPERATION_TIMEOUT', stderr: 'PRIVATE_STDERR', stdout: 'PRIVATE_STDOUT', cause: 'PRIVATE_CAUSE',
  }); };
  await assertSafeHelperRejection(buildAuthorizedCatalog(workspace, helperDeadline(), failing));
  await assertSafeHelperRejection(readSelectedTextFiles(workspace, ['example.txt'], helperDeadline(), failing));
});

test('opening helper rejects escapes, submodule modes and expired deadlines', async (t) => {
  const workspace = await fixture(t);
  for (const [path, mode, deadline] of [['../example.txt', '100644', helperDeadline()],
    ['example.txt', '160000', helperDeadline()], ['example.txt', '100644', Date.now() - 1]]) {
    await assertSafeHelperRejection(openTrackedRegularFile(workspace, path, mode, deadline),
      deadline <= Date.now() ? 'FILE_OPERATION_TIMEOUT' : 'FILE_VALIDATION_FAILED');
  }
});

test('two phases receive only their authorized data, catalog precedes selection and audit is mandatory', async (t) => {
  const workspace = await fixture(t);
  await addHelperFile(workspace, 'other.txt', 'PRIVATE_NOT_SELECTED');
  const paths = ['example.txt', 'other.txt', '.env', 'binary.bin', '.git/index'];
  const before = await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`)));
  let firstDeadline;
  const h = harness(workspace, {
    selectionInput: (input, deps) => {
      assert.deepEqual(Object.keys(input).sort(), ['catalog', 'deadline', 'request']);
      assert.deepEqual(input.catalog, ['binary.bin', 'example.txt', 'other.txt']);
      assert.equal(input.request, privateMarker);
      assert.equal(deps.validatePath, validProposalPath);
      assert.ok(!JSON.stringify(input).includes('PRIVATE_NOT_SELECTED'));
      firstDeadline = input.deadline;
    },
    generationInput: (input, deps) => {
      assert.deepEqual(input.files, [{ path: 'example.txt', content: 'before\n' }]);
      assert.equal(input.request, privateMarker);
      assert.equal(deps.validatePath, validProposalPath);
      assert.ok(input.deadline <= firstDeadline + 120_000);
    },
    readCheck: (paths) => assert.deepEqual(paths, ['example.txt']),
  });
  const response = await h.invoke({ request: privateMarker });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { success: true, workspace, engine: 'ollama-deterministic', baseHead: head, proposal });
  assert.equal(Object.hasOwn(response.data, 'agent'), false);
  assert.ok(h.events.indexOf('ls-files') < h.events.indexOf('selection'));
  assert.equal(h.calls.filter((args) => args[0] === 'status').length, 6);
  assert.equal(h.calls.filter((args) => args[0] === 'apply').length, 1);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(`${workspace}/${path}`))), before);
});

test('request, method, origin and dirty workspace fail before inference', async (t) => {
  const workspace = await fixture(t);
  for (const dirty of [' M example.txt\n', 'M  example.txt\n', '?? new.txt\n', 'UU example.txt\n']) {
    const h = harness(workspace, { statusOutput: () => dirty });
    assert.equal((await h.invoke()).data.code, 'DIRTY_WORKSPACE');
    assert.equal(h.selectCalls, 0);
  }
  const h = harness(workspace);
  for (const body of ['{', 'x'.repeat(33000), { request: 'x', command: 'git reset' }]) {
    assert.notEqual((await h.invoke(body)).status, 200);
  }
  assert.equal((await h.invoke({}, { method: 'GET' })).data.code, 'METHOD');
  assert.equal((await h.invoke({ request: 'x' }, { headers: { 'content-type': 'text/plain' } })).data.code, 'CONTENT_TYPE');
  assert.equal((await h.invoke({ request: 'x' }, { url: '/api/opencode/change-proposal?x=y' })).status, 400);
  assert.equal((await h.invoke({ request: 'x' }, { headers: { origin: 'https://other.invalid' } })).status, 403);
  assert.equal(h.selectCalls, 0);
});

for (const path of ['alias.txt', 'untracked.txt', '.env', '../secret', 'submodule']) {
  test(`unauthorized selection ${path} never reaches reads or generation`, async (t) => {
    const workspace = await fixture(t);
    const h = harness(workspace, { selectFiles: async () => ({ files: [path] }), readCheck: () => assert.fail('must not read') });
    assert.equal((await h.invoke()).data.code, 'FILE_SELECTION_MODEL_INVALID');
    assert.equal(h.generateCalls, 0);
    assert.ok(!h.calls.some((args) => args[0] === 'apply'));
  });
}

test('binary selected file fails safe before generation', async (t) => {
  const h = harness(await fixture(t), { selection: ['binary.bin'] });
  assert.equal((await h.invoke()).data.code, 'WORKSPACE_NOT_SAFE');
  assert.equal(h.generateCalls, 0);
});

for (const [label, options, expected, generated] of [
  ['HEAD after selection', { headOutput: (call) => call >= 3 ? 'b'.repeat(40) : head }, 'HEAD_CHANGED', 0],
  ['dirty after selection', { statusOutput: (call) => call >= 3 ? '?? PRIVATE_DIRTY\n' : '' }, 'WORKSPACE_NOT_SAFE', 0],
  ['HEAD after read', { headOutput: (call) => call >= 4 ? 'b'.repeat(40) : head }, 'HEAD_CHANGED', 0],
  ['dirty after generation', { statusOutput: (call) => call >= 5 ? ' M example.txt\n' : '' }, 'WORKSPACE_NOT_SAFE', 1],
  ['mount after selection', { workspaceStatus: (call) => call === 3 ? { workspace: '/PRIVATE_OTHER' } : {} }, 'WORKSPACE_CHANGED', 0],
]) {
  test(`checkpoint rejects ${label} before patch check`, async (t) => {
    const h = harness(await fixture(t), options);
    assert.equal((await h.invoke()).data.code, expected);
    assert.equal(h.generateCalls, generated);
    assert.ok(!h.calls.some((args) => args[0] === 'apply'));
  });
}

test('changed snapshot rejects even when simulated Git reports clean', async (t) => {
  const workspace = await fixture(t);
  const h = harness(workspace, { generateProposal: async () => {
    await writeFile(`${workspace}/example.txt`, 'PRIVATE_CHANGED_CONTENT');
    return structuredClone(contentProposal);
  } });
  const r = await h.invoke();
  assert.equal(r.data.code, 'WORKSPACE_CHANGED');
  assert.ok(!JSON.stringify(r.data).includes('PRIVATE_CHANGED_CONTENT'));
  assert.ok(!h.calls.some((args) => args[0] === 'apply'));
  assert.ok(!h.events.includes('diff'));
});

test('diff gets original/new contents and a shared work deadline after snapshot reread', async (t) => {
  const workspace = await fixture(t);
  await addHelperFile(workspace, 'a.txt', 'original a\n');
  let trackedReads = 0;
  let phaseDeadline;
  const received = [];
  const h = harness(workspace, { selection: ['example.txt', 'a.txt'],
    phase2: { summary: 'Cambiar dos archivos.', files: [
      { path: 'example.txt', content: 'after\n' }, { path: 'a.txt', content: 'changed a\n' },
    ] },
    generationInput: (input) => { phaseDeadline = input.deadline; },
    readCheck: () => { trackedReads++; },
    generateDiff: async (input, dependencies) => {
      assert.equal(trackedReads, 2, 'first read and fingerprint reread precede diff');
      assert.deepEqual(Object.keys(input).sort(), ['deadline', 'originalContent', 'path', 'proposedContent']);
      assert.equal(dependencies.validatePath, validProposalPath);
      received.push(input);
      return generateDeterministicDiff(input, dependencies);
    },
  });
  const before = await readFile(`${workspace}/.git/index`);
  const result = await h.invoke();
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.proposal.files, ['a.txt', 'example.txt']);
  assert.deepEqual(received.map(({ path, originalContent, proposedContent }) => ({ path, originalContent, proposedContent })), [
    { path: 'a.txt', originalContent: 'original a\n', proposedContent: 'changed a\n' },
    { path: 'example.txt', originalContent: 'before\n', proposedContent: 'after\n' },
  ]);
  assert.equal(received[0].deadline, received[1].deadline);
  assert.ok(received[0].deadline >= phaseDeadline + 10_000);
  assert.ok(result.data.proposal.patch.indexOf('a/a.txt') < result.data.proposal.patch.indexOf('a/example.txt'));
  assert.deepEqual(await readFile(`${workspace}/.git/index`), before);
});

for (const allIdentical of [false, true]) {
  test(`identical proposed files excluded; all identical=${allIdentical}`, async (t) => {
    const workspace = await fixture(t);
    await addHelperFile(workspace, 'other.txt', 'same\n');
    const h = harness(workspace, { realDiff: true, selection: ['example.txt', 'other.txt'],
      phase2: { summary: 'Texto.', files: [
        { path: 'example.txt', content: allIdentical ? 'before\n' : 'after\n' },
        { path: 'other.txt', content: 'same\n' },
      ] } });
    const result = await h.invoke();
    if (allIdentical) {
      assert.equal(result.data.code, 'INVALID_PATCH_STRUCTURE');
      assert.equal(result.data.patchStructureReason, 'no_changes');
      assert.ok(!h.calls.some((args) => args[0] === 'apply'));
    } else {
      assert.equal(result.status, 200); assert.deepEqual(result.data.proposal.files, ['example.txt']);
      assert.ok(!result.data.proposal.patch.includes('other.txt'));
    }
    assert.equal(h.calls.at(-1).join(' '), 'rev-parse HEAD');
  });
}

for (const [name, phase2] of [
  ['invented', { summary: 'Texto.', files: [{ path: 'PRIVATE_UNKNOWN', content: privateMarker }] }],
  ['duplicate', { summary: 'Texto.', files: [contentProposal.files[0], contentProposal.files[0]] }],
  ['additional key', { ...contentProposal, extra: privateMarker }],
  ['old contract', proposal], ['invalid summary', { ...contentProposal, summary: null }],
  ['invalid file', { summary: 'Texto.', files: [{ path: 'example.txt', content: null }] }],
  ['extra file property', { summary: 'Texto.', files: [{ ...contentProposal.files[0], extra: privateMarker }] }],
  ['nonplain', Object.assign(Object.create({ privateMarker }), contentProposal)],
]) {
  test(`untrusted phase 2 ${name} rejected before diff`, async (t) => {
    const h = harness(await fixture(t), { phase2 });
    const result = await h.invoke();
    assert.equal(result.data.code, 'DETERMINISTIC_MODEL_INVALID');
    assert.ok(!JSON.stringify(result.data).includes(privateMarker));
    assert.ok(!h.events.includes('diff')); assert.ok(!h.calls.some((args) => args[0] === 'apply'));
  });
}

for (const code of ['DIFF_TIMEOUT', 'DIFF_INPUT_INVALID', 'DIFF_PROCESS_FAILED', 'DIFF_OUTPUT_TOO_LARGE', 'DIFF_INVALID_OUTPUT']) {
  test(`diff error ${code} is mapped safely and final audit still runs`, async (t) => {
    const h = harness(await fixture(t), { generateDiff: async () => {
      throw { code, publicCode: 'PRIVATE', status: 200, message: privateMarker,
        stdout: patch, stderr: privateMarker, pid: 1234, path: '/proc/self/fd/3' };
    } });
    const result = await h.invoke({ request: privateMarker });
    assert.equal(result.data.code, code === 'DIFF_TIMEOUT' ? 'TIMEOUT' : 'FAILED');
    if (code === 'DIFF_TIMEOUT') assert.equal(result.data.stage, 'deterministic_diff');
    assert.ok(!/PRIVATE|diff --git|\/proc|stdout|stderr|pid/.test(JSON.stringify(result.data)));
    assert.ok(!h.calls.some((args) => args[0] === 'apply'));
    assert.equal(h.calls.at(-1).join(' '), 'rev-parse HEAD');
  });
}

test('concatenated patch >512 KiB is rejected without truncation', async (t) => {
  const workspace = await fixture(t);
  await addHelperFile(workspace, 'other.txt', 'before\n');
  const h = harness(workspace, { selection: ['example.txt', 'other.txt'],
    phase2: { summary: 'Texto.', files: [{ path: 'example.txt', content: 'after\n' }, { path: 'other.txt', content: 'after\n' }] },
    generateDiff: async ({ path }) => ({ path, changed: true, patch: 'x'.repeat(256 * 1024 + 1) }),
  });
  assert.equal((await h.invoke()).data.code, 'DETERMINISTIC_MODEL_INVALID');
  assert.ok(!h.calls.some((args) => args[0] === 'apply'));
});

for (const [path, executable] of [['script.sh', true], ['docs/Guia de usuario.md', false]]) {
  test(`real handler-generated diff checks ${path} without changing content/index/mode`, async (t) => {
    const workspace = await fixture(t);
    if (path.includes('/')) await mkdir(`${workspace}/docs`);
    await addHelperFile(workspace, path, 'before\n');
    if (executable) {
      await chmod(`${workspace}/${path}`, 0o755);
      execFileSync('git', ['add', '--', path], { cwd: workspace, shell: false });
      assert.ok(execFileSync('git', ['ls-files', '--stage', '--', path], { cwd: workspace, encoding: 'utf8' }).startsWith('100755 '));
    }
    const indexBefore = await readFile(`${workspace}/.git/index`);
    const modeBefore = (await stat(`${workspace}/${path}`)).mode;
    const h = harness(workspace, { realDiff: true, selection: [path],
      phase2: { summary: 'Actualizar.', files: [{ path, content: 'after\n' }] } });
    const result = await h.invoke();
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.proposal.files, [path]);
    assert.ok(result.data.proposal.patch.startsWith(`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`));
    assert.ok(!/\n(?:index |old mode |new mode )/.test(result.data.proposal.patch));
    assert.deepEqual(h.calls.filter((args) => args[0] === 'apply'), [['apply', '--check', '--recount', '--index', '--whitespace=error', '-']]);
    assert.equal(await readFile(`${workspace}/${path}`, 'utf8'), 'before\n');
    assert.equal((await stat(`${workspace}/${path}`)).mode, modeBefore);
    assert.deepEqual(await readFile(`${workspace}/.git/index`), indexBefore);
  });
}

for (const [name, setup] of [
  ['per-file', async (workspace) => { await writeFile(`${workspace}/example.txt`, 'x'.repeat(16385)); return ['example.txt']; }],
  ['total', async (workspace) => {
    await writeFile(`${workspace}/example.txt`, 'x'.repeat(16384));
    await addHelperFile(workspace, 'other.txt', 'x'.repeat(16384));
    await addHelperFile(workspace, 'third.txt', 'x');
    return ['example.txt', 'other.txt', 'third.txt'];
  }],
]) {
  test(`reading ${name} limit maps safely and skips phase 2`, async (t) => {
    const workspace = await fixture(t);
    const selection = await setup(workspace);
    const h = harness(workspace, { selection });
    assert.equal((await h.invoke()).data.code, 'DETERMINISTIC_CONTEXT_TOO_LARGE');
    assert.equal(h.generateCalls, 0);
  });
}

test('catalog excess maps to FILE_SELECTION_CONTEXT_TOO_LARGE before selection', async (t) => {
  const h = harness(await fixture(t), { catalogOutput: Array.from({ length: 1001 }, (_, i) => indexEntry(`${i}.txt`)).join('') });
  assert.equal((await h.invoke()).data.code, 'FILE_SELECTION_CONTEXT_TOO_LARGE');
  assert.equal(h.selectCalls, 0);
});

for (const phase of [1, 2]) {
  test(`phase ${phase} timeout exposes fixed stage and numeric budget only`, async (t) => {
    const failing = async () => { throw { code: 'OLLAMA_TIMEOUT', message: privateMarker, stderr: patch, hash: head }; };
    const h = harness(await fixture(t), phase === 1 ? { selectFiles: failing } : { generateProposal: failing });
    const r = await h.invoke({ request: privateMarker });
    assert.equal(r.data.code, 'TIMEOUT');
    assert.equal(r.data.stage, phase === 1 ? 'file_selection' : 'proposal_generation');
    assert.equal(typeof r.data.timing.elapsedMs, 'number');
    assert.ok(r.data.timing.modelBudgetSeconds > 0 && r.data.timing.modelBudgetSeconds <= (phase === 1 ? 30 : 150));
    assert.equal(r.data.timeoutSource, 'client');
    assert.ok(!JSON.stringify(r.data).includes(privateMarker));
    assert.ok(!h.calls.some((args) => args[0] === 'apply'));
    assert.equal(h.calls.at(-1).join(' '), 'rev-parse HEAD');
  });
}

test('phase budgets share the initial 180 seconds and preserve 20+10 seconds', () => {
  const now = 100000;
  const deadline = now + 180000;
  assert.equal(proposalPhaseDeadline(deadline, 1, now), now + 30000);
  assert.equal(proposalPhaseDeadline(deadline, 2, now), deadline - 30000);
  assert.equal(proposalPhaseDeadline(deadline, 2, now + 40000), deadline - 30000);
  assert.equal(proposalPhaseDeadline(deadline, 1, deadline - 25000), deadline - 20000);
  assert.ok(proposalPhaseDeadline(deadline, 2, deadline - 25000) < deadline - 25000);
});

test('expired generation budget prevents phase 2 and still audits', async (t) => {
  const workspace = await fixture(t);
  const realNow = Date.now;
  let offset = 0;
  t.mock.method(Date, 'now', () => realNow() + offset);
  const h = harness(workspace, { selectFiles: async () => {
    offset = 155000;
    return { files: ['example.txt'] };
  } });
  const r = await h.invoke();
  assert.equal(r.data.code, 'TIMEOUT');
  assert.equal(h.generateCalls, 0);
  assert.equal(h.calls.at(-1).join(' '), 'rev-parse HEAD');
});

for (const [code, mapped] of [
  ['FILE_SELECTION_MODEL_INVALID', 'FILE_SELECTION_MODEL_INVALID'],
  ['FILE_SELECTION_CONTEXT_TOO_LARGE', 'FILE_SELECTION_CONTEXT_TOO_LARGE'],
  ['DETERMINISTIC_CONTEXT_TOO_LARGE', 'DETERMINISTIC_CONTEXT_TOO_LARGE'],
  ['DETERMINISTIC_MODEL_INVALID', 'DETERMINISTIC_MODEL_INVALID'],
  ['OLLAMA_UNAVAILABLE', 'OLLAMA_UNAVAILABLE'], ['OLLAMA_BAD_RESPONSE', 'OLLAMA_BAD_RESPONSE'],
  ['OLLAMA_RESPONSE_TOO_LARGE', 'OLLAMA_RESPONSE_TOO_LARGE'],
  ['FILE_SELECTION_INPUT_INVALID', 'FAILED'], ['DETERMINISTIC_INPUT_INVALID', 'FAILED'],
  ['NOT_ALLOWLISTED', 'FAILED'],
]) {
  test(`public mapper sanitizes ${code}`, async (t) => {
    const h = harness(await fixture(t), { generateProposal: async () => {
      throw { code, message: privateMarker, error: privateMarker, request: privateMarker,
        catalog: [privateMarker], contents: privateMarker, patch, stdout: privateMarker, stderr: privateMarker, stack: privateMarker, hash: head };
    } });
    const r = await h.invoke({ request: privateMarker });
    assert.equal(r.data.code, mapped);
    assert.ok(!/PRIVATE|diff --git|stdout|stderr|hash|stack|request|catalog/.test(JSON.stringify(r.data)));
    assert.ok(!JSON.stringify(r.data).includes(head));
    assert.ok(!h.calls.some((args) => args[0] === 'apply'));
  });
}

test('phase 1 failure does not execute phase 2; audit still runs', async (t) => {
  const h = harness(await fixture(t), { selectFiles: async () => { throw { code: 'FILE_SELECTION_MODEL_INVALID' }; } });
  assert.equal((await h.invoke()).data.code, 'FILE_SELECTION_MODEL_INVALID');
  assert.equal(h.generateCalls, 0);
  assert.equal(h.calls.at(-1).join(' '), 'rev-parse HEAD');
});

test('output may not add an authorized but unselected file', async (t) => {
  const workspace = await fixture(t);
  await addHelperFile(workspace, 'other.txt', 'before\n');
  const h = harness(workspace, { proposal: { ...proposal, files: ['other.txt'], patch: patch.replaceAll('example.txt', 'other.txt') } });
  assert.equal((await h.invoke()).data.code, 'DETERMINISTIC_MODEL_INVALID');
  assert.ok(!h.calls.some((args) => args[0] === 'apply'));
});

test('final audit invalidates prior success and prior model failure', async (t) => {
  for (const failing of [false, true]) {
    const workspace = await fixture(t);
    const h = harness(workspace, { statusOutput: (call) => call === (failing ? 5 : 6) ? '?? PRIVATE_DIRTY\n' : '',
      ...(failing ? { generateProposal: async () => { throw { code: 'OLLAMA_BAD_RESPONSE' }; } } : {}) });
    assert.equal((await h.invoke()).data.code, 'WORKSPACE_NOT_SAFE');
  }
});

test('proposal lock prevents concurrent phases and releases after completion', async (t) => {
  let entered;
  let release;
  const started = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  const h = harness(await fixture(t), { generateProposal: async () => {
    entered(); await held; return structuredClone(contentProposal);
  } });
  const first = h.invoke();
  await started;
  assert.equal((await h.invoke()).data.code, 'BUSY');
  release();
  assert.equal((await first).status, 200);
  assert.equal((await h.invoke()).status, 200);
});

test('external publicCode/status/message never bypass allowlisted mapping', async (t) => {
  const h = harness(await fixture(t), { generateProposal: async () => {
    throw { publicCode: 'PRIVATE_CODE', status: 502, message: privateMarker };
  } });
  const r = await h.invoke();
  assert.equal(r.data.code, 'FAILED');
  assert.ok(!JSON.stringify(r.data).includes('PRIVATE'));
});

test('mount failure in finalization still attempts Git audit and rejects success', async (t) => {
  const h = harness(await fixture(t), { workspaceStatus: (call) => {
    if (call === 6) throw new Error(privateMarker);
    return {};
  } });
  assert.equal((await h.invoke()).data.code, 'WORKSPACE_NOT_SAFE');
  assert.equal(h.calls.at(-1).join(' '), 'rev-parse HEAD');
});

test('normal phase 1 checkpoint occurs before reading selected files', async (t) => {
  const h = harness(await fixture(t));
  assert.equal((await h.invoke()).status, 200);
  const selection = h.events.indexOf('selection');
  const generation = h.events.indexOf('generation');
  const between = h.events.slice(selection + 1, generation);
  assert.ok(between.indexOf('status') < between.indexOf('ls-files'));
  assert.equal(between.filter((event) => event === 'status').length, 2);
});

test('native phases use deadline wrappers and only mocked HTTP, without tools', async (t) => {
  let requests = 0;
  let selectedContent = 'before\n';
  let generatedProposal = contentProposal;
  const signals = [];
  t.mock.method(globalThis, 'fetch', async (url, settings) => {
    requests++;
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    signals.push(settings.signal);
    const body = JSON.parse(settings.body);
    assert.equal(body.model, 'qwen3:8b');
    assert.equal(body.stream, false);
    assert.equal(Object.hasOwn(body, 'tools'), false);
    const user = JSON.parse(body.messages[1].content);
    if (requests === 1) {
      assert.deepEqual(Object.keys(user).sort(), ['catalog', 'request']);
      assert.ok(!settings.body.includes('before\\n'));
    } else {
      assert.deepEqual(user.files, [{ path: 'example.txt', content: selectedContent }]);
    }
    return new Response(JSON.stringify({ model: 'qwen3:8b', done: true,
      message: { role: 'assistant', content: JSON.stringify(requests === 1 ? { files: ['example.txt'] } : generatedProposal) } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  for (const content of ['before\n', 'before']) {
    selectedContent = content;
    requests = 0;
    generatedProposal = contentProposal;
    const workspace = await fixture(t);
    await addHelperFile(workspace, 'example.txt', content);
    const r = await harness(workspace, { nativePhases: true }).invoke();
    assert.equal(r.status, 200);
    assert.equal(requests, 2);
  }
  assert.ok(signals.every((signal) => signal.aborted));
});

test('mount-only status skips CLI; default status for other endpoints still checks CLI', async () => {
  const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function getOpenCodeStatus(');
  const end = source.indexOf('\nconst snapshotFileLimit', start);
  const calls = [];
  const getStatus = runInNewContext(`(${source.slice(start, end).trim()})`, {
    queryOpenCode: async (args) => {
      calls.push(args);
      return args[0] === 'inspect' ? 'true\n[{"Destination":"/workspace","Source":"/test-root"}]' : '1.17.18';
    },
  });
  const mount = await getStatus({ checkCLI: false });
  assert.equal(mount.workspace, '/test-root');
  assert.equal(mount.cliAvailable, false);
  assert.equal(calls.length, 1);
  const normal = await getStatus();
  assert.equal(normal.cliAvailable, true);
  assert.equal(normal.version, '1.17.18');
  assert.equal(calls.length, 3);
  assert.equal(calls[2][0], 'exec');
});

test('timeout during target_files_validation stays TIMEOUT and still audits without checking patch', async (t) => {
  let reads = 0;
  const h = harness(await fixture(t), { readCheck: () => {
    reads++;
    // Initial selected read, snapshot re-read, then final target validation.
    if (reads === 3) throw Object.assign(new Error(privateMarker), {
      code: 'FILE_OPERATION_TIMEOUT', path: privateMarker, stdout: privateMarker, stderr: privateMarker,
    });
  } });
  const response = await h.invoke({ request: privateMarker });
  assert.equal(reads, 3);
  assert.equal(response.status, 504);
  assert.equal(response.data.code, 'TIMEOUT');
  assert.equal(response.data.stage, 'target_files_validation');
  assert.equal(response.data.timeoutSource, 'endpoint');
  assert.equal(response.data.error, 'La propuesta excedió el tiempo máximo.');
  assert.ok(!h.calls.some((args) => args[0] === 'apply'));
  assert.equal(h.calls.filter((args) => args[0] === 'status').length, 6);
  assert.equal(h.calls.at(-1).join(' '), 'rev-parse HEAD');
  assert.ok(!JSON.stringify(response.data).includes(privateMarker));
  assert.ok(!/stdout|stderr|path|stack/.test(JSON.stringify(response.data)));
});

const noNewlineMarker = '\\ No newline at end of file';
const markerDiff = (body, header = '@@ -1 +1 @@') => ({
  summary: 'Actualizar texto.', files: ['README.md'],
  patch: `diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n${header}\n${body}\n`,
});

for (const [name, value] of [
  ['removed line', markerDiff(`-old\n${noNewlineMarker}\n+new`)],
  ['both removed and added lines', markerDiff(`-old\n${noNewlineMarker}\n+new\n${noNewlineMarker}`)],
  ['context line', markerDiff(`-old\n+new\n context\n${noNewlineMarker}`, '@@ -1,2 +1,2 @@')],
]) {
  test(`exact newline marker accepted after ${name} without counting as body`, () => {
    // Default strict mode validates counts; including the marker would fail.
    assert.doesNotThrow(() => validatePatchStructure(value));
  });
}

for (const [name, value, reason] of [
  ['first hunk line', markerDiff(`${noNewlineMarker}\n-old\n+new`), 'invalid_hunk_body'],
  ['consecutive markers', markerDiff(`-old\n${noNewlineMarker}\n${noNewlineMarker}\n+new`), 'invalid_hunk_body'],
  ['trailing space', markerDiff(`-old\n${noNewlineMarker} \n+new`), 'invalid_hunk_body'],
  ['lowercase variant', markerDiff('-old\n\\ no newline at end of file\n+new'), 'invalid_hunk_body'],
  ['arbitrary backslash', markerDiff('-old\n\\ PRIVATE_ARBITRARY\n+new'), 'invalid_hunk_body'],
  ['outside hunk', { ...markerDiff('-old\n+new'), patch: `${noNewlineMarker}\n${markerDiff('-old\n+new').patch}` }, 'unexpected_diff_header'],
  ['between headers and hunk', { ...markerDiff('-old\n+new'), patch: markerDiff('-old\n+new').patch.replace('@@ -1', `${noNewlineMarker}\n@@ -1`) }, 'invalid_hunk_header'],
  ['incorrect counts', markerDiff(`-old\n${noNewlineMarker}\n+new`, '@@ -1,2 +1 @@'), 'invalid_hunk_counts'],
]) {
  test(`newline marker rejects ${name} under strict grammar`, () => {
    assert.throws(() => validatePatchStructure(value), (error) => {
      assert.equal(error.publicCode, 'INVALID_PATCH_STRUCTURE');
      assert.equal(error.patchStructureReason, reason);
      assert.ok(!error.message.includes('PRIVATE_ARBITRARY'));
      return true;
    });
  });
}

for (const resultHasNewline of [true, false]) {
  test(`real Git check accepts no-newline original; result newline=${resultHasNewline}; fixture stays intact`, async (t) => {
    const workspace = await fixture(t);
    const original = Buffer.from('FUNCIONAAA X2', 'utf8');
    await addHelperFile(workspace, 'README.md', original);
    const originalIndex = await readFile(`${workspace}/.git/index`);
    const value = markerDiff(`-FUNCIONAAA X2\n${noNewlineMarker}\n+LAB-IA funcionando correctamente.`
      + (resultHasNewline ? '' : `\n${noNewlineMarker}`));
    assert.doesNotThrow(() => validatePatchStructure(value));
    let checks = 0;
    const h = harness(workspace, { selection: ['README.md'], realDiff: true,
      phase2: { summary: value.summary, files: [{ path: 'README.md',
        content: 'LAB-IA funcionando correctamente.' + (resultHasNewline ? '\n' : '') }] }, checkInput: (input) => {
      checks++;
      assert.equal(input, value.patch);
    } });
    const response = await h.invoke();
    assert.equal(response.status, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.proposal.patch, value.patch);
    assert.equal(checks, 1);
    assert.deepEqual(h.calls.filter((args) => args[0] === 'apply'), [
      ['apply', '--check', '--recount', '--index', '--whitespace=error', '-'],
    ]);
    const after = await readFile(`${workspace}/README.md`);
    assert.deepEqual(after, original);
    assert.equal(createHash('sha256').update(after).digest('hex'),
      '0bf0e59f51c458b7d44f5d03d880f8f1775a70a068d264089c194ead7cb8ddd4');
    assert.deepEqual(await readFile(`${workspace}/.git/index`), originalIndex);
  });
}
