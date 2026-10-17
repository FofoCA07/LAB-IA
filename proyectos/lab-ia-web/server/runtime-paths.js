import process from 'node:process';
import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Linux/GNU realpath -m matches lab-open, including symlinks and missing parents.
// Resolving paths never creates directories or opens a database.
export async function resolveRuntimePaths({ labRoot, env = process.env }) {
  const root = await realpath(labRoot);
  const external = Object.hasOwn(env, 'LAB_RUNTIME_DIR');
  let runtimeDir = join(root, 'runtime');
  if (external) {
    const value = env.LAB_RUNTIME_DIR;
    if (typeof value !== 'string' || !isAbsolute(value) || [...value].some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127)) {
      throw new Error('LAB_RUNTIME_DIR debe ser una ruta absoluta externa válida.');
    }
    try {
      const { stdout } = await run('realpath', ['-m', '--', value], { maxBuffer: 64 * 1024 });
      runtimeDir = stdout.replace(/\n$/, '');
      const child = relative(root, runtimeDir);
      if (!child || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))) {
        throw new Error();
      }
      // Reject files used as the directory or as an existing parent.
      let ancestor = runtimeDir;
      for (;;) {
        try {
          if (!(await stat(ancestor)).isDirectory()) throw new Error();
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          ancestor = dirname(ancestor);
        }
      }
    } catch {
      throw new Error('LAB_RUNTIME_DIR debe ser una ruta absoluta externa válida.');
    }
  }
  // Transitional fallback only: remove after the real runtime migration.
  return { source: external ? 'external' : 'legacy', runtimeDir,
    databasePath: join(runtimeDir, 'lab-ia.db'),
    recentWorkspacesPath: join(runtimeDir, 'recent-workspaces') };
}
