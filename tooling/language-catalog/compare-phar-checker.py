"""Compare immutable file identities, not implementation, across PHPactor and its pinned Box input."""
import argparse
import json
import pathlib

parser = argparse.ArgumentParser()
parser.add_argument('--php-inventory', required=True, type=pathlib.Path)
parser.add_argument('--box-inventory', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
php = json.loads(args.php_inventory.read_text())
box = json.loads(args.box_inventory.read_text())
by_path = {row['path']: row for row in box['files']}
rows = []
for row in php['files']:
    if not row['path'].startswith('.box/'):
        continue
    if row['path'] == '.box/.requirements.php':
        rows.append(dict(row, kind='generated-requirements-data', source='PHPactor pinned Composer platform constraints + Box 4.5.0 build input'))
        continue
    original = by_path.get(row['path'])
    if original is None or original['sha256'] != row['sha256'] or original['size'] != row['size']:
        raise ValueError('Embedded checker differs from exact Box input: ' + row['path'])
    rows.append(dict(row, boxPath=original['path'], kind='byte-identical-release-input'))
assert len(rows) == 35 and sum(row['kind'] == 'generated-requirements-data' for row in rows) == 1
record = {'phpactorIntegrity': 'sha256:' + php['artifactSha256'],
          'boxRelease': '4.5.0', 'boxIntegrity': 'sha256:' + box['artifactSha256'],
          'boxUrl': 'https://github.com/box-project/box/releases/download/4.5.0/box.phar',
          'files': rows, 'scope': 'All 34 shipped checker/autoloader/semver files match Box 4.5.0 exactly. Generated requirements data remains bound to PHPactor artifact hash; no PHP execution or feature certification.'}
args.output.write_text(json.dumps(record, indent=2) + '\n')
print('34 byte-identical checker release inputs; 1 pinned generated requirements-data file.')
