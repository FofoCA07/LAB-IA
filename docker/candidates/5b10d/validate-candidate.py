#!/usr/bin/env python3
"""Read-only validation: Compose config, source comparisons and static checks.

Creates no directory/HOME and never invokes candidate lab-open or Docker resources.
"""
import json
import os
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASE = 'b0c4f9b'
OC = 'ghcr.io/anomalyco/opencode@sha256:bf9d0e84b7cedef436a8f57db4d48767cd5d8fc6604f666335c1cc916b199a97'
NODE = 'docker.io/library/node@sha256:9f0dde62d10e7ff7a310ecaebd66225f6b46c17e6cb778449a77b05d3541bea2'


def run(*args, env=None):
    return subprocess.check_output(args, cwd=ROOT, env=env, text=True)


# Only explicit synthetic, nonexistent paths are interpolated. Do not create them.
env = {key: os.environ[key] for key in ['PATH', 'SYSTEMROOT'] if key in os.environ}
env.update(HOME='/nonexistent', LAB_WORKSPACE=str(HERE / 'NOT_CREATED_workspace'),
           LAB_OPENCODE_HOME=str(HERE / 'NOT_CREATED_home'))
model = json.loads(run('docker', 'compose', '-p', 'labia-meta-a-static', '-f',
                      str(HERE / 'compose.yaml'), 'config', '--no-env-resolution',
                      '--format', 'json', env=env))
assert set(model['services']) == {'opencode', 'opencode-gateway'}
oc = model['services']['opencode']
gw = model['services']['opencode-gateway']
assert set(oc['networks']) == {'front'}
assert set(gw['networks']) == {'front', 'upstream'}
assert not oc.get('extra_hosts')
assert oc['container_name'] == 'opencode'
assert oc['depends_on']['opencode-gateway']['condition'] == 'service_healthy'
assert gw['extra_hosts'] == ['host.docker.internal=host-gateway']
assert gw['networks']['front']['interface_name'] == 'front0'
assert gw['networks']['upstream']['interface_name'] == 'upstream0'
assert gw['networks']['upstream']['gw_priority'] == 1
for svc, image in [(oc, OC), (gw, NODE)]:
    assert svc['image'] == image and svc['pull_policy'] == 'never'
    assert svc['user'] == '1000:1000' and svc['read_only'] is True
    assert svc['cap_drop'] == ['ALL'] and not svc.get('cap_add')
    assert svc['security_opt'] == ['no-new-privileges:true']
    assert svc['init'] is True and svc['pids_limit'] == 256
    assert not svc.get('ports') and not svc.get('privileged')
    assert not svc.get('network_mode') and not svc.get('env_file')
    assert all(v['type'] == 'bind' and v['bind']['create_host_path'] is False
               for v in svc['volumes'])
assert int(gw['mem_limit']) == 256 * 1024 * 1024 and float(gw['cpus']) == 0.5
assert gw['tmpfs'] == ['/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777']
assert len(gw['volumes']) == 2 and all(v['read_only'] for v in gw['volumes'])
assert {v['source'] for v in gw['volumes']} == {
    str(HERE / 'gateway-launcher.mjs'),
    str(ROOT / 'proyectos/lab-ia-web/server/opencode-gateway.js')}
assert gw['healthcheck']['test'] == ['CMD', 'node', '/app/launcher.mjs', '--healthcheck']
assert len(oc['volumes']) == 4
mounts = {v['target']: v for v in oc['volumes']}
assert mounts['/workspace']['read_only'] is True
assert mounts['/workspace']['source'] == env['LAB_WORKSPACE']
assert mounts['/home/adolf']['source'] == env['LAB_OPENCODE_HOME']
assert not mounts['/home/adolf'].get('read_only', False)
assert mounts['/home/adolf/.config/opencode/agents']['read_only'] is True
assert mounts['/home/adolf/.config/opencode/opencode.json']['source'] == str(HERE / 'opencode.json')
assert mounts['/home/adolf/.config/opencode/opencode.json']['read_only'] is True
assert oc['tmpfs'] == ['/tmp:rw,nosuid,nodev,exec,size=256m,mode=1777']
assert oc['environment'] == {
    'HOME': '/home/adolf', 'OPENCODE_DISABLE_AUTOUPDATE': 'true',
    'OPENCODE_DISABLE_MODELS_FETCH': 'true', 'OPENCODE_DISABLE_DEFAULT_PLUGINS': 'true'}
assert set(model['networks']) == {'front', 'upstream'}
front = model['networks']['front']
assert front['driver'] == 'bridge' and front['internal'] is True
assert front['enable_ipv4'] is True and front['enable_ipv6'] is False
assert front['driver_opts'] == {'com.docker.network.bridge.gateway_mode_ipv4': 'isolated'}
upstream = model['networks']['upstream']
assert upstream['driver'] == 'bridge' and not upstream.get('internal', False)
assert upstream['enable_ipv4'] is True and upstream['enable_ipv6'] is False
assert all(not n.get('ipam') and not n.get('external') for n in model['networks'].values())

original = json.loads((ROOT / 'docker/opencode.json').read_text())
candidate = json.loads((HERE / 'opencode.json').read_text())
original['provider']['ollama']['options']['baseURL'] = 'http://opencode-gateway:8080/v1'
assert candidate == original, 'Only baseURL may change'
for path in ['docker/docker-compose.yml', 'docker/opencode.json', 'scripts/lab-open',
             'proyectos/lab-ia-web/server/index.js',
             'proyectos/lab-ia-web/server/opencode-gateway.js', 'agentes/agents/reviewer.md']:
    expected = subprocess.check_output(['git', 'show', f'{BASE}:{path}'], cwd=ROOT)
    assert (ROOT / path).read_bytes() == expected, f'Active file changed: {path}'
script = (HERE / 'lab-open').read_text()
assert '--apply-meta-a' not in script and 'LAB_META_A_HOME_REVIEWED' not in script
assert 'canonical_approved' in script and 'current_topology' in script
assert 'current_ro' in script and 'compose up' not in script[:script.index('current_ro=')]
assert 'docker compose -p docker -f "$docker_dir/compose.yaml"' in script
assert 'compose up -d --no-deps --force-recreate --pull never --no-build opencode' in script
assert 'running|healthy|2|front|upstream' in script
assert '1|front|0|0' in script and 'workspace_rw" != false' in script
assert 'docker compose down' not in script and 'prune' not in script
assert 'compose up' not in script[:script.index('gateway_state=')]
assert 'ollama' not in script.lower()
assert not (HERE / 'NOT_CREATED_home').exists()
assert not (HERE / 'NOT_CREATED_workspace').exists()

for file in HERE.iterdir():
    if file.is_file():
        content = file.read_text()
        assert content.endswith('\n'), f'Missing final newline: {file.name}'
        assert all(line == line.rstrip() for line in content.splitlines()), f'Whitespace: {file.name}'
        assert '\r' not in content, f'CRLF: {file.name}'
print('PASS: effective Compose, provider, mounts, hardening, active files, script and whitespace')
print('OpenCode=front; Gateway=front+upstream; OpenCode extra_hosts=none; published ports=none')
print('No deployment, Docker resources, HOME creation or inference performed.')
