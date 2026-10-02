"""Stage verified private inputs and execute only an explicitly released bounded fixture."""
import argparse
import hashlib
import io
import json
import os
import pathlib
import subprocess
import sys
import tarfile
from importlib.machinery import SourceFileLoader

sys.dont_write_bytecode = True

source = pathlib.Path(__file__).resolve().parent
bounded = SourceFileLoader('bounded', str(source / 'bounded-build.py')).load_module()
COMMIT = '88d9e12ae178fab0fb5cc050a94da85685d449ea'
LOCK = '6497b191fc31008c70214d1360893919a519095ec1b90c9ffaa667e7476d46a6'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_compiler(plan):
    compiler = pathlib.Path(plan['environment']['RUSTC']).resolve()
    cargo = pathlib.Path(plan['argv'][0]).resolve()
    if digest(compiler) != plan['compilerSha256'] or digest(cargo) != plan['cargoSha256']:
        raise ValueError('Mutable compiler/Cargo digest drift')
    identity = subprocess.run([str(compiler), '-vV'], capture_output=True, text=True,
                              timeout=5, check=True).stdout
    if ('commit-hash: ' + COMMIT + '\n') not in identity or 'host: aarch64-apple-darwin\n' not in identity:
        raise ValueError('Exact compiler commit/target drift')
    return compiler, cargo, identity


def extract(path, destination, budget, expected_sha=None):
    if path.stat().st_size > 64 * 1024**2:
        raise ValueError('Source archive exceeds bounded input size')
    payload = path.read_bytes()
    if expected_sha is not None and hashlib.sha256(payload).hexdigest() != expected_sha:
        raise ValueError('Verified archive bytes changed before extraction')
    destination.mkdir(parents=True)
    files = {}
    links = []
    written = 0
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
        for member in archive.getmembers():
            parsed = pathlib.PurePosixPath(member.name)
            if parsed.is_absolute() or '\\' in member.name or any(part in ('.', '..') for part in parsed.parts):
                raise ValueError('Unsafe archive path')
            if len(parsed.parts) < 2:
                if member.isdir():
                    continue
                raise ValueError('Archive lacks exact root directory')
            target = destination.joinpath(*parsed.parts[1:])
            if not target.resolve().is_relative_to(destination.resolve()):
                raise ValueError('Escaping archive entry')
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if member.issym():
                resolved = target.parent / member.linkname
                if pathlib.PurePosixPath(member.linkname).is_absolute() or not resolved.resolve().is_relative_to(destination.resolve()):
                    raise ValueError('Escaping archive symlink')
                links.append((target, member.linkname))
                continue
            if not member.isfile():
                raise ValueError('Archive links or special entries are forbidden')
            if member.name in files or target.exists():
                raise ValueError('Duplicate archive path')
            if member.size > 256 * 1024**2:
                raise ValueError('Archive member exceeds per-file cap')
            if written + member.size > budget.maximum:
                raise ValueError('Archive expansion exceeds aggregate fixture budget')
            budget.check(member.size)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as content, target.open('xb') as output:
                while data := content.read(65536):
                    output.write(data)
            target.chmod(member.mode & 0o777 & ~0o022)
            files[str(target.relative_to(destination))] = digest(target)
            written += member.size
    for target, link in links:
        if target.exists() or target.is_symlink():
            raise ValueError('Duplicate archive link')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(link)
        files[str(target.relative_to(destination))] = digest(target)
    budget.check()
    return files


def compiler_support(compiler):
    return {path.name: digest(path) for path in sorted((compiler.parent.parent / 'lib').iterdir())
            if path.is_file()}


def sandbox_profile(root):
    return '(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath ' + json.dumps(str(root.resolve())) + ') (literal "/dev/null"))'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', required=True, type=pathlib.Path)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if not args.execute:
        parser.error('Execution requires the explicit released K3 fixture slot; --execute never grants it')
    plan = json.loads(args.plan.read_text())
    compiler, cargo, identity = verify_compiler(plan)
    root = bounded.private_root(plan['root'])
    budget = bounded.Budget(root, 4 * 1024**3, 6 * 1024**3, 2 * 1024**3, 1200,
                            stop_bytes=3 * 1024**3, external_bytes=8192)
    result = None
    try:
        record = json.loads((source / 'native-source-closure.json').read_text())['rust-analyzer']
        archive = pathlib.Path(plan['sourceArchive'])
        if digest(archive) != record['sha256']:
            raise ValueError('Pinned source archive drift')
        staged_source = root / 'source'
        tree = extract(archive, staged_source, budget, record['sha256'])
        if digest(staged_source / 'Cargo.lock') != LOCK:
            raise ValueError('Frozen source lock drift')
        vendor = root / 'vendor'
        vendor.mkdir()
        packages = json.loads((source / 'rust-analyzer-crates.json').read_text())['packages']
        for package in packages:
            name = package['name'] + '-' + package['version']
            if '/' in name or '\\' in name or name.startswith('.'):
                raise ValueError('Unsafe registry identity')
            path = pathlib.Path(plan['crateDirectory']) / (name + '.crate')
            if digest(path) != package['sha256']:
                raise ValueError('Frozen crate archive drift')
            files = extract(path, vendor / name, budget, package['sha256'])
            checksum = vendor / name / '.cargo-checksum.json'
            if checksum.exists():
                raise ValueError('Unexpected preexisting vendor checksum')
            content = json.dumps({'package': package['sha256'], 'files': files})
            if len(content.encode()) > 1024**2:
                raise ValueError('Vendor checksum receipt exceeds per-package cap')
            budget.check(len(content.encode()))
            checksum.write_text(content)
        cargo_home = root / 'cargo-home'
        cargo_home.mkdir()
        config = '[source.crates-io]\nreplace-with="frozen-vendor"\n[source.frozen-vendor]\ndirectory=' + json.dumps(str(vendor)) + '\n'
        (cargo_home / 'config.toml').write_text(config)
        temporary = root / 'tmp'
        temporary.mkdir()
        profile = root / 'offline.sb'
        profile.write_text(sandbox_profile(root))
        sdk = pathlib.Path('/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk')
        if digest(sdk / 'SDKSettings.json') != '7b93ad7e534cc4b31c6a4e39d19b5e0288acf2168c2649479a796d1cb51939fb':
            raise ValueError('SDK metadata drift')
        linker = pathlib.Path(subprocess.run(['/usr/bin/xcrun', '--find', 'ld'], capture_output=True, text=True, check=True, timeout=5).stdout.strip())
        clang = pathlib.Path(subprocess.run(['/usr/bin/xcrun', '--find', 'clang'], capture_output=True, text=True, check=True, timeout=5).stdout.strip())
        wrapper = root / 'record-link'
        wrapper.write_text('#!' + str(pathlib.Path(sys.executable).resolve()) + '\n' + (source / 'record-rust-link.py').read_text())
        wrapper.chmod(0o700)
        sysroot = compiler.parent.parent / 'lib/rustlib/aarch64-apple-darwin/lib'
        helper = compiler.parent.parent / 'libexec/rust-analyzer-proc-macro-srv'
        inputs = {'compilerIdentity': identity, 'compilerSha256': digest(compiler), 'cargoSha256': digest(cargo),
                  'sdkMetadataSha256': digest(sdk / 'SDKSettings.json'), 'linkerSha256': digest(linker),
                  'linkerDriverSha256': digest(clang), 'linkerWrapperSha256': digest(wrapper),
                  'sdkScope': 'SDKSettings identity only; complete referenced SDK/native input closure remains unverified.',
                  'compilerSupport': compiler_support(compiler),
                  'workspaceConfigSha256': digest(staged_source / '.cargo/config.toml'),
                  'sysroot': {path.name: digest(path) for path in sorted(sysroot.iterdir()) if path.is_file()},
                  'developerProcMacroHelper': {'path': str(helper), 'sha256': digest(helper)} if helper.is_file() else None,
                  'sourceTree': tree, 'lockSha256': LOCK, 'configSha256': digest(cargo_home / 'config.toml'),
                  'defaultFeatures': True, 'target': 'aarch64-apple-darwin', 'packages': packages}
        content = json.dumps(inputs, indent=2)
        budget.check(len(content.encode()))
        if len(content.encode()) > 16 * 1024**2:
            raise ValueError('Build input receipt exceeds bounded cap')
        (root / 'build-inputs.json').write_text(content)
        environment = {'PATH': str(compiler.parent) + ':/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C',
                       'TMPDIR': str(temporary), 'CARGO_HOME': str(cargo_home),
                       'CARGO_TARGET_DIR': str(root / 'target'), 'CARGO_NET_OFFLINE': 'true',
                       'CARGO_BUILD_JOBS': '2', 'RUSTC': str(compiler), 'SDKROOT': str(sdk),
                       'CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER': str(wrapper),
                       'K3_LINK_ROOT': str(root), 'K3_CLANG': str(clang), 'K3_CLANG_SHA256': digest(clang)}
        verify_compiler(plan)
        budget.check()
        prefix = ['/usr/bin/sandbox-exec', '-f', str(profile), str(cargo)]
        metadata = bounded.run(prefix + ['metadata', '--frozen', '--offline', '--format-version', '1',
                                        '--filter-platform', 'aarch64-apple-darwin'], staged_source,
                               environment, budget, log_name='dependency-features.json', log_limit=16 * 1024**2)
        if metadata['exitCode'] != 0 or metadata['stopReason']:
            raise ValueError('Frozen dependency/features metadata failed: ' + str(metadata))
        parsed = json.loads((root / 'dependency-features.json').read_text())
        if not parsed.get('resolve'):
            raise ValueError('Actual resolved dependency/features closure missing')
        verify_compiler(plan)
        if inputs['developerProcMacroHelper'] is not None and digest(helper) != inputs['developerProcMacroHelper']['sha256']:
            raise ValueError('Developer proc-macro helper identity drift')
        if compiler_support(compiler) != inputs['compilerSupport']:
            raise ValueError('Compiler support-library drift')
        if {path.name: digest(path) for path in sorted(sysroot.iterdir()) if path.is_file()} != inputs['sysroot']:
            raise ValueError('Compiler sysroot drift before build')
        if digest(clang) != inputs['linkerDriverSha256'] or digest(wrapper) != inputs['linkerWrapperSha256']:
            raise ValueError('Linker driver/wrapper drift')
        if digest(linker) != inputs['linkerSha256'] or digest(sdk / 'SDKSettings.json') != inputs['sdkMetadataSha256']:
            raise ValueError('Linker/SDK drift before build')
        argv = ['/usr/bin/sandbox-exec', '-f', str(profile), str(cargo), 'build', '--frozen', '--offline',
                '--release', '-j', '2', '--target', 'aarch64-apple-darwin', '-p', 'rust-analyzer', '--bin', 'rust-analyzer']
        result = bounded.run(argv, staged_source, environment, budget)
        verify_compiler(plan)
        if inputs['developerProcMacroHelper'] is not None and digest(helper) != inputs['developerProcMacroHelper']['sha256']:
            raise ValueError('Developer proc-macro helper identity drift')
        if compiler_support(compiler) != inputs['compilerSupport']:
            raise ValueError('Compiler support-library drift')
        if {path.name: digest(path) for path in sorted(sysroot.iterdir()) if path.is_file()} != inputs['sysroot']:
            raise ValueError('Compiler sysroot drift during build')
        if digest(clang) != inputs['linkerDriverSha256'] or digest(wrapper) != inputs['linkerWrapperSha256']:
            raise ValueError('Linker driver/wrapper drift')
        if digest(linker) != inputs['linkerSha256'] or digest(sdk / 'SDKSettings.json') != inputs['sdkMetadataSha256']:
            raise ValueError('Linker/SDK drift during build')
        if result['peakBytes'] >= 4 * 1024**3 or result['lowestFreeBytesObserved'] < 2 * 1024**3:
            raise ValueError('Successful-attempt disk contract violated')
        if digest(staged_source / 'Cargo.lock') != LOCK:
            raise ValueError('Build mutated frozen lock')
        binary = root / 'target/aarch64-apple-darwin/release/rust-analyzer'
        if result['exitCode'] == 0 and result['stopReason'] is None:
            result['binarySha256'] = digest(binary)
            links = [json.loads(path.read_text()) for path in sorted((root / 'links').glob('*.json'))]
            matched = [row for row in links if row['output'] is not None
                       and pathlib.Path(row['output']).is_file()
                       and pathlib.Path(row['output']).name.startswith('rust_analyzer-')
                       and digest(pathlib.Path(row['output'])) == result['binarySha256']]
            if len(matched) != 1 or not pathlib.Path(matched[0]['map']).is_file():
                raise ValueError('Unique actual artifact link map missing')
            result['artifactLinkReceipt'] = {'output': matched[0]['output'], 'map': matched[0]['map'],
                                             'driverSha256': matched[0]['driverSha256']}
            result['allLinkReceiptRoots'] = {path.name: digest(path) for path in sorted((root / 'links').glob('*.json'))}
            result['artifactLinkMapSha256'] = digest(pathlib.Path(matched[0]['map']))
        result['status'] = 'fixture build only; no artifact approval, source-delivery or capability proof'
    except Exception as error:
        actual = bounded.usage(root) + budget.external_bytes
        result = {'error': str(error), 'status': 'fixture failed; no artifact readiness',
                  'finalBytes': actual, 'peakBytes': max(actual, budget.peak),
                  'lowestFreeBytesObserved': budget.lowest_free, 'externalReceiptBudgetBytes': budget.external_bytes,
                  'aggregateStopBytes': budget.stop_bytes, 'maximumSuccessfulBytes': budget.maximum,
                  'pollingOvershootLimitation': True, 'minimumResamplingIntervalSeconds': 0.1,
                  'maximumObservedSampleGapSeconds': budget.maximum_sample_gap,
                  'maximumScanSeconds': budget.maximum_scan_seconds, 'aggregateScanCount': budget.scan_count}
    receipt = json.dumps(result)
    if len(receipt.encode()) > 8192:
        receipt = json.dumps({'status': 'failed oversized receipt', 'finalBytes': bounded.usage(root)})
    print(receipt)
    try:
        budget.check(4096)
        (root / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    except ValueError:
        pass
    return 0 if result.get('exitCode') == 0 and not result.get('stopReason') else 1


if __name__ == '__main__':
    raise SystemExit(main())
