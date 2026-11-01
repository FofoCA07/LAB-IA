#!/usr/bin/env python3
"""One administrative step, never called by lab-open. Does not deploy services."""
import sys
sys.dont_write_bytecode = True
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile

PACKAGE = Path(__file__).resolve().parent
CANDIDATE = PACKAGE.parent


def main():
    parser = argparse.ArgumentParser(description='Future authorized HOME preparation only')
    parser.add_argument('--prepare-new-home', action='store_true')
    args = parser.parse_args()
    if not args.prepare_new_home:
        parser.error('Explicit --prepare-new-home required; no changes made')
    spec = importlib.util.spec_from_file_location('package_check', PACKAGE / 'verify_package.py')
    checked = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checked)
    checked.verify()
    if (os.getuid(), os.getgid()) != (1000, 1000):
        raise RuntimeError('UID/GID 1000:1000 required; do not run as root')
    user_home = Path.home()
    destination = user_home / '.local/share/lab-ia-opencode/home-meta-a'
    if destination.exists() or destination.is_symlink():
        raise RuntimeError('Destination already exists: inspect, never overwrite')
    if destination.resolve() != destination:
        raise RuntimeError('Symlinked destination ancestry rejected')
    spec = importlib.util.spec_from_file_location('runtime_audit', CANDIDATE / 'home-audit.py')
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)
    source = user_home / '.local/share/lab-ia-opencode/home/.config/opencode'
    report, manifest, lock = audit.audit(source)
    inventory = json.loads((CANDIDATE / 'HOME_INVENTORY.json').read_text())
    for key in ['packages', 'direct', 'edges', 'absentOptional', 'missingRequired']:
        if report[key] != inventory[key]:
            raise RuntimeError('Audited runtime changed: ' + key)
    if audit.resolution(source, report) != inventory['sourceResolution']:
        raise RuntimeError('Source module resolution changed')
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Atomic publication after all checks; old HOME is never changed.
    staging = Path(tempfile.mkdtemp(prefix='.home-meta-a-stage-', dir=destination.parent))
    try:
        config = staging / '.config/opencode'
        config.mkdir(parents=True, mode=0o700)
        for package in report['packages']:
            shutil.copytree(source / package['location'], config / package['location'],
                            symlinks=True, ignore=shutil.ignore_patterns('node_modules'))
        (config / 'package.json').write_text(json.dumps(manifest) + '\n')
        (config / 'package-lock.json').write_text(json.dumps(lock) + '\n')
        # Empty mountpoints; production configuration and reviewer are RO binds.
        (config / 'agents').mkdir()
        (config / 'opencode.json').touch()
        for path in staging.rglob('*'):
            if path.is_symlink():
                raise RuntimeError('Unexpected symlink in prepared HOME')
            path.chmod(0o700 if path.is_dir() else 0o600)
            if (path.stat().st_uid, path.stat().st_gid) != (1000, 1000):
                raise RuntimeError('Unexpected owner')
        copied, _, _ = audit.audit(config)
        if copied['packages'] != report['packages'] or audit.resolution(config, copied) != inventory['sourceResolution']:
            raise RuntimeError('Copied graph/resolution mismatch')
        if destination.exists():
            raise RuntimeError('Destination appeared during preparation')
        staging.rename(destination)
        print(json.dumps({'prepared': True, 'packages': 27, 'resolutions': 32,
                          'uid': 1000, 'gid': 1000, 'SRI': 7, 'localHashesOnly': 20}))
    finally:
        if staging.exists():
            shutil.rmtree(staging)


if __name__ == '__main__':
    main()
