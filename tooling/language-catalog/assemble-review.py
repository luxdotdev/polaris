"""Assemble scoped evidence records; never approve missing evidence or change policy."""
import hashlib
import json
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parent
catalog_path = root / '../../apps/daemon/src/languages/catalog/catalog.json'
catalog = json.loads(catalog_path.read_text())
plan = json.loads((root / 'closure-plan.json').read_text())


def reference(path):
    return {'path': path, 'integrity': 'sha256:' + hashlib.sha256((root / path).read_bytes()).hexdigest()}


def legal_references(value):
    found = {}
    if isinstance(value, dict):
        sha = value.get('sha256')
        if isinstance(sha, str) and (root / ('notices/' + sha + '.txt')).is_file():
            path = 'notices/' + sha + '.txt'
            found[path] = reference(path)
        for child in value.values():
            found.update(legal_references(child))
    elif isinstance(value, list):
        for child in value:
            found.update(legal_references(child))
    return found


records = []
for tool in catalog['tools']:
    if tool['disposition'] != 'offered':
        continue
    bundle = tool['artifacts'][0].get('bundle')
    entry = plan.get(tool['id'], {'evidence': ['npm-notice-sources.json', 'notice-supplements.json'], 'missingEvidence': []})
    evidence = {path: reference(path) for path in entry['evidence']}
    evidence['closure-plan.json'] = reference('closure-plan.json')
    for artifact in tool['artifacts']:
        if artifact.get('packaging'):
            path = artifact['packaging']['manifest']
            evidence[path] = reference(path)
    notices = {}
    for path in entry['evidence']:
        if path.endswith('.json'):
            contents = json.loads((root / path).read_text())
            if path in ('native-source-closure.json', 'source-notices.json'):
                contents = {key: value for key, value in contents.items()
                            if key == tool['id'] or key.startswith(tool['id'] + '-')}
            if path == 'build-provenance.json':
                contents = [row for row in contents if row['tool'] == tool['id']
                            or (tool['id'] in ('ruff', 'rust-analyzer') and row['tool'] == 'rust-runtime')]
            if path == 'metadata-license-grants.json':
                contents = [row for row in contents if any(scope['tool'] == tool['id'] for scope in row['toolScopes'])]
            if path == 'cargo-notice-sources.json':
                inventory_name = tool['id'] + '-crates.json'
                inventory = json.loads((root / inventory_name).read_text())['packages']
                identities = {(row['name'], row['version']) for row in inventory}
                contents = [row for row in contents if (row['name'], row['version']) in identities]
            if path == 'rust-runtime-sources.json':
                linkage = json.loads((root / 'native-linkage.json').read_text())
                commits = {commit for row in linkage if row['tool'] == tool['id'] for commit in row['rustcSourceCommits']}
                contents = {key: value for key, value in contents.items() if key in commits}
            notices.update(legal_references(contents))
    if bundle:
        path = 'bundles/' + bundle + '.json'
        evidence[path] = reference(path)
        notices.update(legal_references(json.loads((root / path).read_text())['packages']))
    policy_requests = []
    if bundle:
        for package in json.loads((root / ('bundles/' + bundle + '.json')).read_text())['packages']:
            if package['license'] in ('BlueOak-1.0.0', 'Python-2.0', 'CC0-1.0'):
                policy_requests.append({'package': package['name'], 'version': package['version'],
                                        'license': package['license'], 'integrity': package['integrity'],
                                        'url': package['url'], 'notices': list(legal_references(package).values()),
                                        'decision': 'awaiting-A1; exact frozen dependency only, no other versions or global allowlist change'})
    missing = entry['missingEvidence']
    pending = any(a['audit'] == 'pending' for a in tool['artifacts'])
    records.append({'tool': tool['id'], 'version': tool['version'],
                    'status': 'missing-evidence' if missing else ('awaiting-review' if pending else 'policy-clear'),
                    'artifacts': [{'id': a['id'], 'integrity': a['integrity'],
                                   'packaging': a.get('packaging'),
                                   'bundleIntegrity': reference('bundles/' + a['bundle'] + '.json')['integrity'] if a.get('bundle') else None}
                                  for a in tool['artifacts']],
                    'evidence': list(evidence.values()), 'notices': list(notices.values()), 'missingEvidence': missing,
                    'obligations': ['Deliver every retained applicable copyright/license notice alongside the exact artifact.',
                                    'Deliver corresponding source/build materials where required; preserve source archive hashes and pinned dependency identities.',
                                    'A1 must review exact scoped policy and delivery obligations before activation; no global policy exception is granted.'],
                    'policyRequests': policy_requests,
                    'policyScope': tool['id'] + '@' + tool['version'] + ': only the listed artifact digests and frozen closure; evaluation SQL and other versions are excluded.'})
for record in records:
    if record['tool'] in ('gopls', 'shfmt'):
        record['obligations'].append('Compiler/runtime source evidence covers Go 1.27.1 only. A different builder toolchain or dependency plan requires a new exact scoped record before distribution.')
(root / 'review-records.json').write_text(json.dumps(records, indent=2) + '\n')
subprocess.run([str(root / '../../node_modules/.bin/oxfmt'), str(root / 'review-records.json')], check=True)
print(str(len(records)) + ' scoped records; missing evidence remains blocked.')
