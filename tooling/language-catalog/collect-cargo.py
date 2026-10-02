"""Audit Cargo lock integrity and legal files only; never inspect implementation files."""
import argparse
import base64
import concurrent.futures
import hashlib
import io
import json
import pathlib
import tarfile
import time
import tomllib
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
if not str(args.root.resolve()).startswith('/private/tmp/'):
    parser.error('Temporary fixture root required')
cache = args.root / 'crates'
cache.mkdir(exist_ok=True)
locks = {name: tomllib.loads((args.root / (name + '-Cargo.lock')).read_text())
         for name in ['ruff', 'rust-analyzer']}
packages = {(pkg['name'], pkg['version']): pkg for lock in locks.values()
            for pkg in lock['package'] if pkg.get('source', '').startswith('registry+')}


def collect(item):
    (name, version), package = item
    url = f'https://static.crates.io/crates/{name}/{name}-{version}.crate'
    path = cache / f'{name}-{version}.crate'
    for attempt in range(4):
        try:
            data = path.read_bytes() if path.exists() else urllib.request.urlopen(url, timeout=60).read()
            path.write_bytes(data)
            break
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)
    if hashlib.sha256(data).hexdigest() != package['checksum']:
        raise ValueError(name + ' lock checksum mismatch')
    notices = []
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        manifest = tomllib.loads(archive.extractfile(f'{name}-{version}/Cargo.toml').read().decode())['package']
        for member in archive.getmembers():
            basename = pathlib.PurePosixPath(member.name).name.lower()
            if member.isfile() and basename.startswith(('license', 'licence', 'copying', 'notice', 'copyright')):
                text = archive.extractfile(member).read()
                digest = hashlib.sha256(text).hexdigest()
                (args.output / 'notices' / (digest + '.txt')).write_bytes(text)
                notices.append({'path': member.name, 'sha256': digest})
    return (name, version), {'name': name, 'version': version, 'source': package['source'],
                             'url': url, 'sha256': package['checksum'],
                             'license': manifest.get('license', 'UNKNOWN'), 'notices': notices}


records = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    for index, (identity, record) in enumerate(pool.map(collect, packages.items())):
        records[identity] = record
        if index % 100 == 0:
            print('Verified crates', index, flush=True)
for name, lock in locks.items():
    inventory = [records[(pkg['name'], pkg['version'])] for pkg in lock['package']
                 if pkg.get('source', '').startswith('registry+')]
    result = {'release': name, 'lockSha256': hashlib.sha256((args.root / (name + '-Cargo.lock')).read_bytes()).hexdigest(),
              'packages': inventory, 'workspacePackages': [pkg['name'] for pkg in lock['package'] if 'source' not in pkg]}
    (args.output / (name + '-crates.json')).write_text(json.dumps(result, indent=2) + '\n')
    print(name, len(inventory), 'dependencies;', sum(not pkg['notices'] for pkg in inventory), 'without legal files', flush=True)
