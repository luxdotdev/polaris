"""Opt-in, disposable stdio probes. Requires already-installed pinned fixtures in --root."""
import argparse
import json
import os
import pathlib
import queue
import threading
import time
from fixture import temporary_root, server_environment, start, stop


def exchange(command, cwd, language, text, settings, options=None):
    env = server_environment(cwd)
    process = start(command, cwd, env)
    messages = queue.Queue()
    stderr = []

    def receive():
        try:
            while True:
                headers = {}
                while True:
                    line = process.stdout.readline()
                    if not line:
                        return
                    if line == b'\r\n':
                        break
                    key, value = line.decode().split(':', 1)
                    headers[key.lower()] = value.strip()
                messages.put(json.loads(process.stdout.read(int(headers['content-length']))))
        except (ValueError, KeyError) as error:
            messages.put({'framingError': str(error)})

    def errors():
        for line in process.stderr:
            stderr.append(line.decode(errors='replace'))

    readers = [threading.Thread(target=receive, daemon=True), threading.Thread(target=errors, daemon=True)]
    for reader in readers:
        reader.start()

    def send(message):
        body = json.dumps(dict(jsonrpc='2.0', **message)).encode()
        process.stdin.write(('Content-Length: %s\r\n\r\n' % len(body)).encode() + body)
        process.stdin.flush()

    observed = []

    def response(request_id, seconds=20):
        deadline = time.monotonic() + seconds
        while True:
            item = messages.get(timeout=max(0.001, deadline - time.monotonic()))
            observed.append(item)
            if item.get('id') == request_id and 'method' not in item:
                return item
            if 'id' in item and 'method' in item:
                method = item['method']
                result = None
                if method == 'workspace/configuration':
                    result = [settings.get(part.get('section'), {}) for part in item['params']['items']]
                if method == 'workspace/applyEdit':
                    result = {'applied': False, 'failureReason': 'Probe never applies edits'}
                send({'id': item['id'], 'result': result})
            if time.monotonic() >= deadline:
                raise TimeoutError('server deadline')

    try:
        send({'id': 1, 'method': 'initialize', 'params': {
            'processId': os.getpid(), 'rootUri': settings.get('_workspaceRoot'), 'rootPath': None, 'workspaceFolders': None,
            'capabilities': {'workspace': {'configuration': True}, 'textDocument': {
                'publishDiagnostics': {'relatedInformation': True}}},
            'initializationOptions': options or {}}})
        initialized = response(1)
        if 'error' in initialized:
            raise RuntimeError(initialized['error'])
        send({'method': 'initialized', 'params': {}})
        uri = (cwd / ('test.yaml' if language == 'yaml' else 'test.sql')).as_uri()
        send({'method': 'textDocument/didOpen', 'params': {'textDocument': {
            'uri': uri, 'languageId': language, 'version': 1, 'text': text}}})
        send({'id': 2, 'method': 'textDocument/completion', 'params': {
            'textDocument': {'uri': uri}, 'position': {'line': 0, 'character': 3}}})
        completion = response(2)
        extra = {}
        if any('actions-languageserver' in part for part in command):
            deadline = time.monotonic() + 10
            while not any(item.get('method') == 'textDocument/publishDiagnostics' for item in observed):
                item = messages.get(timeout=max(0.001, deadline - time.monotonic()))
                observed.append(item)
                if 'id' in item and 'method' in item:
                    send({'id': item['id'], 'result': None})
        if 'diagnosticProvider' in initialized['result']['capabilities']:
            send({'id': 4, 'method': 'textDocument/diagnostic', 'params': {'textDocument': {'uri': uri}}})
            extra['diagnostics'] = response(4)
            send({'id': 5, 'method': 'textDocument/hover', 'params': {'textDocument': {'uri': uri}, 'position': {'line': 0, 'character': 13}}})
            extra['hover'] = response(5)
        send({'id': 3, 'method': 'shutdown', 'params': None})
        shutdown = response(3)
        send({'method': 'exit', 'params': None})
        process.wait(timeout=5)
        return {'command': command, 'initialized': initialized, 'completion': completion,
                'shutdown': shutdown, **extra, 'messages': observed, 'exitCode': process.returncode,
                'stderr': ''.join(stderr)[-4000:], 'environmentKeys': sorted(env),
                'cleanup': stop(process)}
    finally:
        stop(process)
        for reader in readers:
            reader.join(timeout=1)
            if reader.is_alive():
                raise RuntimeError('Fixture reader survived cleanup')
        process.stdin.close()
        process.stdout.close()
        process.stderr.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=pathlib.Path)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    args = parser.parse_args()
    root = temporary_root(args.root)
    if root not in args.output.resolve().parents:
        parser.error('Evidence output must be inside fixture root')
    cwd = root / 'smoke'
    cwd.mkdir(parents=True, exist_ok=True)
    # This project configuration must never be loaded by the rootless SQL probe.
    (cwd / '.sqllsrc.json').write_text(json.dumps({'adapter': 'postgres', 'host': '127.0.0.1',
                                                 'port': 1, 'database': 'canary'}))
    (cwd / '.sqllens.json').write_text(json.dumps({'default': 'postgres', 'schema': 'schema.json'}))
    (cwd / 'schema.json').write_text(json.dumps({'users': {'id': 'integer', 'name': 'text'}}))
    npm = root / 'npm'
    probes = {
        'sql': (['node', str(npm / 'sql-language-server/node_modules/sql-language-server/npm_bin/cli.js'),
                 'up', '--method', 'stdio'], 'sql', 'SELECT 1;', {'sqlLanguageServer': {'connections': []}}),
        'actions': (['node', str(npm / '@actions_languageserver/node_modules/@actions/languageserver/bin/actions-languageserver'),
                     '--stdio'], 'yaml', 'name: test\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ invalid.context }}\n', {}),
        'sqllens-schema': (['node', str(npm / 'sqllens-language-server/node_modules/sqllens-language-server/bin/cli.js'), '--stdio'], 'sql-postgres', 'SELECT users.id FROM users;', {'_workspaceRoot': cwd.as_uri()}),
        'sqllens-mysql': (['node', str(npm / 'sqllens-language-server/node_modules/sqllens-language-server/bin/cli.js'), '--stdio'], 'sql-mysql', 'SELECT 1::integer;', {}),
        'sqllens-postgres': (['node', str(npm / 'sqllens-language-server/node_modules/sqllens-language-server/bin/cli.js'), '--stdio'], 'sql-postgres', 'SELECT 1::integer;', {}),
        'sqllens': (['node', str(npm / 'sqllens-language-server/node_modules/sqllens-language-server/bin/cli.js'), '--stdio'], 'sql', 'SELECT 1;', {}),
        'bash': (['node', str(npm / 'bash-language-server/node_modules/bash-language-server/out/cli.js'),
                  'start'], 'shellscript', '#!/bin/bash\necho hello\n', {'bashIde': {'shellcheckPath': '', 'shfmt': {'path': ''}}}),
    }
    results = {}
    for name, (command, language, text, settings) in probes.items():
        try:
            results[name] = exchange(command, cwd, language, text, settings)
            print(name, 'initialized', results[name]['exitCode'], flush=True)
        except Exception as error:
            results[name] = {'failure': str(error), 'command': command}
            print(name, 'failed', str(error), flush=True)
    args.output.write_text(json.dumps(results, indent=2) + '\n')
    if not any('failure' in result for result in results.values()):
        assert not results['sqllens-postgres']['diagnostics']['result']['items']
        assert results['sqllens-mysql']['diagnostics']['result']['items'][0]['severity'] == 1
        assert 'users.id' in results['sqllens-schema']['hover']['result']['contents']['value']
        assert 'int' in results['sqllens-schema']['hover']['result']['contents']['value']
        assert results['sql']['completion']['result'][0]['label'] == 'SELECT'
        assert results['actions']['initialized']['result']['capabilities']['hoverProvider']
        assert any(item.get('method') == 'textDocument/publishDiagnostics' and item['params']['diagnostics'] for item in results['actions']['messages'])
    if any('failure' in result for result in results.values()):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
