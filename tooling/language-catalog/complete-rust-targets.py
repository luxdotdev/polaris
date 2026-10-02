"""Capture pinned target-builder metadata and complete LLVM libunwind source/legal trees."""
import argparse
import base64
import hashlib
import io
import json
import pathlib
import tarfile
from importlib.machinery import SourceFileLoader

legal = SourceFileLoader('legal', str(pathlib.Path(__file__).with_name('complete-notices.py'))).load_module()
parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
temporary = pathlib.Path('/tmp').resolve()
if not args.root.resolve().is_relative_to(temporary) or args.root.resolve() == temporary:
    parser.error('Private temporary root required')
cache = args.root / 'legal-cache'
cache.mkdir(parents=True, exist_ok=True)
api = 'https://api.github.com/repos/'


def tree(repository, identity):
    result = json.loads(legal.download(api + repository + '/git/trees/' + identity, cache))
    if result.get('truncated') or result['sha'] != identity:
        raise ValueError('Incomplete or mismatched Git tree')
    return result['tree']


def commit_tree(repository, commit):
    result = json.loads(legal.download(api + repository + '/git/commits/' + commit, cache))
    if result['sha'] != commit:
        raise ValueError('Git commit identity')
    return result['tree']['sha']


def subtree(repository, identity, path):
    for component in path.split('/'):
        row = next(row for row in tree(repository, identity) if row['path'] == component)
        identity = row['sha']
    return identity


def capture_tree(repository, identity, source_commit, prefix='', files=None):
    files = [] if files is None else files
    for row in tree(repository, identity):
        path = prefix + row['path']
        if row['type'] == 'tree':
            capture_tree(repository, row['sha'], source_commit, path + '/', files)
            continue
        if row['type'] != 'blob' or row['mode'] not in ('100644', '100755'):
            raise ValueError('Unsupported source-tree entry: ' + path)
        content = legal.download('https://raw.githubusercontent.com/' + repository + '/' + source_commit + '/libunwind/' + path, cache)
        if hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest() != row['sha']:
            raise ValueError('Git blob integrity')
        files.append((path, int(row['mode'], 8) & 0o777, content, row['sha']))
    return files


sources = json.loads((args.output / 'rust-runtime-sources.json').read_text())
records = []
for compiler, source in sources.items():
    rust_tree = commit_tree('rust-lang/rust', compiler)
    src = subtree('rust-lang/rust', rust_tree, 'src')
    llvm_commit = next(row['sha'] for row in tree('rust-lang/rust', src) if row['path'] == 'llvm-project')
    llvm_tree = commit_tree('rust-lang/llvm-project', llvm_commit)
    unwind_tree = subtree('rust-lang/llvm-project', llvm_tree, 'libunwind')
    files = capture_tree('rust-lang/llvm-project', unwind_tree, llvm_commit)
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for path, mode, content, git_blob in sorted(files):
            entry = tarfile.TarInfo(path)
            entry.size = len(content)
            entry.mode = mode
            archive.addfile(entry, io.BytesIO(content))
    payload = stream.getvalue()
    archive_path = args.root / ('libunwind-' + unwind_tree + '.tar')
    archive_path.write_bytes(payload)
    # Licensing data is inspected separately; no implementation is copied into Polaris.
    notices = [legal.save_notice(path, content, args.output) for path, mode, content, blob in files if legal.legal_name(path)]
    records.append({'rustSourceCommit': compiler, 'llvmSourceCommit': llvm_commit, 'libunwindTree': unwind_tree,
                    'sourceUrl': 'https://github.com/rust-lang/llvm-project/tree/' + llvm_commit + '/libunwind',
                    'sourceArchiveSha256': hashlib.sha256(payload).hexdigest(), 'sourceArchiveBytes': len(payload),
                    'files': [{'path': path, 'gitBlob': blob, 'sha256': hashlib.sha256(content).hexdigest(), 'mode': mode}
                              for path, mode, content, blob in sorted(files)], 'notices': notices,
                    'scope': 'Exact complete source tree declared by embedded Rust compiler Git revision. Historical runtime binary linkage/target-builder execution is not independently attested.'})
    print(compiler, llvm_commit, len(files), len(payload), flush=True)
(args.output / 'rust-target-sources.json').write_text(json.dumps(records, indent=2) + '\n')
