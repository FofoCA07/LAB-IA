import { createInterface } from 'node:readline';

// Use cooked terminal input: no raw mode, keypress handling or signal handlers.
// Dependencies are explicit; importing this module never reads stdin or emits codes.
export function attachPairingTerminal({ securityStore, input, output }) {
  if (input?.isTTY !== true || output?.isTTY !== true) {
    return Object.freeze({ close() {} });
  }

  const lines = createInterface({ input, terminal: false, historySize: 0, crlfDelay: Infinity });
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    lines.removeListener('line', onLine);
    lines.removeListener('close', close);
    lines.removeListener('error', close);
    output.removeListener('error', close);
    lines.close();
  }
  function onLine(line) {
    if (closed || line.trim() !== 'pair') return;
    // Fail closed if either stream stops being an interactive delivery channel.
    if (input.isTTY !== true || output.isTTY !== true || output.destroyed || output.writableEnded) {
      close(); return;
    }
    try {
      const code = securityStore.createPairing();
      output.write(`LAB-IA — código de emparejamiento\n${code}\nExpira en 2 minutos y solo puede usarse una vez.\n`);
    } catch {
      // Never log exceptions: a stream/store failure may contain the code.
      // No retry/replay of an output that could have been partially written.
      close();
    }
  }
  lines.on('line', onLine);
  lines.on('close', close);
  lines.on('error', close);
  output.on('error', close);
  return Object.freeze({ close });
}
