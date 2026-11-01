#!/usr/bin/env python3
"""Read-only metadata. Redirect to a private backup, never publish raw output."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[4]
result = {'containers': {}, 'files': {}}
for container in json.loads(subprocess.check_output(['docker', 'inspect', 'opencode', 'ollama'])):
    result['containers'][container['Name'].lstrip('/')] = {
        'ID': container['Id'], 'StartedAt': container['State']['StartedAt'],
        'State': container['State']['Status'], 'Image': container['Image'],
        'ImageReference': container['Config']['Image'],
        'User': container['Config']['User'],
        'Networks': container['NetworkSettings']['Networks'],
        'Ports': container['NetworkSettings']['Ports'],
        'Mounts': sorted([{key: mount.get(key) for key in ['Destination', 'Type', 'RW', 'Source']}
                          for mount in container['Mounts']], key=lambda item: (item['Destination'], item['Type'], item['Source'])),
        'Security': {key: container['HostConfig'].get(key) for key in
                     ['ReadonlyRootfs', 'CapDrop', 'SecurityOpt', 'PidsLimit', 'Init']},
        'Compose': {key: value for key, value in container['Config'].get('Labels', {}).items()
                    if key.startswith('com.docker.compose.project') or key == 'com.docker.compose.service'},
    }
for name in ['docker/docker-compose.yml', 'docker/opencode.json', 'scripts/lab-open']:
    file = ROOT / name
    result['files'][name] = {'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                             'mode': oct(file.stat().st_mode & 0o777)}
result['containerIDs'] = sorted(subprocess.check_output(['docker', 'ps', '-aq'], text=True).split())
result['networkIDs'] = sorted(subprocess.check_output(['docker', 'network', 'ls', '-q'], text=True).split())
print(json.dumps(result, indent=2))
