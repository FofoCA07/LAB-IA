// Tests only. Applies the audited patch solely to an exclusive /tmp source copy.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const sha = s => createHash('sha256').update(s).digest('hex');
function replace(s, a, b) { if (s.split(a).length !== 2) throw Error('HARNESS_ANCHOR_CHANGED'); return s.replace(a, b); }
export async function stagePatch(t) {
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'GATE_PATCH_MANIFEST.json')));
  const patch = path.join(here, 'GATE_INTEGRATION.patch');
  if (sha(fs.readFileSync(patch)) !== manifest.patchSHA256) throw Error('PATCH_HASH_CHANGED');
  if (manifest.base !== '04e50657a20481440a32a5ea2e6490c80c6b1a84') throw Error('WRONG_BASE');
  for (const name of Object.keys(manifest.sources)) {
    if (!/^proyectos\/lab-ia-web\/server\/(?:[a-z-]+\.js|maintenance\/[a-z-]+\.mjs)$/.test(name)) throw Error('PATCH_PATH_REJECTED');
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labia-5b10t-')); fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = path.join(root, 'proyectos/lab-ia-web/server'); fs.mkdirSync(server, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
  const inventory = JSON.parse(fs.readFileSync(path.join(here, 'ASSEMBLY_SOURCES.json')));
  for (const name of Object.keys(inventory)) {
    const data = execFileSync('git', ['show', manifest.base + ':proyectos/lab-ia-web/server/' + name], { cwd: repo });
    if (sha(data) !== inventory[name]) throw Error('SOURCE_CHANGED');
    fs.writeFileSync(path.join(server, name), data, { mode: 0o600 });
  }
  execFileSync('git', ['apply', '--check', patch], { cwd: root });
  execFileSync('git', ['apply', patch], { cwd: root });
  for (const [name, item] of Object.entries(manifest.sources)) {
    if (sha(fs.readFileSync(path.join(root, name))) !== item.newSHA256) throw Error('APPLIED_HASH_MISMATCH');
  }
  const runtimeFile = path.join(server, 'maintenance/runtime.mjs');
  const { openAdmissionRuntime } = await import(pathToFileURL(runtimeFile));
  return { root, server, openAdmissionRuntime, async assemble(t, options) {
    // Reuse the audited VM facades. Replace source injection with APPLIED files.
    let source = fs.readFileSync(path.join(here, 'isolated-assembly.mjs'), 'utf8');
    for (const name of ['barrier.mjs', 'private-store.mjs', 'local-control.mjs', 'backend-hooks.mjs', 'stage-backend.mjs']) {
      source = source.replaceAll("'./" + name + "'", JSON.stringify(pathToFileURL(path.join(here, name)).href));
    }
    source = replace(source, "const here = path.dirname(fileURLToPath(import.meta.url));", 'const here = ' + JSON.stringify(here) + ';');
    source = replace(source, "const sourceRoot = path.resolve(here, '../../../../proyectos/lab-ia-web/server');", 'const sourceRoot = ' + JSON.stringify(server) + ';');
    source = "import { openAdmissionRuntime as actualRuntime } from " + JSON.stringify(pathToFileURL(runtimeFile).href) + ';\n' + source;
    const begin = source.indexOf('  const barrier = createBarrier('), end = source.indexOf('  const shutdown =', begin);
    if (begin < 0 || end < 0) throw Error('HARNESS_BOOTSTRAP_CHANGED');
    source = source.slice(0, begin) + '  let barrier; let hooks; let maintenanceRuntime;\n' + source.slice(end);
    source = replace(source, 'if (control) await control.close();', 'if (maintenanceRuntime) await maintenanceRuntime.close();');
    source = replace(source, 'barrier.close(); for (const database', 'barrier?.close(); for (const database');
    source = replace(source, "HOME: root, LAB_RUNTIME_DIR: runtime, LC_ALL: 'C'", "HOME: root, LAB_RUNTIME_DIR: runtime, LAB_MAINTENANCE_OPERATOR: '1', LC_ALL: 'C'");
    source = replace(source, 'if (isExec) return hooks.child(() => client(callback, output, isSummary, isSummary), { remote: true, verifyRemote: async () => remoteProof }).process;', 'if (isExec) return client(callback, output, isSummary, isSummary);');
    source = replace(source, "return hooks.child(() => client(null, '', false, true), { remote: true, verifyRemote: async () => remoteProof }).process;", "return client(null, '', false, true);");
    source = replace(source, 'const fakeFetch = hooks.trackedFetch(async (url, options) => {', 'const fakeFetch = async (url, options) => {');
    source = replace(source, '  });\n  const context = vm.createContext', '  };\n  const context = vm.createContext');
    const hashes = Object.fromEntries(Object.keys(inventory).map(n => [n, sha(fs.readFileSync(path.join(server, n)))]));
    source = replace(source, "const inventory = JSON.parse(fs.readFileSync(path.join(here, 'ASSEMBLY_SOURCES.json'), 'utf8'));", 'const inventory = ' + JSON.stringify(hashes) + ';');
    const start = source.indexOf("    if (name === 'index.js') {"), stop = source.indexOf('    const module = new vm.SourceTextModule', start);
    if (start < 0 || stop < 0) throw Error('HARNESS_TRANSFORM_CHANGED');
    source = source.slice(0, start) + "    if (name === 'index.js') text += '\\nexport { server, securityStore, database, ollamaWarmup };\\n';\n" + source.slice(stop);
    source = replace(source, "await entry.link(async spec => spec.startsWith('./') ? code(spec.slice(2)) : builtin(spec));", `await entry.link(async spec => {
      if (spec === './maintenance/runtime.mjs') return new vm.SyntheticModule(['openAdmissionRuntime'], function() {
        this.setExport('openAdmissionRuntime', async options => {
          if (options.directory !== path.join(runtime, 'maintenance-control')) return denied();
          maintenanceRuntime = await actualRuntime({ ...options, directory: controlDir });
          barrier = maintenanceRuntime.barrier; hooks = maintenanceRuntime.hooks; control = maintenanceRuntime.control;
          return maintenanceRuntime;
        });
      }, { context });
      return spec.startsWith('./') ? code(spec.slice(2)) : builtin(spec);
    });`);
    source = replace(source, 'await entry.evaluate(); await listening; namespace = entry.namespace;', 'await entry.evaluate(); await listening; namespace = entry.namespace;\n  if (normal) { await barrier.recover(); barrier.confirm(); barrier.reopen(); }');
    source = replace(source, "control = await openLocalControl({ directory: controlDir, barrier, authorize: command => ['status', 'drain', 'confirm', 'recover', 'reopen'].includes(command) });", '// Control is the real patched runtime socket; no replacement control.');
    const harness = path.join(root, 'applied-harness.mjs'); fs.writeFileSync(harness, source, { mode: 0o600 });
    const loaded = await import(pathToFileURL(harness).href + '?case=' + Math.random());
    return loaded.assembleIsolated(t, options);
  } };
}
