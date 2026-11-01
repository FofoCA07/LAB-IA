#!/usr/bin/env python3
"""Read-only consistency verification. Hashes are not a signature."""
import hashlib
import json
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent
ROOT = PACKAGE.parents[3]


def verify():
    files = 0
    for line in (PACKAGE / 'MANIFEST.sha256').read_text().splitlines():
        digest, relative = line.split('  ', 1)
        file = PACKAGE / relative
        if file.is_symlink() or not file.resolve().is_relative_to(PACKAGE):
            raise RuntimeError('Package path rejected')
        if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise RuntimeError('Package changed: ' + relative)
        files += 1
    manifest = json.loads((PACKAGE / 'SOURCE_MANIFEST.json').read_text())
    for relative, digest in manifest['sources'].items():
        file = ROOT / relative
        if file.is_symlink() or not file.resolve().is_relative_to(ROOT):
            raise RuntimeError('Source path rejected')
        if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise RuntimeError('Reviewed source changed: ' + relative)
    return {'packageFiles': files, 'sourceFiles': len(manifest['sources']), 'result': 'PASS'}


if __name__ == '__main__':
    print(json.dumps(verify()))
