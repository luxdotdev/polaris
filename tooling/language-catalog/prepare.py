"""Opt-in fixture installs from checked-in frozen bundles; no lifecycle scripts or real user home."""
import argparse
import hashlib
import json
import pathlib
import re
from fixture import temporary_root, npm_environment, run

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True, type=pathlib.Path)
parser.add_argument('--tool', action='append', required=True)
args = parser.parse_args()
root = temporary_root(args.root)
root.mkdir(parents=True, exist_ok=False)
repo = pathlib.Path(__file__).resolve().parents[2]
catalog = json.loads((repo / 'apps/daemon/src/languages/catalog/catalog.json').read_text())
audit_root = repo / 'tooling/language-catalog'
env = npm_environment(root)
config_result = run(['npm', 'config', 'list', '--json'], root, env, 10)
if config_result.returncode:
    raise RuntimeError('npm configuration probe failed')
config = json.loads(config_result.stdout)
for key in ('userconfig', 'globalconfig', 'cache', 'prefix', 'registry'):
    assert config[key] == env['npm_config_' + key], 'npm path/registry mismatch: ' + key
assert not any(value and re.search(r'auth(token)?$|password|username|(^|:)token', key, re.I)
               for key, value in config.items()), 'Unexpected credential configuration'
(root / 'isolation.json').write_text(json.dumps({'environmentKeys': sorted(env),
    'npmConfig': {key: config[key] for key in ('userconfig', 'globalconfig', 'cache', 'prefix', 'registry')},
    'credentials': 'none', 'reservedHomeOverrides': False}, indent=2) + '\n')
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
    result = run(command, install, env, 180)
    (install / 'install.log').write_text(result.stdout + result.stderr)
    results.append({'tool': tool_id, 'version': tool['version'], 'exitCode': result.returncode,
                    'auditStatus': artifact['audit'], 'cwd': str(install), 'command': command})
    print(tool_id, tool['version'], 'fixture install exit', result.returncode, flush=True)
(root / 'install-results.json').write_text(json.dumps(results, indent=2) + '\n')
if any(result['exitCode'] != 0 for result in results):
    raise SystemExit(1)
