"""Validate cached immutable fixture inputs and print a bounded proposal; never build/install."""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True, type=pathlib.Path)
parser.add_argument('--source-cache', required=True, type=pathlib.Path)
parser.add_argument('--crates', required=True, type=pathlib.Path)
parser.add_argument('--compiler-home', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
temporary = pathlib.Path('/tmp').resolve()
for path in [args.root, args.source_cache, args.crates]:
    if not path.resolve().is_relative_to(temporary) or path.resolve() == temporary:
        parser.error('Private temporary fixture roots required')
if args.root.exists():
    parser.error('Proposed build root must not exist')
source = pathlib.Path(__file__).resolve().parent
record = json.loads((source / 'native-source-closure.json').read_text())['rust-analyzer']
archive = args.source_cache / hashlib.sha256(record['url'].encode()).hexdigest()
if hashlib.sha256(archive.read_bytes()).hexdigest() != record['sha256']:
    raise ValueError('Pinned source integrity')
packages = json.loads((source / 'rust-analyzer-crates.json').read_text())['packages']
for package in packages:
    path = args.crates / (package['name'] + '-' + package['version'] + '.crate')
    if hashlib.sha256(path.read_bytes()).hexdigest() != package['sha256']:
        raise ValueError('Pinned crate integrity: ' + path.name)
compiler = args.compiler_home / 'bin/rustc'
cargo = args.compiler_home / 'bin/cargo'
identity = subprocess.run([str(compiler), '-vV'], capture_output=True, text=True,
                          check=True, timeout=5).stdout
if 'commit-hash: 88d9e12ae178fab0fb5cc050a94da85685d449ea\n' not in identity or 'release: 1.98.0\n' not in identity or 'host: aarch64-apple-darwin\n' not in identity:
    raise ValueError('Exact existing local compiler identity required')
plan = {'status': 'proposal-only; no extraction/build/install/activation executed',
        'target': 'aarch64-apple-darwin', 'source': record,
        'sourceArchive': str(archive), 'crateDirectory': str(args.crates),
        'verifiedCrates': len(packages), 'compilerIdentity': identity,
        'compilerSha256': hashlib.sha256(compiler.read_bytes()).hexdigest(),
        'cargoSha256': hashlib.sha256(cargo.read_bytes()).hexdigest(),
        'root': str(args.root), 'minimumFreeBytes': 6 * 1024**3,
        'diskFreeBytesObserved': shutil.disk_usage(temporary).free,
        'resourceProposal': {'jobs': 2, 'wallTimeSeconds': 1200, 'outputBudgetBytes': 4 * 1024**3,
                             'aggregateStopBytes': 3 * 1024**3, 'stopFreeBytes': 2 * 1024**3,
                             'measurementIntervalSeconds': 0.1, 'perFileBytes': 256 * 1024**2,
                             'externalReceiptBudgetBytes': 8192, 'pollingOvershootLimitation': True},
        'stagingRequired': ['Verify and safely unpack pinned source archive into root/source.',
                            'Stage every checksum-verified registry archive into root/vendor with per-file .cargo-checksum.json; bind full staged tree root.',
                            'Use private Cargo config replacing crates.io with root/vendor; freeze lock/features/target/compiler/SDK environment.',
                            'Capture compiler/std source and legal roots before distributing any output.',
                            'Stage hashed recording linker wrapper; bind direct Clang identity and unique per-invocation maps; require a unique retained output map with matching final binary digest.'],
        'environment': {'CARGO_HOME': str(args.root / 'cargo-home'),
                        'CARGO_TARGET_DIR': str(args.root / 'target'), 'CARGO_NET_OFFLINE': 'true',
                        'RUSTC': str(compiler),
                        'CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER': str(args.root / 'record-link')},
        'cwd': str(args.root / 'source'),
        'argv': [str(cargo), 'build', '--frozen', '--offline', '--release', '-j', '2',
                 '--target', 'aarch64-apple-darwin', '-p', 'rust-analyzer', '--bin', 'rust-analyzer'],
        'acceptance': ['Actual bounded offline build, exact feature/dependency/link-map/runtime membership.',
                       'Output digest plus compiler/sysroot/SDK/legal/source+notice delivery manifest.',
                       'Actual initialize/open/hover/diagnostic/format-or-declared-formatter/shutdown fixtures; no production Host certification.',
                       'Second identical-input build comparison or disclose byte reproducibility limitations.',
                       'A1 exact artifact review before any descriptor/default/provider change.']}
args.output.write_text(json.dumps(plan, indent=2) + '\n')
print('Proposal inputs verified:', len(packages), 'crates; source and compiler digests retained. No heavy work executed.')
