"""Opt-in fixture installs from checked-in frozen bundles; no lifecycle scripts or real user home."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True, type=pathlib.Path)
parser.add_argument('--tool', action='append', required=True)
args = parser.parse_args()
root = args.root.resolve()
if not str(root).startswith('/private/tmp/'):
    parser.error('Evaluation root must be in /tmp')
repo = pathlib.Path(__file__).resolve().parents[2]
catalog = json.loads((repo / 'apps/daemon/src/languages/catalog/catalog.json').read_text())
audit_root = repo / 'tooling/language-catalog'
(root / 'home').mkdir(parents=True, exist_ok=True)
(root / 'empty-npmrc').write_text('')
(root / 'empty-global-npmrc').write_text('')
env = dict(os.environ, HOME=str(root / 'home'), npm_config_cache=str(root / 'cache'),
           npm_config_userconfig=str(root / 'empty-npmrc'), npm_config_globalconfig=str(root / 'empty-global-npmrc'))
results = []
for tool_id in args.tool:
    tool = next(tool for tool in catalog['tools'] if tool['id'] == tool_id)
    artifact = next(artifact for artifact in tool['artifacts'] if artifact['format'] == 'npm')
    manifest_bytes = (audit_root / 'audits' / (artifact['id'] + '.json')).read_bytes()
    if artifact['auditRoot'] != 'sha256:' + hashlib.sha256(manifest_bytes).hexdigest():
        raise ValueError('Audit manifest changed')
    manifest = json.loads(manifest_bytes)
    bundle_bytes = (audit_root / 'bundles' / (artifact['bundle'] + '.json')).read_bytes()
    if manifest['bundleIntegrity'] != 'sha256:' + hashlib.sha256(bundle_bytes).hexdigest():
        raise ValueError('Frozen bundle changed')
    bundle = json.loads(bundle_bytes)
    install = root / 'npm' / artifact['bundle']
    install.mkdir(parents=True, exist_ok=True)
    (install / 'package.json').write_text(json.dumps(bundle['manifest']))
    (install / 'package-lock.json').write_text(json.dumps(bundle['lock']))
    command = ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']
    result = subprocess.run(command, cwd=install, env=env, capture_output=True, text=True)
    (install / 'install.log').write_text(result.stdout + result.stderr)
    results.append({'tool': tool_id, 'version': tool['version'], 'exitCode': result.returncode,
                    'auditStatus': artifact['audit'], 'cwd': str(install), 'command': command})
    print(tool_id, tool['version'], 'fixture install exit', result.returncode, flush=True)
(root / 'install-results.json').write_text(json.dumps(results, indent=2) + '\n')
if any(result['exitCode'] != 0 for result in results):
    raise SystemExit(1)
