#!/usr/bin/env python3
"""Future single synthetic acceptance invocation. No automatic retry/cutover."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import sys
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[4]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-one-authorized-reviewer', action='store_true')
    args = parser.parse_args()
    if not args.run_one_authorized_reviewer:
        parser.error('Explicit authorization flag required; no invocation performed')
    package = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location('package_check', package / 'verify_package.py')
    checked = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checked)
    checked.verify()
    source = (ROOT / 'proyectos/lab-ia-web/server/index.js').read_text()
    container = json.loads(subprocess.check_output(['docker', 'inspect', 'opencode']))[0]
    expected = Path.home() / '.local/state/lab-ia-meta-a/acceptance/A'
    workspace = next(m for m in container['Mounts'] if m['Destination'] == '/workspace')
    if workspace['Source'] != str(expected) or workspace['RW'] or set(container['NetworkSettings']['Networks']) != {'docker_front'}:
        raise RuntimeError('Synthetic A / FRONT precondition failed')
    if {p.name for p in expected.iterdir()} != {'README.md', 'notas.txt'}:
        raise RuntimeError('Only the two synthetic files are authorized')
    evidence = 'Proyecto ficticio para aceptación META A.\n'
    if (expected / 'README.md').read_text() != evidence or (expected / 'notas.txt').read_text() != 'Solo datos sintéticos.\n':
        raise RuntimeError('Synthetic fixture content differs')
    expression = source.split('const workspaceSummaryPrompt = ', 1)[1].split(';\n\nfunction parseWorkspaceSummary', 1)[0]
    parser_source = 'function parseWorkspaceSummary' + source.split('function parseWorkspaceSummary', 1)[1].split('\nfunction runWorkspaceSummary', 1)[0]
    prompt = subprocess.check_output(['node', '--input-type=module', '-e', 'process.stdout.write(' + expression + ')'], text=True)
    snapshot = {'entries': [{'name': name, 'type': 'file'} for name in ['README.md', 'notas.txt']],
                'files': [{'name': 'README.md', 'content': evidence, 'truncated': False}], 'entriesTruncated': False}
    inline = 'OPENCODE_CONFIG_CONTENT=' + json.dumps({'agent': {'reviewer': {'tools': {'*': False}, 'permission': 'deny'}}}, separators=(',', ':'))
    command = ['docker', 'exec', '-i', '--env', inline, '--workdir', '/workspace', 'opencode',
               'timeout', '-s', 'KILL', '110', 'opencode', 'run', '--pure', '--dir', '/workspace',
               '--model', 'ollama/qwen3:8b', '--agent', 'reviewer', '--format', 'json', prompt]
    started = time.monotonic()
    try:
        run = subprocess.run(command, input='Snapshot de LAB-IA (JSON):\n' + json.dumps(snapshot),
                             text=True, capture_output=True, timeout=120)
    except subprocess.TimeoutExpired:
        print(json.dumps({'result': 'FAIL', 'reason': 'BACKEND_EQUIVALENT_TIMEOUT', 'retry': False}))
        raise SystemExit(1)
    if len(run.stdout.encode()) > 1024 * 1024 or len(run.stderr.encode()) > 1024 * 1024:
        print(json.dumps({'result': 'FAIL', 'reason': 'BACKEND_OUTPUT_LIMIT', 'retry': False}))
        raise SystemExit(1)
    events = [json.loads(line) for line in run.stdout.splitlines() if line.strip()]
    tools = sum(event.get('type', '').startswith('tool') or event.get('part', {}).get('type') == 'tool' for event in events)
    errors = sum(event.get('type') == 'error' for event in events)
    js = '''import fs from 'node:fs';\n''' + parser_source + '''
const value=parseWorkspaceSummary(fs.readFileSync(0,'utf8'));
if(JSON.stringify([...value.elementos].sort())!==JSON.stringify(['README.md','notas.txt'].sort()))process.exit(1);
console.log(JSON.stringify({parser:'PASS',fields:Object.keys(value),syntheticOnly:true}));
'''
    parsed = subprocess.run(['node', '--input-type=module', '-e', js], input=run.stdout,
                            capture_output=True, text=True, timeout=10)
    passed = run.returncode == 0 and parsed.returncode == 0 and tools == 0 and errors == 0
    print(json.dumps({'result': 'PASS' if passed else 'FAIL', 'exit': run.returncode,
                      'duration': round(time.monotonic() - started, 3), 'tools': tools,
                      'errorEvents': errors, 'parser': 'PASS' if parsed.returncode == 0 else 'FAIL',
                      'stderrBytes': len(run.stderr.encode()), 'retry': False}))
    raise SystemExit(0 if passed else 1)


if __name__ == '__main__':
    main()
