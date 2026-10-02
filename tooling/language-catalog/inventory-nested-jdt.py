"""Inventory nested JAR/native bytes without executing or reading implementation."""
import argparse
import hashlib
import io
import json
import pathlib
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--fixture', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
if not args.fixture.resolve().is_relative_to(pathlib.Path('/tmp').resolve()):
    parser.error('Private fixture required')
records = []


def inspect(payload, path, depth=0):
    if depth > 8:
        raise ValueError('Nested archive depth exceeded')
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        for name in sorted(archive.namelist()):
            lower = name.lower()
            if not lower.endswith(('.jar', '.dll', '.so', '.dylib', '.jnilib', '.exe')):
                continue
            content = archive.read(name)
            record = {'path': path + '!/' + name, 'bytes': len(content),
                      'sha256': hashlib.sha256(content).hexdigest(),
                      'kind': 'nested-jar' if lower.endswith('.jar') else 'native-runtime',
                      'closure': 'unverified; inventory is not source/legal or activation approval'}
            if lower.endswith('.jar'):
                with zipfile.ZipFile(io.BytesIO(content)) as nested:
                    record['metadata'] = [{'path': key, 'sha256': hashlib.sha256(nested.read(key)).hexdigest()}
                                          for key in sorted(nested.namelist())
                                          if key.endswith(('pom.properties', 'pom.xml', 'MANIFEST.MF'))]
                inspect(content, record['path'], depth + 1)
            records.append(record)


jars = sorted((args.fixture / 'native/jdt/plugins').glob('*.jar'))
for jar in jars:
    inspect(jar.read_bytes(), jar.name)
result = {'topLevelJars': len(jars), 'nestedJars': sum(row['kind'] == 'nested-jar' for row in records),
          'nativeFiles': sum(row['kind'] == 'native-runtime' for row in records), 'files': records,
          'scope': 'Actual immutable fixture bytes; no implementation inspected, source closure or target embedding inferred.'}
args.output.write_text(json.dumps(result, indent=2) + '\n')
print(result['topLevelJars'], result['nestedJars'], result['nativeFiles'])
