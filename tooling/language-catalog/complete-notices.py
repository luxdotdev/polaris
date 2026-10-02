"""Capture legal metadata from immutable upstream archives, without reading implementation."""
import argparse
import concurrent.futures
import hashlib
import io
import json
import pathlib
import re
import tarfile
import tempfile
import os
import urllib.request
import zipfile
import tomllib


def download(url, cache):
    path = cache / hashlib.sha256(url.encode()).hexdigest()
    if not path.exists():
        request = urllib.request.Request(url, headers={'User-Agent': 'Polaris-legal-audit'})
        data = urllib.request.urlopen(request, timeout=90).read()
        with tempfile.NamedTemporaryFile(dir=cache, delete=False) as stream:
            stream.write(data)
            temporary = stream.name
        os.replace(temporary, path)
    return path.read_bytes()


def legal_name(name):
    return '/LICENSES/' in name or '/licenses/' in name or bool(re.match(r'^(licen[sc]e|copying|notice|copyright|patents|authors)([._-].*)?$',
                         pathlib.PurePosixPath(name).name, re.I))


def save_notice(name, data, output):
    digest = hashlib.sha256(data).hexdigest()
    (output / 'notices' / (digest + '.txt')).write_bytes(data)
    return {'path': name, 'sha256': digest}


def archive_notices(data, output):
    if data[:2] == b'PK':
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return [save_notice(name, archive.read(name), output) for name in archive.namelist()
                    if legal_name(name) and not name.endswith('/')]
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        return [save_notice(member.name, archive.extractfile(member).read(), output)
                for member in archive.getmembers() if member.isfile() and legal_name(member.name)]


def source_record(url, cache, output):
    data = download(url, cache)
    return {'url': url, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
            'notices': archive_notices(data, output)}


def cargo_job(pkg, fixture, cache, output):
    identity = pkg['name'] + '-' + pkg['version']
    data = (fixture / 'crates' / (identity + '.crate')).read_bytes()
    if hashlib.sha256(data).hexdigest() != pkg['sha256']:
        raise ValueError(identity + ': crate integrity')
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        manifest = tomllib.loads(archive.extractfile(identity + '/Cargo.toml').read().decode())
        names = archive.getnames()
        vcs_names = [name for name in names if name.endswith('/.cargo_vcs_info.json')]
        vcs = json.loads(archive.extractfile(vcs_names[0]).read()) if vcs_names else {}
        repo = manifest['package'].get('repository', '')
        match = re.search(r'github.com/([^/]+/[^/]+)', repo)
        commit = vcs.get('git', {}).get('sha1')
        if not commit:
            declared = re.search(r'from commit ([a-f0-9]{40})', manifest['package'].get('description', ''))
            if declared:
                commit = declared[1]
        if pkg['name'] == 'perf-event-open-sys':
            repo = 'https://github.com/jimblandy/perf-event'
            match = re.search(r'github.com/([^/]+/[^/]+)', repo)
        result = {'name': pkg['name'], 'version': pkg['version'], 'crateSha256': pkg['sha256'],
                  'license': pkg['license'], 'repository': repo, 'vcs': vcs}
        if match and commit:
            repository = match[1].removesuffix('.git')
            try:
                result['source'] = source_record('https://codeload.github.com/' + repository +
                                                 '/tar.gz/' + commit, cache, output)
            except Exception as error:
                result['missingEvidence'] = [str(error)]
        else:
            result['missingEvidence'] = ['No immutable source commit in crate metadata']
        return result


def php_job(pkg, cache, output):
    return {'name': pkg['name'], 'version': pkg['version'], 'license': pkg['license'],
            'reference': pkg['source']['reference'],
            'source': source_record(pkg['dist']['url'], cache, output)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=pathlib.Path, required=True)
    parser.add_argument('--fixture', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    temporary = pathlib.Path('/tmp').resolve()
    for path in [args.root, args.fixture]:
        if not path.resolve().is_relative_to(temporary) or path.resolve() == temporary:
            parser.error('Private temporary roots required')
    cache = args.root / 'legal-cache'
    cache.mkdir(parents=True, exist_ok=True)
    packages = {}
    for name in ['ruff', 'rust-analyzer']:
        inventory = json.loads((args.output / (name + '-crates.json')).read_text())
        for pkg in inventory['packages']:
            if not pkg['notices']:
                packages[(pkg['name'], pkg['version'])] = pkg
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        records = list(pool.map(lambda pkg: cargo_job(pkg, args.fixture, cache, args.output),
                                packages.values()))
    (args.output / 'cargo-notice-sources.json').write_text(json.dumps(records, indent=2) + '\n')
    print('Cargo supplements:', len(records), flush=True)
    lock = json.loads((args.output / 'php-composer.lock.json').read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        records = list(pool.map(lambda pkg: php_job(pkg, cache, args.output), lock['packages']))
    (args.output / 'php-notice-sources.json').write_text(json.dumps(records, indent=2) + '\n')
    print('PHP source releases:', len(records), flush=True)


if __name__ == '__main__':
    main()
