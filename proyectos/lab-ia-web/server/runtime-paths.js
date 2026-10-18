import process from 'node:process';
import { execFile } from 'node:child_process';
import { realpath, stat, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const invalid = () => new Error('Configuración del runtime externo no válida.');
const absolute = value => typeof value === 'string' && isAbsolute(value)
  && ![...value].some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127);

// GNU realpath -m matches lab-open, including symlinks and missing parents.
// Resolution never creates directories or opens a database.
export async function resolveRuntimePaths({ labRoot, env = process.env }) {
  const root = await realpath(labRoot);
  const override = Object.hasOwn(env, 'LAB_RUNTIME_DIR');
  let value;
  try {
    if (override) {
      value = env.LAB_RUNTIME_DIR;
    } else {
      if (!absolute(env.HOME) || !(await stat(env.HOME)).isDirectory()) throw invalid();
      const stateHome = env.XDG_STATE_HOME;
      if (stateHome !== undefined && stateHome !== '' && !absolute(stateHome)) throw invalid();
      value = `${stateHome || `${env.HOME}/.local/state`}/lab-ia`;
    }
    if (!absolute(value)) throw invalid();
    const { stdout } = await run('realpath', ['-m', '--', value], { maxBuffer: 64 * 1024, timeout: 5000 });
    const runtimeDir = stdout.replace(/\n$/, '');
    if (!absolute(runtimeDir)) throw invalid();
    const child = relative(root, runtimeDir);
    if (!child || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))) throw invalid();
    // Reject files used as the directory or as an existing parent.
    let ancestor = runtimeDir;
    for (;;) {
      try {
        if (!(await stat(ancestor)).isDirectory()) throw invalid();
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        ancestor = dirname(ancestor);
      }
    }
    return { source: override ? 'env' : 'xdg-default', runtimeDir,
      databasePath: join(runtimeDir, 'lab-ia.db'),
      recentWorkspacesPath: join(runtimeDir, 'recent-workspaces') };
  } catch {
    throw invalid();
  }
}

// Normal startup requires migrated state. Never initialize a new database here.
export async function requireRuntimeDatabase({ databasePath }) {
  try {
    const info = await lstat(databasePath);
    if (!info.isFile() || info.size === 0) throw new Error();
  } catch {
    throw new Error('No se encontró una base de datos de LAB-IA válida; comprueba el estado externo antes de iniciar.');
  }
}
