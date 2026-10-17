import process from 'node:process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRuntimePaths } from './runtime-paths.js';

const run = promisify(execFile);
const launcher = await readFile(new URL('../../../scripts/lab-open', import.meta.url), 'utf8');

test('runtime resolver and launcher share policy without side effects', async t => {
  const base = await mkdtemp(join(tmpdir(), 'lab-runtime-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const labRoot = join(base, 'LAB-IA');
  await mkdir(join(labRoot, 'scripts'), { recursive: true });
  const script = join(labRoot, 'scripts/lab-open');
  // Actual launcher validation only: never reach Docker or real history.
  await writeFile(script, launcher.slice(0, launcher.indexOf('if [[ $# -eq 1 ]]; then'))
    + 'printf "%s\\n%s\\n" "$runtime_source" "$runtime_dir"\n');
  const cleanEnv = { ...process.env };
  delete cleanEnv.LAB_RUNTIME_DIR;
  const external = join(base, 'private', 'missing');
  const link = join(base, 'alias');
  await symlink(labRoot, link);
  const outsideLink = join(base, 'outside-alias');
  await symlink(join(base, 'private'), outsideLink);
  await symlink(join(base, 'loop'), join(base, 'loop'));
  const file = join(base, 'file');
  await writeFile(file, 'fixture');
  const cases = [
    ['unset', undefined, join(labRoot, 'runtime'), 'legacy'],
    ['existing external', base, base, 'external'],
    ['symlink loop', join(base, 'loop')],
    ['external missing parents', external, external, 'external'],
    ['normalized', `${base}/other/../private/missing`, external, 'external'],
    ['outside dangling symlink', join(outsideLink, 'missing'), external, 'external'],
    ['prefix sibling', `${labRoot}-state`, `${labRoot}-state`, 'external'],
    ['empty', ''], ['relative', 'runtime'], ['dot relative', './runtime'],
    ['parent relative', '../runtime'], ['root', labRoot], ['child', join(labRoot, 'runtime')],
    ['nested child', join(labRoot, 'a/b')], ['symlink into repo', join(link, 'missing')],
    ['symlink then parent', `${outsideLink}/../LAB-IA/new`],
    ['file', file], ['file parent', join(file, 'child')], ['control', `${base}/bad\npath`],
  ];
  for (const [name, value, expected, source] of cases) {
    await t.test(name, async () => {
      const env = value === undefined ? cleanEnv : { ...cleanEnv, LAB_RUNTIME_DIR: value };
      if (!expected) {
        await assert.rejects(resolveRuntimePaths({ labRoot, env }), /LAB_RUNTIME_DIR/);
        await assert.rejects(run('bash', [script], { env }));
      } else {
        const result = await resolveRuntimePaths({ labRoot, env });
        assert.deepEqual(result, { source, runtimeDir: expected,
          databasePath: join(expected, 'lab-ia.db'), recentWorkspacesPath: join(expected, 'recent-workspaces') });
        const { stdout } = await run('bash', [script], { env });
        assert.equal(stdout, `${source}\n${expected}\n`);
      }
      await assert.rejects(access(external));
      await assert.rejects(access(join(labRoot, 'runtime')));
    });
  }
});

test('launcher history uses private permissions and atomic replacement in fixtures', async t => {
  const base = await mkdtemp(join(tmpdir(), 'lab-history-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const runtime = join(base, 'new-state');
  const workspace = join(base, 'project with spaces');
  await mkdir(workspace);
  const body = launcher.slice(launcher.indexOf('(umask 077; mkdir -p'));
  const script = join(base, 'history.sh');
  await writeFile(script, 'set -euo pipefail\nruntime_dir=$1\nworkspace=$2\nhistory_file="$runtime_dir/recent-workspaces"\n' + body);
  await run('bash', [script, runtime, workspace]);
  const history = join(runtime, 'recent-workspaces');
  assert.equal((await stat(runtime)).mode & 0o777, 0o700);
  assert.equal((await stat(history)).mode & 0o777, 0o600);
  assert.equal(await readFile(history, 'utf8'), `${workspace}\n`);
  const previous = join(base, 'previous');
  await writeFile(history, `${previous}\n${workspace}\n`);
  await run('bash', [script, runtime, workspace]);
  assert.equal(await readFile(history, 'utf8'), `${workspace}\n${previous}\n`);
  assert.equal((await stat(history)).mode & 0o777, 0o600);
});


test('unset runtime preserves installation paths without opening SQLite', async () => {
  const labRoot = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
  const paths = await resolveRuntimePaths({ labRoot, env: {} });
  assert.equal(paths.source, 'legacy');
  assert.equal(paths.databasePath, join(labRoot, 'runtime/lab-ia.db'));
  assert.equal(paths.recentWorkspacesPath, join(labRoot, 'runtime/recent-workspaces'));
});
