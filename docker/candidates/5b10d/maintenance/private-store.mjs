// No default production path. Only a dedicated, explicitly supplied private directory.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { failure } from './barrier.mjs';

export function assertPrivateDirectory(directory) {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory
    || fs.realpathSync(directory) !== directory) throw failure('UNSAFE_DIRECTORY');
  const s = fs.lstatSync(directory);
  if (!s.isDirectory() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o700) throw failure('UNSAFE_DIRECTORY');
}
function privateFile(file) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid()
    || (s.mode & 0o777) !== 0o600 || s.size > 65536) throw failure('UNSAFE_STATE');
}
export function openPrivateStore(directory) {
  assertPrivateDirectory(directory);
  const state = path.join(directory, 'state.json');
  const lock = path.join(directory, 'owner.lock');
  const lockFD = fs.openSync(lock, 'wx', 0o600); // Never automatically remove a stale/live owner lock.
  fs.writeFileSync(lockFD, String(process.pid)); fs.fsyncSync(lockFD);
  let closed = false;
  const ownLock = fs.fstatSync(lockFD);
  const check = () => {
    if (closed) throw failure('STORE_CLOSED');
    assertPrivateDirectory(directory);
    const current = fs.lstatSync(lock);
    if (current.ino !== ownLock.ino || current.dev !== ownLock.dev) throw failure('OWNER_CHANGED');
  };
  return Object.freeze({
    load() {
      check();
      try { privateFile(state); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      return JSON.parse(fs.readFileSync(state, 'utf8'));
    },
    save(value) {
      check();
      try { privateFile(state); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const temporary = path.join(directory, `.state-${randomUUID()}`);
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try {
        const data = JSON.stringify(value) + '\n';
        if (Buffer.byteLength(data) > 65536) throw failure('STATE_TOO_LARGE');
        fs.writeFileSync(fd, data); fs.fsyncSync(fd);
        fs.renameSync(temporary, state);
        const dirFD = fs.openSync(directory, 'r');
        try { fs.fsyncSync(dirFD); } finally { fs.closeSync(dirFD); }
      } finally {
        fs.closeSync(fd);
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    },
    close() {
      if (closed) return;
      try { check(); fs.unlinkSync(lock); }
      finally { closed = true; fs.closeSync(lockFD); }
    },
  });
}
