"""Capture verified upstream npm pins and a frozen, script-free runtime closure."""
import base64
import concurrent.futures
import hashlib
import io
import json
import pathlib
import tarfile
import urllib.parse
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
CATALOG = REPO / 'apps/daemon/src/languages/catalog'
TOOLING = REPO / 'tooling/language-catalog'
CACHE = pathlib.Path('/private/tmp/polaris-web-archives')
CACHE.mkdir(exist_ok=True)


def encoded(value):
    return (json.dumps(value, indent=2) + '\n').encode()


def sha(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        data = response.read(96 * 1024 * 1024 + 1)
    assert len(data) <= 96 * 1024 * 1024
    return data


def package(item):
    location, pin = item
    name = location.rsplit('node_modules/', 1)[1]
    metadata = json.loads(fetch('https://registry.npmjs.org/' +
                               urllib.parse.quote(name, safe='') + '/' + pin['version']))
    assert metadata['dist']['integrity'] == pin['integrity'], name
    assert metadata['dist']['tarball'] == pin['resolved'], name
    cache = CACHE / (hashlib.sha256(pin['resolved'].encode()).hexdigest() + '.tgz')
    data = cache.read_bytes() if cache.exists() else fetch(pin['resolved'])
    expected = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
    assert expected == pin['integrity'], name
    cache.write_bytes(data)
    legal = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for entry in archive:
            if entry.isfile() and entry.name.split('/')[-1].lower().startswith(
                    ('license', 'licence', 'notice', 'copyright')):
                text = archive.extractfile(entry).read()
                legal['notices/' + hashlib.sha256(text).hexdigest() + '.txt'] = text
    return {'location': location, 'name': name, 'version': pin['version'],
            'url': pin['resolved'], 'integrity': sha(data),
            'registryIntegrity': pin['integrity'], 'license': metadata.get('license')}, legal


def main():
    catalog = json.loads((CATALOG / 'catalog.json').read_bytes())
    plans = [('vscode-langservers-extracted', 'vscode-langservers-extracted'),
             ('yaml-language-server', 'yaml-language-server'),
             ('actions-language-server', '@actions_languageserver'),
             ('prisma-language-server', '@prisma_language-server'),
             ('svelte-language-server', None)]
    if not any(tool['id'] == 'svelte-language-server' for tool in catalog['tools']):
        template = json.loads(json.dumps(next(t for t in catalog['tools']
                                             if t['id'] == 'yaml-language-server')))
        template.update(id='svelte-language-server', version='0.18.4', license='MIT',
                        source='https://registry.npmjs.org/svelte-language-server/0.18.4')
        template['artifacts'][0].update(id='svelte-language-server-npm', entry='bin/server.js')
        catalog['tools'].append(template)
    records, imports, entries = [], [], []
    for tool_id, bundle in plans:
        tool = next(t for t in catalog['tools'] if t['id'] == tool_id)
        if bundle:
            lock = json.loads((TOOLING / 'bundles' / (bundle + '.json')).read_bytes())['lock']
        else:
            frozen = json.loads((TOOLING / ('web-' + tool_id + '-dependencies.json')).read_bytes())
            lock = {'packages': {p['location']: {'version': p['version'],
                    'resolved': p['url'], 'integrity': p['registryIntegrity']}
                    for p in frozen['packages']}}
        pins = [(path, pin) for path, pin in lock['packages'].items() if path]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(package, pins))
        packages = [item[0] for item in results]
        root_name = {'prisma-language-server': '@prisma/language-server',
                     'actions-language-server': '@actions/languageserver'}.get(tool_id, tool_id)
        root = next(p for p in packages if p['location'] == 'node_modules/' + root_name)
        assert root['version'] == tool['version'] and root['license'] == tool['license']
        artifact = tool['artifacts'][0]
        artifact.update(url=root['url'], integrity=root['integrity'], bundle=None)
        # Private Node has no musl release; never advertise unsupported runtime platforms.
        artifact['platforms'] = [p for p in artifact['platforms'] if p['libc'] != 'musl']
        tool['distribution'] = 'runtime-upstream'
        tool['requirements'][0]['detail'] = 'Pinned private Node; never resolved from PATH.'
        notices = dict(pair for _, legal in results for pair in legal.items())
        assert notices, tool_id
        for path, data in notices.items():
            (TOOLING / path).write_bytes(data)
            (CATALOG / 'upstream-evidence' / ('web-' + path.split('/')[-1])).write_bytes(data)
        dependency_file = 'web-' + tool_id + '-dependencies.json'
        dependency_bytes = encoded({'root': root_name, 'packages': packages})
        (TOOLING / dependency_file).write_bytes(dependency_bytes)
        (CATALOG / 'upstream-evidence' / dependency_file).write_bytes(dependency_bytes)
        references = [{'path': dependency_file, 'integrity': sha(dependency_bytes)}]
        if tool_id == 'prisma-language-server':
            guard = (REPO / 'apps/daemon/src/languages/web/prisma-guard.txt').read_bytes()
            (TOOLING / 'managed-prisma-guard.txt').write_bytes(guard)
            references.append({'path': 'managed-prisma-guard.txt', 'integrity': sha(guard)})
        legal_references = [{'path': path, 'integrity': sha(data)} for path, data in notices.items()]
        record = {'tool': tool_id, 'version': tool['version'], 'status': 'policy-clear',
                  'artifacts': [{'id': artifact['id'], 'integrity': artifact['integrity'],
                                 'bundleIntegrity': None, 'packaging': None}],
                  'evidence': references, 'notices': legal_references, 'missingEvidence': [],
                  'obligations': ['Retain upstream licenses/notices and verify every frozen archive.',
                                  'No package scripts, builds or runtime dependency resolution.'],
                  'policyScope': 'Pinned upstream runtime downloads under ADR-0022.', 'policyRequests': []}
        records.append(record)
        manifest = {'artifactId': artifact['id'], 'artifactIntegrity': artifact['integrity'],
                    'coverage': 'complete', 'notices': legal_references, 'evidence': references}
        entries.append((artifact, manifest, notices, dependency_file))
        print(tool_id, root['version'], len(packages), 'registry-verified archives', flush=True)
    review_bytes = encoded(records)
    (TOOLING / 'runtime-web-review-records.json').write_bytes(review_bytes)
    for i, (artifact, manifest, notices, dependency_file) in enumerate(entries):
        manifest['evidence'].append({'path': 'runtime-web-review-records.json',
                                     'integrity': sha(review_bytes)})
        data = encoded(manifest)
        artifact['auditRoot'] = sha(data)
        (TOOLING / 'audits' / (artifact['id'] + '.json')).write_bytes(data)
        (CATALOG / 'upstream-evidence' / (artifact['id'] + '.json')).write_bytes(data)
        imports.append(f'import manifest{i} from "../catalog/upstream-evidence/{artifact["id"]}.json";')
        imports.append(f'import dependencies{i} from "../catalog/upstream-evidence/{dependency_file}";')
        notice_lines = []
        for j, path in enumerate(notices):
            imports.append(f'import notice{i}_{j} from "../catalog/upstream-evidence/web-{path.split("/")[-1]}" with {{ type: "text" }};')
            notice_lines.append(f'      "{path}": notice{i}_{j},')
        entries[i] = f'  "{artifact["id"]}": {{\n    manifest: manifest{i},\n    dependencies: dependencies{i},\n    notices: {{\n' + '\n'.join(notice_lines) + '\n    },\n  },'
    (REPO / 'apps/daemon/src/languages/install/webEvidence.ts').write_text(
        '\n'.join(imports) + '\n\nexport const webEvidence = {\n' + '\n'.join(entries) + '\n};\n')
    (CATALOG / 'catalog.json').write_bytes(encoded(catalog))


if __name__ == '__main__':
    main()
