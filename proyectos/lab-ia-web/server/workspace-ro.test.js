import process from 'node:process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProposalGit } from './change-proposal.js';
import { runApplyGit } from './apply-change-proposal.js';

const run = promisify(execFile);
const compose = await readFile(new URL('../../../docker/docker-compose.yml', import.meta.url), 'utf8');
const opencodeConfig = JSON.parse(await readFile(new URL('../../../docker/opencode.json', import.meta.url), 'utf8'));
const launcher = await readFile(new URL('../../../scripts/lab-open', import.meta.url), 'utf8');

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'lab-workspace-ro-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'LAB-IA');
  const home = join(base, 'home');
  const workspace = join(base, 'selected project');
  for (const path of [join(root, 'scripts'), join(root, 'docker'), home, workspace]) await mkdir(path, { recursive: true });
  const file = join(root, 'docker/docker-compose.yml');
  await writeFile(file, compose);
  const script = join(root, 'scripts/lab-open');
  await writeFile(script, launcher);
  const env = { ...process.env, HOME: home };
  delete env.LAB_WORKSPACE;
  delete env.LAB_RUNTIME_DIR;
  delete env.XDG_STATE_HOME;
  return { base, root, home, workspace, file, script, env };
}

test('Compose resolves phase 5A offline preparation and unchanged hardening, mounts and network', async t => {
  const f = await fixture(t);
  for (const selected of [undefined, f.workspace]) {
    const env = { ...f.env, ...(selected ? { LAB_WORKSPACE: selected } : {}) };
    // config is an offline parser: never starts/inspects/executes a container.
    const { stdout } = await run('docker', ['compose', '-f', f.file, 'config', '--format', 'json'], { env });
    const service = JSON.parse(stdout).services.opencode;
    assert.equal(service.user, '1000:1000');
    assert.equal(service.working_dir, '/workspace');
    assert.equal(service.image, 'ghcr.io/anomalyco/opencode@sha256:bf9d0e84b7cedef436a8f57db4d48767cd5d8fc6604f666335c1cc916b199a97');
    assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.equal(Object.hasOwn(service, 'cap_add'), false);
    assert.equal(service.read_only, true);
    // Exact list excludes /run, /var/tmp, noexec and any additional tmpfs.
    assert.deepEqual(service.tmpfs, ['/tmp:rw,nosuid,nodev,exec,size=256m,mode=1777']);
    assert.equal(service.init, true);
    assert.equal(service.pids_limit, 256);
    assert.equal(service.stop_grace_period, '30s');
    for (const option of ['network_mode', 'ports', 'dns', 'dns_search', 'dns_opt', 'pid', 'deploy']) {
      assert.equal(Object.hasOwn(service, option), false);
    }
    assert.deepEqual(service.environment, {
      HOME: '/home/adolf',
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
      OPENCODE_DISABLE_MODELS_FETCH: 'true',
      OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
    });
    assert.deepEqual(service.extra_hosts, ['host.docker.internal=host-gateway']);
    assert.deepEqual(service.networks, { default: null });
    assert.equal(service.volumes.length, 4);
    const mounts = Object.fromEntries(service.volumes.map(m => [m.target, m]));
    assert.equal(mounts['/workspace'].source, selected ?? f.root);
    assert.equal(mounts['/workspace'].read_only, true);
    assert.equal(mounts['/home/adolf'].source, join(f.home, '.local/share/lab-ia-opencode/home'));
    assert.equal(Boolean(mounts['/home/adolf'].read_only), false);
    assert.equal(mounts['/home/adolf/.config/opencode/agents'].read_only, true);
    assert.equal(mounts['/home/adolf/.config/opencode/opencode.json'].read_only, true);
    assert.ok(service.volumes.every(m => !m.source.includes('/runtime') && !m.source.includes('/.local/state/lab-ia')));
    assert.ok(!JSON.stringify(service).includes('/workspace/runtime'));
    await assert.rejects(access(join(f.root, 'runtime')));
    await assert.rejects(access(join(f.home, '.local')));
  }
});

test('OpenCode config disables updates and sharing while selecting only the unchanged local Ollama provider', () => {
  assert.equal(opencodeConfig.$schema, 'https://opencode.ai/config.json');
  assert.equal(opencodeConfig.autoupdate, false);
  assert.equal(opencodeConfig.share, 'disabled');
  assert.deepEqual(opencodeConfig.enabled_providers, ['ollama']);
  assert.equal(opencodeConfig.model, 'ollama/qwen3:8b');
  assert.deepEqual(opencodeConfig.provider, {
    ollama: {
      npm: '@ai-sdk/openai-compatible',
      name: 'Ollama local',
      options: { baseURL: 'http://host.docker.internal:11434/v1' },
      models: { 'qwen3:8b': { name: 'Qwen3 8B local' } },
    },
  });
  // Keep optional integrations absent; do not enable installers or remote tools.
  for (const option of ['plugin', 'mcp', 'lsp', 'formatter', 'instructions', 'skills', 'experimental']) {
    assert.equal(Object.hasOwn(opencodeConfig, option), false);
  }
});

test('full launcher verifies Docker RO metadata before listing or publishing history', async t => {
  for (const value of ['false', 'true', '', 'falsefalse', 'unknown']) {
    await t.test(`inspect RW=${JSON.stringify(value)}`, async t => {
      const f = await fixture(t);
      const bin = join(f.base, 'bin');
      const log = join(f.base, 'docker.jsonl');
      await mkdir(bin);
      // Every docker call is intercepted; this fixture never calls real Docker.
      await writeFile(join(bin, 'docker'), `#!/usr/bin/env node
import process from 'node:process';
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, workspace: process.env.LAB_WORKSPACE }) + '\\n');
if (args[0] === 'inspect') {
  const format = args[2];
  if (format.includes('.RW')) console.log(process.env.FAKE_RW);
  else if (format.includes('.Source')) console.log(process.env.FAKE_PROJECT);
  else if (format.includes('.State.Status')) console.log('running');
  else process.exit(90);
} else if (args[0] === 'compose') {
  if (args[1] === 'ps') console.log('fixture-container');
  else if (!['version', 'up', 'exec'].includes(args[1])) process.exit(91);
} else process.exit(92);
`, { mode: 0o700 });
      const env = { ...f.env, PATH: `${bin}:${f.env.PATH}`, FAKE_LOG: log, FAKE_RW: value, FAKE_PROJECT: f.workspace };
      const runtime = join(f.home, '.local/state/lab-ia');
      const history = join(runtime, 'recent-workspaces');
      if (value !== 'false') {
        await mkdir(runtime, { recursive: true });
        await writeFile(history, 'previous fixture history\n');
        await assert.rejects(run('bash', [f.script, f.workspace], { env }), error => {
          assert.match(error.stderr, /debe ser de solo lectura/);
          return true;
        });
        assert.equal(await readFile(history, 'utf8'), 'previous fixture history\n');
      } else {
        await run('bash', [f.script, f.workspace], { env });
        assert.equal(await readFile(history, 'utf8'), `${f.workspace}\n`);
        assert.equal((await stat(runtime)).mode & 0o777, 0o700);
        assert.equal((await stat(history)).mode & 0o777, 0o600);
      }
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      const up = calls.find(c => c.args[0] === 'compose' && c.args[1] === 'up');
      assert.deepEqual(up.args, ['compose', 'up', '-d', '--force-recreate', 'opencode']);
      assert.equal(up.workspace, f.workspace);
      assert.ok(calls.some(c => c.args[0] === 'inspect' && c.args[2].includes('.RW')));
      assert.equal(calls.some(c => c.args[0] === 'compose' && c.args[1] === 'exec'), value === 'false');
      await assert.rejects(access(join(f.root, 'runtime')));
    });
  }
});


test('Proposal and Apply Git checks use host workspace without a Docker write capability', async t => {
  const f = await fixture(t);
  const bin = join(f.base, 'bin');
  await mkdir(bin);
  const called = join(f.base, 'unexpected-docker');
  // Refuse any Docker invocation, including inspection or exec.
  await writeFile(join(bin, 'docker'), '#!/bin/sh\nprintf called > "$DOCKER_CALLED"\nexit 99\n', { mode: 0o700 });
  const env = { ...f.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  await run('git', ['-c', 'core.hooksPath=/dev/null', 'init', '-q', f.workspace], { env });
  const file = join(f.workspace, 'README.md');
  await writeFile(file, 'before\n');
  await run('git', ['-C', f.workspace, '-c', 'core.hooksPath=/dev/null', 'add', 'README.md'], { env });
  const index = await readFile(join(f.workspace, '.git/index'));
  const originalPath = process.env.PATH;
  const originalMarker = process.env.DOCKER_CALLED;
  process.env.PATH = `${bin}:${originalPath}`;
  process.env.DOCKER_CALLED = called;
  try {
    assert.equal((await runProposalGit(f.workspace, ['rev-parse', '--show-toplevel'])).trim(), f.workspace);
    const patch = 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-before\n+after\n';
    await runApplyGit(f.workspace, ['apply', '--check', '--recount', '--index', '--whitespace=error', '-'], { input: patch });
  } finally {
    process.env.PATH = originalPath;
    if (originalMarker === undefined) delete process.env.DOCKER_CALLED;
    else process.env.DOCKER_CALLED = originalMarker;
  }
  assert.equal(await readFile(file, 'utf8'), 'before\n');
  assert.deepEqual(await readFile(join(f.workspace, '.git/index')), index);
  await assert.rejects(access(called));
});
