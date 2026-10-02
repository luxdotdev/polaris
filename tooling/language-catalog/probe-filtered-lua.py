"""Evaluate a filtered distribution in a private fixture; no catalog approval is granted."""
import argparse
import hashlib
import json
import pathlib
import shutil
import sys
from smoke import exchange

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True, type=pathlib.Path)
parser.add_argument('--fixture', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
root = args.root.resolve()
temporary = pathlib.Path('/tmp').resolve()
if not root.is_relative_to(temporary) or root == temporary:
    parser.error('Private temporary root required')
source = args.fixture / 'native/lua'
if any(path.is_symlink() for path in source.rglob('*')):
    raise ValueError('Fixture must contain no symbolic links')
root.mkdir(parents=True, exist_ok=False)
filtered = root / 'server'
shutil.copytree(source, filtered, ignore=lambda directory, names: ['3rd'] if pathlib.Path(directory).name == 'meta' else [])
config = root / 'config.lua'
config.write_text('return { ["workspace.checkThirdParty"] = false, ["telemetry.enable"] = false }\n')
command = [str(filtered / 'bin/lua-language-server'), '--configpath=' + str(config),
           '--logpath=' + str(root / 'logs'), '--metapath=' + str(root / 'generated-meta')]
result = exchange(command, root, 'lua', 'str', {'_workspaceRoot': root.as_uri()}, completion_wait=15)
args.output.write_text(json.dumps(result, indent=2) + '\n')
items = result['completion']['result']
if isinstance(items, dict):
    items = items['items']
assert any(item['label'] == 'string' for item in items), 'Built-in string completion missing'
assert not (filtered / 'meta/3rd').exists()
result.update(filteredThirdPartyAnnotations=True, standardLibraryCompletion=True,
              binarySha256=hashlib.sha256((filtered / 'bin/lua-language-server').read_bytes()).hexdigest(),
              retainedTemplateFiles=len(list((filtered / 'meta/template').rglob('*'))),
              scope='Darwin arm64 feasibility only; no runtime/vendor legal closure or other platform certification',
              missingEvidence=['Static runtime/vendor legal closure remains unverified for published Linux artifacts.'])
args.output.write_text(json.dumps(result, indent=2) + '\n')
print('Filtered Lua: standard-library completion passed; no release certification.')
