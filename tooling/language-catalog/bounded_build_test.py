"""Synthetic fault fixtures only: no compiler build or upstream source execution."""
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from importlib.machinery import SourceFileLoader

sys.dont_write_bytecode = True

source = pathlib.Path(__file__).resolve().parent
bounded = SourceFileLoader('bounded', str(source / 'bounded-build.py')).load_module()
stage = SourceFileLoader('stage', str(source / 'stage-rust-analyzer-build.py')).load_module()


class BoundedBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='k3-synthetic-build-', dir='/tmp')
        self.root = pathlib.Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def run_script(self, body, seconds=2, maximum=1024**2, file_limit=1024**2):
        budget = bounded.Budget(self.root, maximum, 0, 0, seconds)
        return bounded.run([sys.executable, '-c', body], self.root,
                           {'PATH': '/usr/bin:/bin'}, budget, file_limit=file_limit)

    def test_success_and_failure_groups_are_reaped(self):
        for code in [0, 7]:
            result = self.run_script('import sys; print("synthetic");sys.exit(' + str(code) + ')')
            self.assertEqual(result['exitCode'], code)
            self.assertTrue(result['processGroupReaped'])

    def test_deadline_kills_term_ignoring_process_and_descendant(self):
        result = self.run_script('import os,signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);os.fork();time.sleep(30)', seconds=0.2)
        self.assertIn('deadline', result['stopReason'])
        self.assertTrue(result['processGroupReaped'])

    def test_file_size_and_aggregate_bytes_stop_fault_fixture(self):
        result = self.run_script('with open("huge","wb") as stream: stream.write(b"x"*100000)', maximum=64000, file_limit=32000)
        self.assertNotEqual(result['exitCode'], 0)
        (self.root / 'huge').unlink()
        result = self.run_script('import time,pathlib\nfor n in range(100):\n pathlib.Path(str(n)).write_bytes(b"x"*16384)\n time.sleep(.03)', maximum=64000)
        print('Synthetic aggregate polling receipt:', json.dumps(result))
        self.assertIn('budget', result['stopReason'])
        self.assertTrue(result['processGroupReaped'])

    def test_initial_and_runtime_free_space_guards(self):
        with self.assertRaisesRegex(ValueError, 'Initial free-space'):
            bounded.Budget(self.root, 1024, 10**30, 0, 1)
        budget = bounded.Budget(self.root, 1024, 0, 10**30, 1)
        with self.assertRaisesRegex(ValueError, 'Unsafe free-space'):
            budget.check()

    def test_archives_reject_traversal_and_links(self):
        for index, name in enumerate(['root/../escape', '/root/absolute', 'root/link']):
            archive = self.root / ('fixture' + str(index) + '.tar.gz')
            with tarfile.open(archive, 'w:gz') as stream:
                info = tarfile.TarInfo(name)
                if name.endswith('link'):
                    info.type = tarfile.SYMTYPE
                    info.linkname = '/outside'
                    stream.addfile(info)
                else:
                    info.size = 1
                    stream.addfile(info, io.BytesIO(b'x'))
            budget = bounded.Budget(self.root, 1024**2, 0, 0, 2)
            with self.assertRaisesRegex(ValueError, 'Unsafe|Escaping|links'):
                stage.extract(archive, self.root / ('output' + str(index)), budget)

    def test_archive_keeps_internal_legal_symlink(self):
        path = self.root / 'internal.tar.gz'
        with tarfile.open(path, 'w:gz') as stream:
            file = tarfile.TarInfo('root/LICENSE')
            file.size = 7
            stream.addfile(file, io.BytesIO(b'license'))
            link = tarfile.TarInfo('root/legal-link')
            link.type = tarfile.SYMTYPE
            link.linkname = 'LICENSE'
            stream.addfile(link)
        output = self.root / 'internal'
        budget = bounded.Budget(self.root, 1024**2, 0, 0, 2)
        files = stage.extract(path, output, budget)
        self.assertEqual(files['legal-link'], files['LICENSE'])
        budget.check()

    def test_slow_scan_does_not_rescan_every_staged_file(self):
        clock = [0.0]
        calls = []
        def scan(root):
            calls.append(root)
            clock[0] += 0.25
            return 128
        with patch.object(bounded.time, 'monotonic', side_effect=lambda: clock[0]), patch.object(bounded, 'usage', side_effect=scan):
            budget = bounded.Budget(self.root, 1024, 0, 0, 2)
            for _ in range(3):
                budget.check()
            self.assertEqual(len(calls), 1)
            self.assertEqual(budget.maximum_scan_seconds, 0.25)
            clock[0] += 0.11
            budget.check()
            self.assertEqual(len(calls), 2)
            clock[0] = 3
            with self.assertRaisesRegex(ValueError, 'deadline'):
                budget.check()

    def synthetic_archive(self, name='stage-fault.tar.gz'):
        path = self.root / name
        with tarfile.open(path, 'w:gz') as stream:
            for name in ['first', 'second']:
                info = tarfile.TarInfo('root/' + name)
                info.size = 128
                stream.addfile(info, io.BytesIO(b'x' * 128))
        return path

    def test_growth_during_slow_scan_fails_while_staging(self):
        archive = self.synthetic_archive()
        clock = [0.0]
        first = [True]
        original_usage = bounded.usage
        original_digest = stage.digest
        def growing_scan(root):
            observed = original_usage(root)
            if first[0]:
                first[0] = False
                (self.root / 'synthetic-growth').write_bytes(b'x' * 65536)
                clock[0] += 0.25
            return observed
        def finish_file(path):
            value = original_digest(path)
            clock[0] += 0.11
            return value
        with patch.object(bounded.time, 'monotonic', side_effect=lambda: clock[0]), patch.object(bounded, 'usage', side_effect=growing_scan), patch.object(stage, 'digest', side_effect=finish_file):
            budget = bounded.Budget(self.root, 64000, 0, 0, 2, stop_bytes=48000, external_bytes=1024)
            with self.assertRaisesRegex(ValueError, 'byte budget'):
                stage.extract(archive, self.root / 'staged', budget)
            self.assertGreaterEqual(budget.peak, budget.maximum)
            self.assertFalse((self.root / 'staged/second').exists())
            print('Synthetic staging growth receipt:', json.dumps({'peakBytes': budget.peak, 'maximumSuccessfulBytes': budget.maximum, 'overshootBytes': budget.peak - budget.maximum, 'maximumScanSeconds': budget.maximum_scan_seconds, 'maximumObservedSampleGapSeconds': budget.maximum_sample_gap, 'externalReceiptBudgetBytes': budget.external_bytes, 'failedWhileStaging': True}))

    def test_deadline_and_free_floor_fail_before_staged_file_write(self):
        archive = self.synthetic_archive()
        clock = [0.0]
        original = bounded.usage
        def slow_scan(root):
            result = original(root)
            clock[0] += 2
            return result
        with patch.object(bounded.time, 'monotonic', side_effect=lambda: clock[0]), patch.object(bounded, 'usage', side_effect=slow_scan):
            budget = bounded.Budget(self.root, 1024**2, 0, 0, 1)
            with self.assertRaisesRegex(ValueError, 'deadline'):
                stage.extract(archive, self.root / 'deadline-stage', budget)
        self.assertFalse((self.root / 'deadline-stage/first').exists())
        with patch.object(bounded.shutil, 'disk_usage', return_value=SimpleNamespace(free=0)):
            budget = bounded.Budget(self.root, 1024**2, 0, 1024, 2)
            with self.assertRaisesRegex(ValueError, 'free-space floor'):
                stage.extract(archive, self.root / 'free-stage', budget)
            self.assertEqual(budget.lowest_free, 0)
        self.assertFalse((self.root / 'free-stage/first').exists())

    def test_slow_scan_growth_and_deadline_stop_synthetic_compilers(self):
        original = bounded.usage
        for fault in ['growth', 'deadline']:
            calls = [0]
            def slow_scan(root):
                observed = original(root)
                calls[0] += 1
                if calls[0] == 2:
                    time.sleep(0.2)
                return observed
            budget = bounded.Budget(self.root, 64000 if fault == 'growth' else 1024**2, 0, 0, 2 if fault == 'growth' else 0.25, stop_bytes=48000 if fault == 'growth' else 1024**2)
            body = ('import pathlib,time\nfor n in range(100):\n pathlib.Path("growth-"+str(n)).write_bytes(b"x"*16384)\n time.sleep(.01)' if fault == 'growth' else 'import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)')
            with patch.object(bounded, 'usage', side_effect=slow_scan):
                result = bounded.run([sys.executable, '-c', body], self.root, {'PATH': '/usr/bin:/bin'}, budget, log_name=fault + '.log')
            self.assertIn('byte budget' if fault == 'growth' else 'deadline', result['stopReason'])
            self.assertTrue(result['processGroupReaped'])
            print('Synthetic compiler fault receipt:', fault, json.dumps(result))
            for path in self.root.glob('growth-*'):
                path.unlink()

    def test_free_floor_stops_and_reaps_synthetic_compiler(self):
        def disk(root):
            return SimpleNamespace(free=0 if (self.root / 'compiler-started').exists() else 1000000)
        with patch.object(bounded.shutil, 'disk_usage', side_effect=disk):
            budget = bounded.Budget(self.root, 1024**2, 0, 1024, 2)
            body = 'import pathlib,time;pathlib.Path("compiler-started").write_text("synthetic");time.sleep(30)'
            result = bounded.run([sys.executable, '-c', body], self.root, {'PATH': '/usr/bin:/bin'}, budget)
        self.assertIn('free-space floor', result['stopReason'])
        self.assertEqual(result['lowestFreeBytesObserved'], 0)
        self.assertTrue(result['processGroupReaped'])

    def test_unique_link_maps_and_driver_drift(self):
        driver = self.root / 'synthetic-linker'
        driver.write_text('#!' + sys.executable + '\nimport pathlib,sys\n'
                          'pathlib.Path(sys.argv[-1].split(",",2)[2]).write_text("synthetic map")\n')
        driver.chmod(0o700)
        env = {'PATH': '/usr/bin:/bin', 'K3_LINK_ROOT': str(self.root),
               'K3_CLANG': str(driver), 'K3_CLANG_SHA256': hashlib.sha256(driver.read_bytes()).hexdigest()}
        command = [sys.executable, str(source / 'record-rust-link.py'), '-o', str(self.root / 'synthetic-output')]
        for _ in range(2):
            result = subprocess.run(command, env=env, capture_output=True, timeout=2)
            self.assertEqual(result.returncode, 0, result.stderr)
        records = [json.loads(p.read_text()) for p in (self.root / 'links').glob('*.json')]
        self.assertEqual(len(records), 2)
        self.assertNotEqual(records[0]['map'], records[1]['map'])
        self.assertTrue(all(pathlib.Path(row['map']).read_text() == 'synthetic map' for row in records))
        driver.write_text('drift')
        self.assertNotEqual(subprocess.run(command, env=env, capture_output=True, timeout=2).returncode, 0)

    @unittest.skipUnless(sys.platform == 'darwin', 'Darwin execution sandbox fixture')
    def test_sandbox_denies_network_and_external_writes(self):
        profile = self.root / 'synthetic.sb'
        profile.write_text(stage.sandbox_profile(self.root))
        external = self.root.parent / (self.root.name + '-forbidden')
        body = ('import pathlib,socket\n'
                'pathlib.Path("allowed").write_text("synthetic")\n'
                'try: pathlib.Path(' + repr(str(external)) + ').write_text("forbidden")\n'
                'except PermissionError: pass\n'
                'else: raise RuntimeError("external write escaped")\n'
                'try: socket.socket().bind(("127.0.0.1",0))\n'
                'except PermissionError: pass\n'
                'else: raise RuntimeError("network escaped")\n')
        budget = bounded.Budget(self.root, 1024**2, 0, 0, 2)
        result = bounded.run(['/usr/bin/sandbox-exec', '-f', str(profile), sys.executable, '-c', body],
                             self.root, {'PATH': '/usr/bin:/bin'}, budget)
        self.assertEqual(result['exitCode'], 0, (self.root / 'build.log').read_text())
        self.assertFalse(external.exists())
        self.assertTrue(result['processGroupReaped'])

    def test_compiler_commit_and_digest_drift_fail_before_staging(self):
        compiler = self.root / 'rustc'
        compiler.write_text('#!/bin/sh\nprintf "host: aarch64-apple-darwin\\ncommit-hash: wrong\\n"\n')
        compiler.chmod(0o700)
        digest = hashlib.sha256(compiler.read_bytes()).hexdigest()
        plan = {'environment': {'RUSTC': str(compiler)}, 'argv': [str(compiler)],
                'compilerSha256': digest, 'cargoSha256': digest}
        with self.assertRaisesRegex(ValueError, 'commit/target drift'):
            stage.verify_compiler(plan)
        compiler.write_text('changed')
        with self.assertRaisesRegex(ValueError, 'digest drift'):
            stage.verify_compiler(plan)


if __name__ == '__main__':
    unittest.main()
