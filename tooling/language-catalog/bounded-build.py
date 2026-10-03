"""Run disposable offline builds with private writes, deadlines, disk guards and group cleanup."""
import argparse
import json
import os
import pathlib
import resource
import shutil
import signal
import stat
import subprocess
import threading
import time


def private_root(path):
    root = pathlib.Path(path).resolve()
    temporary = pathlib.Path('/tmp').resolve()
    if root == temporary or not root.is_relative_to(temporary) or root.exists():
        raise ValueError('Fresh canonical private temporary root required')
    root.mkdir(mode=0o700)
    return root


def usage(root):
    root = root.resolve()
    logical = allocated = 0
    pending = [root]
    while pending:
        directory = pending.pop()
        try:
            with os.scandir(directory) as entries:
                for entry in entries:
                    try:
                        info = entry.stat(follow_symlinks=False)
                    except FileNotFoundError:
                        continue
                    if stat.S_ISLNK(info.st_mode):
                        if not pathlib.Path(entry.path).resolve().is_relative_to(root):
                            raise ValueError('Fixture symlink is not permitted')
                    elif stat.S_ISDIR(info.st_mode):
                        pending.append(pathlib.Path(entry.path))
                    logical += info.st_size
                    allocated += info.st_blocks * 512
        except FileNotFoundError:
            continue
    return max(logical, allocated)


class Budget:
    def __init__(self, root, maximum, minimum_free, stop_free, seconds, stop_bytes=None, external_bytes=0):
        self.root = root.resolve()
        self.maximum = maximum
        self.stop_bytes = maximum if stop_bytes is None else stop_bytes
        self.external_bytes = external_bytes
        self.stop_free = stop_free
        self.deadline = time.monotonic() + seconds
        self.peak = 0
        self.last_sample = None
        self.sample_bytes = 0
        self.maximum_sample_gap = 0
        self.maximum_scan_seconds = 0
        self.scan_count = 0
        self.measurement_lock = threading.Lock()
        self.lowest_free = shutil.disk_usage(root).free
        if self.lowest_free < minimum_free:
            raise ValueError('Initial free-space minimum is not met')

    def check(self, extra=0):
        with self.measurement_lock:
            now = time.monotonic()
            if self.last_sample is None or now - self.last_sample >= 0.1:
                previous_sample = self.last_sample
                self.sample_bytes = usage(self.root) + self.external_bytes
                self.peak = max(self.peak, self.sample_bytes)
                self.lowest_free = min(self.lowest_free, shutil.disk_usage(self.root).free)
                self.last_sample = time.monotonic()
                if previous_sample is not None:
                    self.maximum_sample_gap = max(self.maximum_sample_gap, self.last_sample - previous_sample)
                self.maximum_scan_seconds = max(self.maximum_scan_seconds, self.last_sample - now)
                self.scan_count += 1
            if self.sample_bytes + extra >= self.stop_bytes:
                raise ValueError('Aggregate fixture byte budget exceeded')
            free = shutil.disk_usage(self.root).free
            self.lowest_free = min(self.lowest_free, free)
            if free - extra < self.stop_free:
                raise ValueError('Unsafe free-space floor')
            if time.monotonic() >= self.deadline:
                raise ValueError('Fixture deadline exceeded')


def alive(group):
    try:
        os.killpg(group, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def reap(process):
    for kind, seconds in [(signal.SIGTERM, 0.5), (signal.SIGKILL, 2)]:
        try:
            os.killpg(process.pid, kind)
        except ProcessLookupError:
            pass
        except PermissionError:
            pass
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline and alive(process.pid):
            process.poll()
            time.sleep(0.01)
    process.wait(timeout=2)
    if alive(process.pid):
        raise ValueError('Fixture process group still exists after cleanup')


def run(argv, cwd, environment, budget, file_limit=256 * 1024**2,
        log_name='build.log', log_limit=1024**2):
    budget.check()
    errors = []
    if pathlib.PurePath(log_name).name != log_name:
        raise ValueError('Private simple log filename required')
    log_path = budget.root / log_name

    def limits():
        resource.setrlimit(resource.RLIMIT_FSIZE, (file_limit, file_limit))

    process = subprocess.Popen(argv, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               start_new_session=True, preexec_fn=limits)

    def output():
        try:
            with log_path.open('wb') as stream:
                retained = 0
                while True:
                    data = process.stdout.read(4096)
                    if not data:
                        break
                    if retained + len(data) <= log_limit:
                        budget.check(len(data))
                        stream.write(data)
                        stream.flush()
                        retained += len(data)
        except Exception as error:
            errors.append(str(error))

    thread = threading.Thread(target=output, daemon=True)
    thread.start()
    reason = None
    try:
        while process.poll() is None:
            budget.check()
            if errors:
                raise ValueError(errors[0])
            time.sleep(0.1)
        budget.check()
        if errors:
            raise ValueError(errors[0])
    except Exception as error:
        reason = str(error)
    finally:
        try:
            reap(process)
        finally:
            thread.join(timeout=3)
            process.stdout.close()
            if thread.is_alive():
                raise ValueError('Fixture output reader still exists after cleanup')
    final_scan_started = time.monotonic()
    final_bytes = usage(budget.root) + budget.external_bytes
    final_sample = time.monotonic()
    budget.maximum_scan_seconds = max(budget.maximum_scan_seconds, final_sample - final_scan_started)
    if budget.last_sample is not None:
        budget.maximum_sample_gap = max(budget.maximum_sample_gap, final_sample - budget.last_sample)
    budget.scan_count += 1
    budget.peak = max(budget.peak, final_bytes)
    budget.lowest_free = min(budget.lowest_free, shutil.disk_usage(budget.root).free)
    if final_bytes >= budget.stop_bytes and reason is None:
        reason = 'Aggregate fixture byte budget exceeded'
    if budget.lowest_free < budget.stop_free and reason is None:
        reason = 'Unsafe free-space floor'
    return {'exitCode': process.returncode, 'stopReason': reason, 'peakBytes': budget.peak,
            'finalBytes': final_bytes,
            'maximumSuccessfulBytes': budget.maximum, 'aggregateStopBytes': budget.stop_bytes,
            'lowestFreeBytesObserved': budget.lowest_free, 'externalReceiptBudgetBytes': budget.external_bytes,
            'minimumResamplingIntervalSeconds': 0.1, 'maximumObservedSampleGapSeconds': budget.maximum_sample_gap,
            'maximumScanSeconds': budget.maximum_scan_seconds, 'aggregateScanCount': budget.scan_count,
            'processGroupReaped': not alive(process.pid)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--synthetic', action='store_true')
    parser.add_argument('--root', required=True)
    parser.add_argument('--seconds', type=float, default=2)
    parser.add_argument('--bytes', type=int, default=1024**2)
    parser.add_argument('argv', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.synthetic:
        parser.error('This entry point is synthetic only; real staging must use reviewed immutable inputs')
    root = private_root(args.root)
    budget = Budget(root, args.bytes, 0, 0, args.seconds)
    argv = args.argv[1:] if args.argv[:1] == ['--'] else args.argv
    result = run(argv, root, {'PATH': '/usr/bin:/bin', 'TMPDIR': str(root)}, budget,
                 file_limit=min(args.bytes, 256 * 1024**2))
    print(json.dumps(result))
    return 0 if result['exitCode'] == 0 and not result['stopReason'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
