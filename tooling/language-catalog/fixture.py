"""Explicit fixture paths/environments and bounded POSIX process-group cleanup."""
import os
import pathlib
import signal
import subprocess
import time


def temporary_root(value):
    root = pathlib.Path(value).resolve()
    temporary = pathlib.Path('/tmp').resolve()
    if root == temporary or temporary not in root.parents:
        raise ValueError('Evaluation root must be below canonical /tmp')
    return root


def environment(root):
    paths = {name: root / name for name in ('tmp', 'config', 'cache', 'state')}
    for path in paths.values():
        path.mkdir(parents=True, exist_ok=True)
    return {'PATH': os.environ.get('PATH', os.defpath),
            'TMPDIR': str(paths['tmp']), 'TMP': str(paths['tmp']), 'TEMP': str(paths['tmp']),
            'XDG_CONFIG_HOME': str(paths['config']), 'XDG_CACHE_HOME': str(paths['cache']),
            'XDG_STATE_HOME': str(paths['state'])}


def npm_environment(root):
    env = environment(root)
    for name in ('user.npmrc', 'global.npmrc'):
        (root / 'config' / name).write_text('')
    env.update(npm_config_userconfig=str(root / 'config/user.npmrc'),
               npm_config_globalconfig=str(root / 'config/global.npmrc'),
               npm_config_cache=str(root / 'cache'), npm_config_prefix=str(root / 'prefix'),
               npm_config_registry='https://registry.npmjs.org/', npm_config_update_notifier='false')
    return env


def server_environment(root):
    env = environment(root)
    config = root / 'config/sqllens.json'
    config.write_text('{}\n')
    env.update(SQLLENS_NO_PLUGINS='1', SQLLENS_USER_CONFIG=str(config))
    return env


def start(command, cwd, env):
    if os.name != 'posix':
        raise RuntimeError('Fixture group cleanup requires macOS or Linux')
    return subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True,
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def group_exists(pid):
    try:
        os.kill(-pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def stop(process):
    for sig, seconds in ((signal.SIGTERM, 1), (signal.SIGKILL, 2)):
        try:
            os.kill(-process.pid, sig)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + seconds
        while group_exists(process.pid) and time.monotonic() < deadline:
            process.poll()
            time.sleep(0.02)
        if not group_exists(process.pid):
            process.wait(timeout=1)
            return {'pid': process.pid, 'groupReaped': True}
    raise RuntimeError('Fixture process group survived bounded cleanup')


def run(command, cwd, env, seconds):
    process = start(command, cwd, env)
    try:
        stdout, stderr = process.communicate(timeout=seconds)
        return subprocess.CompletedProcess(command, process.returncode, stdout.decode(), stderr.decode())
    finally:
        try:
            stop(process)
        finally:
            for pipe in (process.stdin, process.stdout, process.stderr):
                pipe.close()
