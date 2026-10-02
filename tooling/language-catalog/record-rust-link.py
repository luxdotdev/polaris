"""Record individual linker invocations inside one already authorized private fixture."""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import uuid


def main():
    root = pathlib.Path(os.environ['K3_LINK_ROOT']).resolve()
    linker = pathlib.Path(os.environ['K3_CLANG']).resolve()
    if not root.is_relative_to(pathlib.Path('/tmp').resolve()) or not root.is_dir():
        raise ValueError('Existing private fixture root required')
    with linker.open('rb') as stream:
        identity = hashlib.file_digest(stream, 'sha256').hexdigest()
    if identity != os.environ['K3_CLANG_SHA256']:
        raise ValueError('Linker driver identity drift')
    directory = root / 'links'
    directory.mkdir(exist_ok=True)
    if directory.is_symlink() or directory.resolve().parent != root:
        raise ValueError('Private linker record directory required')
    stem = uuid.uuid4().hex
    map_path = directory / (stem + '.map')
    argv = [str(linker), *sys.argv[1:], '-Wl,-map,' + str(map_path)]
    output = None
    if '-o' in sys.argv:
        output_path = pathlib.Path(sys.argv[sys.argv.index('-o') + 1]).resolve()
        if not output_path.is_relative_to(root):
            raise ValueError('Link output escapes private fixture')
        output = str(output_path)
    record = {'argv': argv, 'cwd': str(pathlib.Path.cwd().resolve()), 'output': output,
              'map': str(map_path), 'driverSha256': identity,
              'scope': 'Actual invocation/map only; SDK metadata is not complete SDK-input provenance.'}
    content = json.dumps(record).encode()
    if len(content) > 65536:
        raise ValueError('Bounded linker invocation receipt exceeded')
    receipt = directory / (stem + '.json')
    with receipt.open('xb') as stream:
        stream.write(content)
    return subprocess.run(argv, check=False).returncode


if __name__ == '__main__':
    raise SystemExit(main())
