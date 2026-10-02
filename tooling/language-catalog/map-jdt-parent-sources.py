"""Bind nested JAR/native inventory to exact verified source-container identities."""
import hashlib
import json
import pathlib

root = pathlib.Path(__file__).resolve().parent
inventory = json.loads((root / 'jdt-nested-inventory.json').read_text())
parents = {row['name']: row for row in json.loads((root / 'jdt-source-closure.json').read_text())}
records = []
for row in inventory['files']:
    name = row['path'].split('!/', 1)[0]
    parent = parents[name]
    records.append({'path': row['path'], 'kind': row['kind'], 'sha256': row['sha256'],
                    'parent': name, 'parentSha256': parent['sha256'],
                    'parentSource': parent.get('source'),
                    'parentSourceReference': parent.get('sourceReference'),
                    'parentMaven': parent.get('maven'),
                    'scope': 'Exact containing artifact source identity only; nested/shaded/native source/build membership requires separate proof.'})
result = {'inventorySha256': hashlib.sha256((root / 'jdt-nested-inventory.json').read_bytes()).hexdigest(),
          'parentSourcesSha256': hashlib.sha256((root / 'jdt-source-closure.json').read_bytes()).hexdigest(),
          'records': records}
(root / 'jdt-nested-parent-sources.json').write_text(json.dumps(result, indent=2) + '\n')
print('Bound', len(records), 'nested/native source-container identities; no closure status promoted.')
