import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function loadAgentInstructions(agentsDir, id) {
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
    || await realpath(agentsDir) !== agentsDir) throw new Error('Invalid agent');
  let file;
  try {
    file = await open(resolve(agentsDir, `${id}.md`), constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > 128 * 1024) throw new Error('Invalid agent');
    const content = await file.readFile('utf8');
    if (!content.trim() || Buffer.byteLength(content) > 128 * 1024) throw new Error('Invalid agent');
    return content;
  } finally { await file?.close(); }
}
