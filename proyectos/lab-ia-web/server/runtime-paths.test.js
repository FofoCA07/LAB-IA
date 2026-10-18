import process from 'node:process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRuntimePaths, requireRuntimeDatabase } from './runtime-paths.js';

const run = promisify(execFile);
const launcher = await readFile(new URL('../../../scripts/lab-open', import.meta.url), 'utf8');
const validation = launcher.slice(0, launcher.indexOf('if [[ $# -eq 1 ]]; then'));
const historyBody = launcher.slice(launcher.indexOf('(umask 077; mkdir -p'));

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'lab-runtime-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const labRoot = join(base, 'LAB-IA');
  const home = join(base, 'home');
  await mkdir(join(labRoot, 'scripts'), { recursive: true });
  await mkdir(home);
  const script = join(labRoot, 'scripts/lab-open');
  const env = { ...process.env, HOME: home };
  delete env.LAB_RUNTIME_DIR;
  delete env.XDG_STATE_HOME;
  return { base, labRoot, home, script, env };
}

test('backend and launcher share XDG/override policy without creating state', async t => {
  const { base, labRoot, home, script, env: cleanEnv } = await fixture(t);
  // Actual launcher validation only: never reach Docker or real history.
  await writeFile(script, validation + 'printf "%s\\n%s\\n" "$runtime_source" "$runtime_dir"\n');
  const external = join(base, 'private', 'missing');
  const link = join(base, 'alias');
  await symlink(labRoot, link);
  const outsideLink = join(base, 'outside-alias');
  await symlink(join(base, 'private'), outsideLink);
  await symlink(join(base, 'loop'), join(base, 'loop'));
  const file = join(base, 'file');
  await writeFile(file, 'fixture');
  const envPath = value => ({ LAB_RUNTIME_DIR: value });
  const cases = [
    ['HOME default', {}, join(home, '.local/state/lab-ia'), 'xdg-default'],
    ['absolute XDG', { XDG_STATE_HOME: join(base, 'state') }, join(base, 'state/lab-ia'), 'xdg-default'],
    ['empty XDG uses HOME', { XDG_STATE_HOME: '' }, join(home, '.local/state/lab-ia'), 'xdg-default'],
    ['override wins', { LAB_RUNTIME_DIR: external, XDG_STATE_HOME: 'invalid', HOME: '' }, external, 'env'],
    ['existing external', envPath(base), base, 'env'],
    ['symlink loop', envPath(join(base, 'loop'))],
    ['missing parents', envPath(external), external, 'env'],
    ['normalized', envPath(`${base}/other/../private/missing`), external, 'env'],
    ['outside dangling symlink', envPath(join(outsideLink, 'missing')), external, 'env'],
    ['prefix sibling', envPath(`${labRoot}-state`), `${labRoot}-state`, 'env'],
    ['empty override', envPath('')], ['relative override', envPath('runtime')],
    ['dot relative', envPath('./runtime')], ['parent relative', envPath('../runtime')],
    ['repo root', envPath(labRoot)], ['repo child', envPath(join(labRoot, 'runtime'))],
    ['nested child', envPath(join(labRoot, 'a/b'))], ['symlink into repo', envPath(join(link, 'missing'))],
    ['symlink then parent', envPath(`${outsideLink}/../LAB-IA/new`)],
    ['file', envPath(file)], ['file parent', envPath(join(file, 'child'))],
    ['control', envPath(`${base}/bad\npath`)],
    ['relative XDG', { XDG_STATE_HOME: 'relative' }],
    ['XDG inside repo', { XDG_STATE_HOME: labRoot }],
    ['XDG symlink into repo', { XDG_STATE_HOME: link }],
    ['HOME inside repo', { HOME: labRoot }],
    ['HOME missing', { HOME: join(base, 'missing-home') }],
    ['HOME relative', { HOME: 'relative' }], ['HOME empty', { HOME: '' }],
    ['HOME file', { HOME: file }],
    ['XDG does not excuse invalid HOME', { HOME: '', XDG_STATE_HOME: base }],
  ];
  for (const [name, overrides, expected, source] of cases) {
    await t.test(name, async () => {
      const env = { ...cleanEnv, ...overrides };
      if (!expected) {
        await assert.rejects(resolveRuntimePaths({ labRoot, env }), /runtime externo/);
        await assert.rejects(run('bash', [script], { env }));
      } else {
        const result = await resolveRuntimePaths({ labRoot, env });
        assert.deepEqual(result, { source, runtimeDir: expected,
          databasePath: join(expected, 'lab-ia.db'), recentWorkspacesPath: join(expected, 'recent-workspaces') });
        const { stdout } = await run('bash', [script], { env });
        assert.equal(stdout, `${source}\n${expected}\n`);
      }
      await assert.rejects(access(external));
      await assert.rejects(access(join(home, '.local')));
      await assert.rejects(access(join(labRoot, 'runtime')));
    });
  }
});

test('launcher writes default external history with 700/600 and atomic replacement', async t => {
  const { base, labRoot, script, env, home } = await fixture(t);
  const workspace = join(base, 'project with spaces');
  await mkdir(workspace);
  // Execute resolution and history writing only, with no Docker path.
  await writeFile(script, validation + '\nworkspace=$1\n' + historyBody);
  await run('bash', [script, workspace], { env });
  const runtime = join(home, '.local/state/lab-ia');
  const history = join(runtime, 'recent-workspaces');
  assert.equal((await stat(runtime)).mode & 0o777, 0o700);
  assert.equal((await stat(history)).mode & 0o777, 0o600);
  assert.equal(await readFile(history, 'utf8'), `${workspace}\n`);
  const previous = join(base, 'previous');
  await writeFile(history, `${previous}\n${workspace}\n`);
  await run('bash', [script, workspace], { env });
  assert.equal(await readFile(history, 'utf8'), `${workspace}\n${previous}\n`);
  assert.equal((await stat(history)).mode & 0o777, 0o600);
  await assert.rejects(access(join(labRoot, 'runtime')));
});

test('normal startup requires existing nonempty regular DB and never creates it', async t => {
  const { base } = await fixture(t);
  const databasePath = join(base, 'missing-state/lab-ia.db');
  await assert.rejects(requireRuntimeDatabase({ databasePath }), /estado externo/);
  await assert.rejects(access(join(base, 'missing-state')));
  await mkdir(join(base, 'missing-state'));
  await assert.rejects(requireRuntimeDatabase({ databasePath }), /estado externo/);
  await assert.rejects(access(databasePath));
  await writeFile(databasePath, '');
  await assert.rejects(requireRuntimeDatabase({ databasePath }), /estado externo/);
  await writeFile(databasePath, 'fixture bytes; not opened as SQLite');
  await requireRuntimeDatabase({ databasePath });
  const alias = join(base, 'db-alias');
  await symlink(databasePath, alias);
  await assert.rejects(requireRuntimeDatabase({ databasePath: alias }), /estado externo/);
  await assert.rejects(requireRuntimeDatabase({ databasePath: base }), /estado externo/);
  assert.equal(await readFile(databasePath, 'utf8'), 'fixture bytes; not opened as SQLite');
});
