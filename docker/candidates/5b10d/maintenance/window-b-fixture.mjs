// Test-only services copied to /tmp. No Docker/Ollama dependencies or real credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { createOperationalWindow } from './window-b.mjs';

const backendCode = `import http from 'node:http';
let closed=false;let sequence=0;const work=new Map();
const server=http.createServer((req,res)=>{
 if(req.url==='/health'){res.writeHead(200);res.end('synthetic');return;}
 if(closed){res.writeHead(503);res.end('closed');return;}
 if(req.url!=='/work'){res.writeHead(404);res.end();return;}
 const id=++sequence;work.set(id,res);process.send({event:'job',id});
});
process.on('message',msg=>{
 if(msg.command==='close'){closed=true;process.send({event:'closed'});}
 if(msg.command==='open'){closed=false;process.send({event:'opened'});}
 if(msg.command==='finish'){const res=work.get(msg.id);work.delete(msg.id);if(res&&!res.destroyed){res.writeHead(200);res.end('done');}}
 if(msg.command==='shutdown'){server.closeAllConnections();server.close(()=>process.exit(0));}
});
server.listen(0,'127.0.0.1',()=>process.send({event:'ready',port:server.address().port}));`;
const workerCode = `process.on('message',msg=>{if(msg.command==='stop')process.exit(0)});process.send({event:'worker-ready'});`;
export async function operationalFixture(t, { restartUnexpectedly = false, preflightPass = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labia-5b10p-')); fs.chmodSync(root, 0o700);
  const backendFile = path.join(root, 'backend.mjs'); const workerFile = path.join(root, 'worker.mjs'); const stateFile = path.join(root, 'state.json');
  fs.writeFileSync(backendFile, backendCode, { mode: 0o600 }); fs.writeFileSync(workerFile, workerCode, { mode: 0o600 });
  const originalState = JSON.stringify({ workspace: 'A', messages: ['synthetic'], configuration: 'original' }); fs.writeFileSync(stateFile, originalState, { mode: 0o600 });
  const changes = new EventEmitter(); const allProcesses = []; const jobs = []; const requests = [];
  let backend; let port; let closed = false; let supervisorHeld = false; let authorized = true; let cleaned = false; let restarts = 0;
  const counts = { stops: 0, starts: 0, releaseAdmission: 0 };
  function startTicks(child) { const text = fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8'); return text.slice(text.lastIndexOf(')') + 2).split(' ')[19]; }
  function launch(file) {
    if (![backendFile, workerFile].includes(file)) throw Error('FIXTURE_PROCESS_REJECTED');
    const child = cp.spawn(process.execPath, [file], { cwd: root, env: { LANG: 'C' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); allProcesses.push(child); return child;
  }
  async function start() {
    const child = launch(backendFile); backend = child; counts.starts++;
    child.on('message', message => {
      if (message.event === 'job') { jobs.push({ id: message.id, classification: 'known', active: true, pid: child.pid, start: startTicks(child) }); changes.emit('change'); }
    });
    const message = await new Promise(resolve => child.on('message', value => { if (value.event === 'ready') resolve(value); }));
    port = message.port; if ([3001, 11434].includes(port)) throw Error('PRODUCTION_PORT_REJECTED');
    if (closed) await command(child, 'close', 'closed');
  }
  async function command(child, commandName, event) {
    const acknowledged = new Promise(resolve => {
      const listener = value => { if (value.event === event) { child.off('message', listener); resolve(); } }; child.on('message', listener);
    });
    child.send({ command: commandName }); await acknowledged;
  }
  t.after(async () => {
    if (cleaned) return; cleaned = true;
    for (const request of requests) request.destroy();
    for (const process of allProcesses) if (process.exitCode === null && process.signalCode === null) process.kill('SIGTERM');
    await Promise.all(allProcesses.map(process => process.exitCode !== null || process.signalCode !== null ? Promise.resolve() : once(process, 'close')));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await start();
  const identity = () => ({ pid: backend.pid, start: startTicks(backend) });
  const live = () => backend.exitCode === null && backend.signalCode === null;
  const adapter = {
    preflight: async () => ({ passed: preflightPass, supervisorControlVerified: true, admissionControlVerified: true, identity: identity() }),
    closeAdmission: async () => { supervisorHeld = true; await command(backend, 'close', 'closed'); closed = true; },
    admissionStatus: async () => ({ closed, technical: true, allEntrypoints: true }),
    inventory: async () => ({ complete: true, scopes: ['local-client', 'container', 'remote-descendants', 'external'], jobs: jobs.map(j => ({ ...j })) }),
    backendStatus: async () => ({ running: live(), listenerClosed: !live(), supervisorHeld, identity: live() ? identity() : null }),
    waitForChange: () => once(changes, 'change'),
    stopBackend: async expected => {
      if (expected.pid !== backend.pid || expected.start !== startTicks(backend)) throw Error('IDENTITY_CHANGED');
      counts.stops++; const stopped = once(backend, 'exit'); backend.send({ command: 'shutdown' }); await stopped;
      if (restartUnexpectedly && restarts++ === 0) await start();
    },
    observeStability: () => new Promise(resolve => setTimeout(resolve, 5)),
    authorize: async () => authorized,
    startForAcceptance: start,
    acceptance: async () => (await request('/health')).status === 200,
    releaseAdmission: async () => { await command(backend, 'open', 'opened'); closed = false; counts.releaseAdmission++; },
    rollbackPreservingState: async () => { const saved = JSON.parse(fs.readFileSync(stateFile)); saved.configuration = 'original'; fs.writeFileSync(stateFile, JSON.stringify(saved)); return JSON.stringify(saved) === originalState; },
  };
  function request(url = '/work') {
    if (![ '/work', '/health' ].includes(url) || [3001, 11434].includes(port)) throw Error('FIXTURE_DESTINATION_REJECTED');
    let client;
    const completion = new Promise((resolve, reject) => {
      client = http.request({ hostname: '127.0.0.1', port, path: url }, res => { res.resume(); res.once('end', () => resolve({ status: res.statusCode })); });
      client.on('error', reject); client.end(); requests.push(client);
    });
    completion.client = () => client; return completion;
  }
  async function remoteWorker(classification = 'known') {
    const child = launch(workerFile); await once(child, 'message');
    const record = { classification, pid: child.pid, start: startTicks(child), active: true, id: 0 }; jobs.push(record);
    return { child, record, async finish() { const exited = once(child, 'exit'); child.send({ command: 'stop' }); await exited; record.active = false; changes.emit('change'); } };
  }
  return { root, adapter, jobs, counts, request, remoteWorker,
    createWindow: options => createOperationalWindow(adapter, options),
    setAuthorized: value => { authorized = value; },
    getClosed: () => closed,
    finish: id => { const job = jobs.find(j => j.id === id); job.active = false; backend.send({ command: 'finish', id }); changes.emit('change'); },
    stageConfiguration: () => { const data = JSON.parse(fs.readFileSync(stateFile)); data.configuration = 'candidate'; fs.writeFileSync(stateFile, JSON.stringify(data)); },
    state: () => JSON.parse(fs.readFileSync(stateFile)),
  };
}
