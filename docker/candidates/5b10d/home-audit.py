#!/usr/bin/env python3
"""Audit only selected local runtime packages; optional temporary HOME is self-cleaning.
Never imports package code, invokes an installer, or reads application state/auth.
"""
import argparse
import base64
import collections
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def resolve_package(source, parent, name):
    if not re.fullmatch(r'(?:@[a-zA-Z0-9_.-]+/)?[a-zA-Z0-9_.-]+', name):
        raise ValueError('Non-registry dependency name')
    at = parent
    while at == source or source in at.parents:
        candidate = at / 'node_modules' / name
        if (candidate / 'package.json').is_file():
            if candidate.is_symlink() or not candidate.resolve().is_relative_to(source / 'node_modules'):
                raise ValueError('Package link escapes reviewed runtime')
            return candidate
        if at == source:
            break
        at = at.parent
    return None


def audit(source):
    source = source.resolve(strict=True)
    manifest = json.loads((source / 'package.json').read_text())
    lock = json.loads((source / 'package-lock.json').read_text())
    assert set(manifest.get('dependencies', {})) == {'@opencode-ai/plugin'}
    assert lock['packages']['']['dependencies'] == manifest['dependencies']
    # Manifests copied later must not carry private registries or auth fields.
    for item in lock['packages'].values():
        if 'resolved' in item:
            url = urlsplit(item['resolved'])
            assert url.scheme == 'https' and url.hostname == 'registry.npmjs.org'
            assert not url.username and not url.password and not url.query
    serialized = json.dumps([manifest, lock])
    assert not re.search(r'"(?:_auth|_authToken|password|token|credentials)"\s*:', serialized, re.I)
    queue = collections.deque([source])
    seen, records, absent, edges = set(), [], [], []
    while queue:
        package = queue.popleft()
        key = str(package.relative_to(source)) if package != source else ''
        if key in seen:
            continue
        seen.add(key)
        data = json.loads((package / 'package.json').read_text())
        if key:
            locked = lock['packages'][key]
            assert data['version'] == locked['version'], f'Version mismatch: {key}'
            assert data.get('dependencies', {}) == locked.get('dependencies', {}), f'Runtime dependency mismatch: {key}'
            assert data.get('optionalDependencies', {}) == locked.get('optionalDependencies', {}), key
            files, links = {}, []
            for path in sorted(package.rglob('*')):
                rel = str(path.relative_to(package))
                if 'node_modules' in path.relative_to(package).parts:
                    continue  # Selected nested packages are audited independently.
                if path.is_symlink():
                    target = path.resolve(strict=True)
                    assert target.is_relative_to(package), f'External package link: {key}/{rel}'
                    links.append({'path': rel, 'target': os.readlink(path)})
                elif path.is_file():
                    assert not re.search(r'^(?:auth\.json|\.npmrc|credentials|id_rsa|id_ed25519)$|\.(?:sqlite|db)$', path.name, re.I), key
                    files[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
                else:
                    assert path.is_dir(), key
            assert 'package.json' in files
            cache_state = 'NO_LOCAL_TARBALL: versions and local file hashes only'
            integrity = locked.get('integrity')
            if integrity and integrity.startswith('sha512-'):
                digest = base64.b64decode(integrity.split('-', 1)[1]).hex()
                cache = Path.home() / '.npm/_cacache/content-v2/sha512' / digest[:2] / digest[2:4] / digest[4:]
                if cache.is_file() and not cache.is_symlink():
                    blob = cache.read_bytes()
                    assert hashlib.sha512(blob).hexdigest() == digest, key
                    matched = 0
                    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:*') as archive:
                        for member in archive:
                            if not member.isfile():
                                continue
                            assert member.name.startswith('package/') and '..' not in Path(member.name).parts
                            rel = member.name[len('package/'):]
                            assert rel in files, f'Archive member absent: {key}/{rel}'
                            assert hashlib.sha256(archive.extractfile(member).read()).hexdigest() == files[rel], key
                            matched += 1
                    cache_state = f'SRI_TARBALL_PASS; {matched} installed archive files matched; extra installed files only locally hashed'
            records.append({'package': data['name'], 'expectedVersion': locked['version'], 'installedVersion': data['version'],
                            'location': key, 'runtime': data.get('dependencies', {}), 'optional': data.get('optionalDependencies', {}),
                            'peers': data.get('peerDependencies', {}), 'peerMeta': data.get('peerDependenciesMeta', {}),
                            'installLifecycleDeclared': any(k in data.get('scripts', {}) for k in ['preinstall', 'install', 'postinstall']),
                            'lockIntegrity': integrity, 'integrityEvidence': cache_state,
                            'fileCount': len(files), 'fileManifestSHA256': hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(),
                            'symlinks': links, 'typesOnly': not any(p.endswith(('.js', '.mjs', '.cjs')) for p in files)})
        optional = data.get('optionalDependencies', {})
        dependencies = {**data.get('dependencies', {}), **optional, **data.get('peerDependencies', {})}
        for name, spec in dependencies.items():
            assert not re.match(r'(?:https?:|git[+:]|file:|link:|workspace:)', spec), f'Remote/local dependency spec: {name}'
            is_optional = name in optional or data.get('peerDependenciesMeta', {}).get(name, {}).get('optional', False)
            target = resolve_package(source, package, name)
            if target is None:
                assert is_optional, f'Missing required dependency: {name}'
                absent.append({'from': key or 'ROOT', 'package': name, 'optional': True})
                continue
            target_data = json.loads((target / 'package.json').read_text())
            assert target_data.get('name') == name
            if 'os' in target_data:
                assert 'linux' in target_data['os'] and '!linux' not in target_data['os'], name
            if 'cpu' in target_data:
                assert 'x64' in target_data['cpu'] and '!x64' not in target_data['cpu'], name
            edges.append({'from': key, 'name': name, 'target': str(target.relative_to(source))})
            queue.append(target)
    return {'platform': 'linux/amd64', 'direct': manifest['dependencies'], 'packages': records,
            'missingRequired': [], 'absentOptional': absent, 'edges': edges,
            'scope': 'Local runtime graph and resolution; no package code executed; no remote integrity claim without cached tarball'}, manifest, lock


def resolution(source, report):
    # Node resolvers inspect exports/main only. They do not import or execute modules.
    js = '''import fs from 'node:fs';import {createRequire} from 'node:module';import {pathToFileURL,fileURLToPath} from 'node:url';
const x=JSON.parse(fs.readFileSync(0,'utf8'));const output=[];
for(const edge of x.edges){const parent=x.source+'/'+edge.from+'/package.json';let found;
try{try{found=createRequire(parent).resolve(edge.name);}catch{found=fileURLToPath(import.meta.resolve(edge.name,pathToFileURL(parent).href));}if(!fs.existsSync(found))throw Object.assign(Error(),{code:'ENTRY_MISSING'});}catch(e){console.error(JSON.stringify({module:edge.name,code:e.code??'RESOLUTION_ERROR'}));process.exit(2);}
const expected=fs.realpathSync(x.source+'/'+edge.target)+'/';
if(!fs.realpathSync(found).startsWith(expected))throw Error('RESOLUTION_OUTSIDE_PACKAGE');
output.push({module:edge.name,from:edge.from,found:true});}
console.log(JSON.stringify({pass:true,edges:output.length}));'''
    types = {p['location'] for p in report['packages'] if p['typesOnly']}
    checked = []
    for edge in report['edges']:
        if edge['target'] in types:
            continue
        data = json.loads((source / edge['target'] / 'package.json').read_text())
        exports = data.get('exports')
        if isinstance(exports, dict) and any(k.startswith('.') for k in exports) and '.' not in exports:
            # Some packages intentionally expose only subpaths. Resolve actual
            # literal specifiers in the importing runtime, not an invented root.
            specifiers = set()
            for file in (source / edge['from']).rglob('*.js'):
                specifiers.update(re.findall(r"['\"](" + re.escape(edge['name']) + r"/[^'\"]+)['\"]", file.read_text()))
            assert specifiers, 'No runtime subpath identified: ' + edge['name']
            checked.extend({**edge, 'name': spec} for spec in sorted(specifiers))
        else:
            checked.append(edge)
    payload = {'source': str(source), 'edges': checked}
    out = subprocess.run(['node', '--experimental-import-meta-resolve', '--input-type=module', '-e', js],
                         input=json.dumps(payload), capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, 'Node module resolution failed: ' + out.stderr[:300]
    return {**json.loads(out.stdout), 'typesOnly': sorted(types)}


def temporary_home(source, report, manifest, lock):
    with tempfile.TemporaryDirectory(prefix='labia-5b10f-home-') as temporary:
        home = Path(temporary) / 'home'
        config = home / '.config/opencode'
        config.mkdir(parents=True, mode=0o700)
        # Only selected graph packages. No cache, auth, database or complete HOME copy.
        for package in report['packages']:
            src = source / package['location']
            dst = config / package['location']
            shutil.copytree(src, dst, symlinks=True, ignore=shutil.ignore_patterns('node_modules'))
        (config / 'package.json').write_text(json.dumps(manifest) + '\n')
        (config / 'package-lock.json').write_text(json.dumps(lock) + '\n')
        agents = config / 'agents'
        agents.mkdir()
        shutil.copyfile(ROOT / 'agentes/agents/reviewer.md', agents / 'reviewer.md')
        shutil.copyfile(HERE / 'opencode.json', config / 'opencode.json')
        for path in home.rglob('*'):
            if not path.is_symlink():
                path.chmod(0o700 if path.is_dir() else 0o600)
        home.chmod(0o700)
        assert home.stat().st_uid == os.getuid()
        copied, _, _ = audit(config)
        assert [(p['location'], p['fileManifestSHA256']) for p in copied['packages']] == [(p['location'], p['fileManifestSHA256']) for p in report['packages']]
        return {'prepared': True, 'resolution': resolution(config, copied), 'removedOnExit': True,
                'uid': os.getuid(), 'mode': '0700', 'packageCount': len(copied['packages'])}


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('--prepare-test', action='store_true')
    cli.add_argument('--write-inventory', action='store_true')
    args = cli.parse_args()
    source = Path.home() / '.local/share/lab-ia-opencode/home/.config/opencode'
    report, manifest, lock = audit(source)
    report['sourceResolution'] = resolution(source, report)
    if args.prepare_test:
        report['temporaryHome'] = temporary_home(source, report, manifest, lock)
    if args.write_inventory:
        (HERE / 'HOME_INVENTORY.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'packages': len(report['packages']), 'missingRequired': report['missingRequired'],
                      'sourceResolution': report['sourceResolution'], 'temporaryHome': report.get('temporaryHome'),
                      'integrity': collections.Counter(p['integrityEvidence'].split(';')[0] for p in report['packages'])}))


if __name__ == '__main__':
    main()
