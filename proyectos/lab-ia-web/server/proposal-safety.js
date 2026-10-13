import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openTrackedRegularFile } from './change-proposal.js';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ensure = (condition) => { if (!condition) throw new Error('Unsafe repository.'); };
export async function repositoryIdentity(workspace, git, deadline) {
  ensure(await realpath(workspace) === workspace);
  const repoRoot = await realpath((await git(workspace, ['rev-parse', '--show-toplevel'], { deadline })).trim());
  ensure(repoRoot === workspace);
  const gitDir = await realpath((await git(workspace, ['rev-parse', '--absolute-git-dir'], { deadline })).trim());
  const commonDir = await realpath(resolve(workspace, (await git(workspace, ['rev-parse', '--git-common-dir'], { deadline })).trim()));
  const commonStat = await stat(commonDir);
  const rootStat = await stat(repoRoot); const gitStat = await stat(gitDir);
  return { repoRoot, gitDir, commonDir, commonDevice: commonStat.dev, commonInode: commonStat.ino, rootDevice: rootStat.dev, rootInode: rootStat.ino,
    gitDevice: gitStat.dev, gitInode: gitStat.ino };
}
async function readBounded(file, limit) {
  const chunks = []; let offset = 0;
  while (true) {
    const buffer = Buffer.alloc(Math.min(4096, limit + 1 - offset));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    if (!bytesRead) break;
    offset += bytesRead; ensure(offset <= limit);
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, offset);
}
export async function indexSnapshot(identity) {
  const path = resolve(identity.gitDir, 'index');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    ensure(metadata.isFile() && metadata.size <= 16 * 1024 * 1024);
    const bytes = await readBounded(file, 16 * 1024 * 1024);
    return bytes;
  } finally { await file.close(); }
}
export async function trackedModes(workspace, paths, git, deadline) {
  const output = await git(workspace, ['ls-files', '--stage', '-z', '--', ...paths], { deadline });
  ensure(output.endsWith('\0'));
  const modes = {};
  for (const line of output.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) [a-f0-9]+ 0\t(.+)$/.exec(line);
    ensure(match && paths.includes(match[2]) && !Object.hasOwn(modes, match[2]));
    modes[match[2]] = match[1];
  }
  ensure(Object.keys(modes).length === paths.length);
  return modes;
}
export async function fileFingerprints(workspace, paths, modes, deadline) {
  const fingerprints = {}; const permissions = {};
  for (const path of paths) {
    const file = await openTrackedRegularFile(workspace, path, modes[path], deadline);
    try {
      const metadata = await file.stat();
      ensure(metadata.size <= 64 * 1024);
      const bytes = await readBounded(file, 64 * 1024);
      fingerprints[path] = sha256(bytes); permissions[path] = metadata.mode & 0o7777;
      ensure(Boolean(metadata.mode & 0o111) === (modes[path] === '100755'));
    } finally { await file.close(); }
  }
  return { fingerprints, permissions };
}
export async function validateConfiguration(workspace, paths, git, deadline) {
  const run = (args) => git(workspace, args, { deadline });
  // Force split detection even if config was disabled after creating the index.
  const shared = (await run(['-c', 'core.splitIndex=true', 'rev-parse', '--shared-index-path'])).trim();
  ensure(!shared || /(?:^|\/)sharedindex\.0{40}(?:0{24})?$/.test(shared));
  const config = await run(['config', '--null', '--list']);
  for (const item of config.split('\0').filter(Boolean)) {
    const [key, value = ''] = item.split('\n');
    const name = key.toLowerCase();
    if (['core.splitindex', 'index.sparse', 'core.sparsecheckout', 'core.sparsecheckoutcone',
      'core.autocrlf', 'core.safecrlf'].includes(name)) ensure(['false', '0', 'no', 'off'].includes(value.toLowerCase()));
    ensure(!name.startsWith('filter.') && !['core.eol', 'core.attributesfile', 'extensions.worktreeconfig'].includes(name));
  }
  const sparse = await run(['ls-files', '--sparse', '--stage', '-z']);
  ensure(!sparse.split('\0').some((line) => line.startsWith('040000 ')));
  const flags = await run(['ls-files', '-v', '-z']);
  ensure(!flags.split('\0').filter(Boolean).some((line) => /^[a-zS]/.test(line)));
  const attrs = (await run(['check-attr', '-z', 'filter', 'working-tree-encoding', 'text', 'eol', 'ident', '--', ...paths])).split('\0');
  ensure(attrs.at(-1) === '');
  for (let i = 0; i < attrs.length - 1; i += 3) ensure(['unspecified', 'unset'].includes(attrs[i + 2]));
}
export async function noUntracked(workspace, git, deadline) {
  // Without exclusion flags, this also sees ignored untracked files.
  ensure(await git(workspace, ['ls-files', '--others', '-z'], { deadline }) === '');
}
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
