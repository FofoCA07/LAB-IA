import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateDeterministicDiff, deterministicDiffLimits } from './deterministic-diff.js';
import { validProposalPath, validatePatchStructure } from './change-proposal.js';

const helper = fileURLToPath(new URL('./diff-pipe-helper.py', import.meta.url));
const marker = '\\ No newline at end of file';
const input = (originalContent = 'old\n', proposedContent = 'new\n') => ({
  path: 'src/example.txt', originalContent, proposedContent, deadline: Date.now() + 10_000,
});
const safe = (code) => (error) => {
  assert.deepEqual(Object.keys(error).sort(), ['code', 'error']);
  assert.equal(error.code, code);
  for (const privateText of ['PRIVATE', '/proc/self/fd/', 'Traceback', 'stderr', 'stdout']) {
    assert.ok(!JSON.stringify(error).includes(privateText));
  }
  return true;
};
const raw = 'diff --git a/proc/self/fd/3 b/proc/self/fd/5\nindex 1234567..abcdef0 100644\n--- a/proc/self/fd/3\n+++ b/proc/self/fd/5\n@@ -1 +1 @@\n-old\n+new\n';
function mockProcess(output = raw, code = 1, inspect = () => {}) {
  return { spawnImpl(command, args, options) {
    inspect(command, args, options);
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough();
    child.stdin.resume();
    child.stdin.on('finish', () => {
      child.stdout.write(output); child.stdout.end(); child.emit('close', code, null);
    });
    return child;
  } };
}

for (const [name, old, next, oldMarker, newMarker] of [
  ['both with newline', 'old\n', 'new\n', false, false],
  ['original without newline', 'old', 'new\n', true, false],
  ['proposed without newline', 'old\n', 'new', false, true],
  ['both without newline', 'old', 'new', true, true],
  ['exact confirmed case', 'FUNCIONAAA X2', 'LAB-IA funcionando correctamente.', true, true],
  ['CRLF', 'old\r\n', 'new\r\n', false, false],
  ['Unicode', 'á🙂\n', 'ñ🚀\n', false, false],
  ['BOM', '\uFEFFold\n', '\uFEFFnew\n', false, false],
]) {
  test(`real Git: ${name}`, async () => {
    const result = await generateDeterministicDiff(input(old, next));
    assert.equal(result.changed, true);
    const lines = result.patch.split('\n');
    const removed = '-' + old.replace(/\n$/, '');
    const added = '+' + next.replace(/\n$/, '');
    assert.ok(lines.includes(removed)); assert.ok(lines.includes(added));
    assert.equal(lines[lines.indexOf(removed) + 1] === marker, oldMarker);
    assert.equal(lines[lines.indexOf(added) + 1] === marker, newMarker);
    assert.equal(lines.filter((line) => line === marker).length, Number(oldMarker) + Number(newMarker));
    assert.ok(result.patch.startsWith('diff --git a/src/example.txt b/src/example.txt\n--- a/src/example.txt\n+++ b/src/example.txt\n'));
    assert.ok(!result.patch.includes('/proc/self/fd/'));
    assert.ok(!lines.some((line) => line.startsWith('index ')));
    assert.ok(result.patch.endsWith('\n'));
  });
}
for (const [name, old, next] of [['empty original', '', 'new\n'], ['empty proposed', 'old\n', '']]) {
  test(`real Git: ${name}`, async () => {
    const { patch, changed } = await generateDeterministicDiff(input(old, next));
    assert.equal(changed, true); assert.ok(patch.includes('@@ '));
    assert.ok(!patch.includes('/dev/null')); assert.ok(!patch.includes('file mode'));
    assert.ok(patch.includes(old ? '-old\n' : '+new\n'));
  });
}
for (const text of ['', 'same\n']) test(`real Git: identical ${JSON.stringify(text)}`, async () => {
  assert.deepEqual(await generateDeterministicDiff(input(text, text)), {
    changed: false, path: 'src/example.txt', patch: '',
  });
});
test('real Git: multiline context retained', async () => {
  const { patch } = await generateDeterministicDiff(input('one\ntwo\nthree\n', 'one\nchanged\nthree\n'));
  assert.ok(patch.includes(' one\n-two\n+changed\n three\n'));
});
test('16 KiB exact is accepted', async () => {
  assert.equal((await generateDeterministicDiff(input('a'.repeat(16 * 1024), 'b'))).changed, true);
});

for (const path of ['', '/absolute', '../PRIVATE', 'a/../b', 'a/./b', 'a//b', 'a\\b', 'a\nPRIVATE', 'C:PRIVATE',
  'a'.repeat(1025), 'a\u0085PRIVATE', '"PRIVATE"']) {
  test(`invalid path rejected before spawn: ${JSON.stringify(path)}`, async () => {
    await assert.rejects(generateDeterministicDiff({ ...input(), path }, {
      spawnImpl() { assert.fail('must not spawn'); },
    }), safe('DIFF_INPUT_INVALID'));
  });
}
test('injected authorization validator is respected', async () => {
  await assert.rejects(generateDeterministicDiff(input(), { validatePath: () => false,
    spawnImpl() { assert.fail('must not spawn'); } }), safe('DIFF_INPUT_INVALID'));
});
for (const [name, overrides] of [
  ['large original', { originalContent: 'a'.repeat(16385) }],
  ['large proposed', { proposedContent: 'b'.repeat(16385) }],
  ['NUL original', { originalContent: 'PRIVATE\0' }],
  ['NUL proposed', { proposedContent: 'PRIVATE\0' }],
  ['unpaired surrogate', { proposedContent: '\uD800' }],
  ['missing deadline', { deadline: undefined }],
  ['infinite deadline', { deadline: Infinity }],
]) test(name, async () => {
  await assert.rejects(generateDeterministicDiff({ ...input(), ...overrides }, {
    spawnImpl() { assert.fail('must not spawn'); },
  }), safe('DIFF_INPUT_INVALID'));
});
test('expired deadline does not spawn', async () => {
  await assert.rejects(generateDeterministicDiff({ ...input(), deadline: Date.now() - 1 }, {
    spawnImpl() { assert.fail('must not spawn'); },
  }), safe('DIFF_TIMEOUT'));
});
test('spawn contract and framing preserve exact UTF-8 bytes without content in argv/env', async () => {
  let captured;
  const old = '\uFEFFá\r\n'; const next = '🙂';
  const deps = mockProcess(raw, 1, (command, args, options) => {
    assert.equal(command, '/usr/bin/python3'); assert.deepEqual(args, ['-B', helper]);
    assert.equal(options.shell, false); assert.equal(options.detached, true); assert.equal(options.cwd, '/');
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'ignore']);
    assert.deepEqual(options.env, { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1' });
  });
  const original = deps.spawnImpl;
  deps.spawnImpl = (...args) => { const child = original(...args);
    child.stdin.on('data', (b) => { captured = b; }); return child; };
  await generateDeterministicDiff(input(old, next), deps);
  assert.equal(captured.readUInt32BE(0), Buffer.byteLength(old));
  assert.equal(captured.readUInt32BE(4), Buffer.byteLength(next));
  assert.deepEqual(captured.subarray(8), Buffer.from(old + next));
});
test('only headers change; index is removed and hunk/body bytes are untouched', async () => {
  const body = '@@ -1 +1 @@\n-old\r\n+new\r\n';
  const output = raw.slice(0, raw.indexOf('@@ ')) + body;
  const result = await generateDeterministicDiff(input(), mockProcess(output));
  assert.equal(result.patch, 'diff --git a/src/example.txt b/src/example.txt\n--- a/src/example.txt\n+++ b/src/example.txt\n' + body);
});
for (const forbidden of ['old mode 100644', 'new mode 100755', 'new file mode 100644',
  'deleted file mode 100644', 'similarity index 99%', 'rename from PRIVATE', 'copy from PRIVATE',
  'Binary files PRIVATE differ', 'GIT binary patch', 'index PRIVATE', 'unexpected PRIVATE']) {
  test(`reject preamble: ${forbidden}`, async () => {
    const output = raw.replace('index 1234567..abcdef0 100644', forbidden);
    await assert.rejects(generateDeterministicDiff(input(), mockProcess(output)), safe('DIFF_INVALID_OUTPUT'));
  });
}
for (const output of [raw.replace('+++ b/proc/self/fd/5', '+++ b/proc/self/fd/6'),
  raw.replace('@@ -1 +1 @@', '@@ PRIVATE @@'), raw.slice(0, -1), Buffer.from([0xff])]) {
  test('malformed output is safe', async () => {
    await assert.rejects(generateDeterministicDiff(input(), mockProcess(output)), safe('DIFF_INVALID_OUTPUT'));
  });
}
test('excess stdout is bounded', async () => {
  await assert.rejects(generateDeterministicDiff(input(), mockProcess(Buffer.alloc(deterministicDiffLimits.outputBytes + 1))),
    safe('DIFF_OUTPUT_TOO_LARGE'));
});
test('process failure strips private output', async () => {
  await assert.rejects(generateDeterministicDiff(input('PRIVATE OLD', 'PRIVATE NEW'), mockProcess('PRIVATE stderr traceback', 2)),
    safe('DIFF_PROCESS_FAILED'));
});
test('spawn exception strips private details', async () => {
  await assert.rejects(generateDeterministicDiff(input(), { spawnImpl() { throw new Error('PRIVATE stderr'); } }),
    safe('DIFF_PROCESS_FAILED'));
});
test('unexpected success with different input is rejected', async () => {
  await assert.rejects(generateDeterministicDiff(input(), mockProcess('', 0)), safe('DIFF_INVALID_OUTPUT'));
});
for (const [name, old, next, code, output] of [
  ['changed', 'old\n', 'new\n', 1, raw],
  ['identical', 'same\n', 'same\n', 0, ''],
  ['already failed', 'old\n', 'new\n', 2, ''],
]) test(`normal close (${name}) never signals the group`, async () => {
  const dependencies = mockProcess(output, code);
  const original = dependencies.spawnImpl;
  dependencies.spawnImpl = (...args) => { const child = original(...args); child.pid = 12345; return child; };
  dependencies.killGroup = () => assert.fail('no signal after close');
  if (code === 2) await assert.rejects(generateDeterministicDiff(input(old, next), dependencies), safe('DIFF_PROCESS_FAILED'));
  else assert.equal((await generateDeterministicDiff(input(old, next), dependencies)).changed, code === 1);
});
for (const path of ['docs/Guia de usuario.md', "docs/Guia del usuario's.md"]) {
  test(`authorized path survives grammar and real Git check: ${path}`, async () => {
    assert.equal(validProposalPath(path), true);
    const result = await generateDeterministicDiff({ ...input(), path }, { validatePath: validProposalPath });
    assert.ok(result.patch.startsWith(`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`));
    validatePatchStructure({ files: [path], patch: result.patch });
    // Only this independent Git-check fixture uses disk. The diff helper still has no temporary files.
    const root = await mkdtemp(join(tmpdir(), 'diff-path-check-'));
    const git = promisify(execFile);
    const env = { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const options = { cwd: root, env };
    try {
      await mkdir(join(root, 'docs'));
      await writeFile(join(root, path), 'old\n');
      await git('git', ['init', '--quiet'], options);
      await git('git', ['add', '--', path], options);
      const indexBefore = await readFile(join(root, '.git/index'));
      await new Promise((resolve, reject) => {
        const child = spawn('git', ['apply', '--check', '--recount', '--index', '--whitespace=error', '-'], {
          ...options, shell: false, stdio: ['pipe', 'ignore', 'ignore'],
        });
        child.on('error', reject); child.stdin.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error('Fixture check failed')));
        child.stdin.end(result.patch);
      });
      assert.equal(await readFile(join(root, path), 'utf8'), 'old\n');
      assert.deepEqual(await readFile(join(root, '.git/index')), indexBefore);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
test('colon and double quote remain rejected consistently with validProposalPath', async () => {
  for (const path of ['docs/a:b.md', 'docs/a"b.md']) {
    assert.equal(validProposalPath(path), false);
    await assert.rejects(generateDeterministicDiff({ ...input(), path }, {
      validatePath: validProposalPath, spawnImpl() { assert.fail('must not spawn'); },
    }), safe('DIFF_INPUT_INVALID'));
  }
});

async function runHelper(frame) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/python3', ['-B', helper], { cwd: '/', shell: false,
      stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (b) => { stdout += b; }); child.stderr.on('data', (b) => { stderr += b; });
    child.stdin.on('error', () => {}); child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr })); child.stdin.end(frame);
  });
}
for (const [name, frame] of [
  ['short header', Buffer.from([0, 1])],
  ['excess length', Buffer.from([0, 0, 64, 1, 0, 0, 0, 0])],
  ['truncated body', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0])],
  ['extra body', Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 65])],
  ['invalid UTF-8', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0, 255])],
  ['NUL', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0, 0])],
]) test(`helper framing: ${name}`, async () => {
  assert.deepEqual(await runHelper(frame), { code: 2, stdout: '', stderr: '' });
});

test('timeout kills isolated Python and its real Git child', async () => {
  let gitPid; let pythonPid; let killedGroup;
  const script = 'import subprocess,time,sys\np=subprocess.Popen(["git","hash-object","--stdin"],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\nprint(p.pid,flush=True)\ntime.sleep(30)';
  await assert.rejects(generateDeterministicDiff({ ...input('PRIVATE OLD', 'PRIVATE NEW'), deadline: Date.now() + 500 }, {
    spawnImpl(command, args, options) {
      const child = spawn(command, ['-B', '-c', script], options);
      pythonPid = child.pid;
      child.stdout.on('data', (b) => { gitPid = Number(b.toString().trim()); });
      return child;
    },
    killGroup(pid, signal) { killedGroup = pid; try { process.kill(-pid, signal); } catch {} },
  }), safe('DIFF_TIMEOUT'));
  assert.equal(killedGroup, pythonPid); assert.ok(Number.isInteger(gitPid));
  const terminated = async (pid) => {
    try { const status = await readFile(`/proc/${pid}/stat`, 'utf8');
      return status.slice(status.lastIndexOf(')') + 2).startsWith('Z');
    } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  };
  for (let attempts = 0; attempts < 50 && !(await terminated(gitPid)); attempts++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(await terminated(pythonPid)); assert.ok(await terminated(gitPid));
});
test('timeout escalates to SIGKILL when the isolated group ignores SIGTERM', async () => {
  const signals = [];
  const child = new EventEmitter();
  child.pid = 12345; child.stdin = new PassThrough(); child.stdin.resume(); child.stdout = new PassThrough();
  await assert.rejects(generateDeterministicDiff({ ...input(), deadline: Date.now() + 20 }, {
    spawnImpl: () => child,
    killGroup(pid, signal) {
      assert.equal(pid, child.pid); signals.push(signal);
      if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, signal));
    },
  }), safe('DIFF_TIMEOUT'));
  assert.equal(signals[0], 'SIGTERM'); assert.ok(signals.includes('SIGKILL'));
});
test('close after SIGTERM cancels escalation and never signals again', async () => {
  const signals = [];
  const child = new EventEmitter();
  child.pid = 12345; child.stdin = new PassThrough(); child.stdin.resume(); child.stdout = new PassThrough();
  await assert.rejects(generateDeterministicDiff({ ...input(), deadline: Date.now() + 20 }, {
    spawnImpl: () => child,
    killGroup(_pid, signal) { signals.push(signal); queueMicrotask(() => child.emit('close', null, 'SIGTERM')); },
  }), safe('DIFF_TIMEOUT'));
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.deepEqual(signals, ['SIGTERM']);
});
test('helper implementation uses anonymous pipes and has no temporary-file creation APIs', async () => {
  const source = await readFile(helper, 'utf8');
  assert.ok(source.includes('os.pipe()')); assert.ok(source.includes('close_fds=True'));
  assert.ok(source.includes('pass_fds=(old_read, new_read)'));
  assert.ok(source.includes('shell=False'));
  assert.ok(!/tempfile|mkdtemp|mkstemp|NamedTemporaryFile|os\.open\(|\bopen\(/.test(source));
});
