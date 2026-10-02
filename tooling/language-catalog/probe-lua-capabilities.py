"""Real Lua feature probes in an isolated Project; server sources remain outside its scope."""
import argparse
import hashlib
import json
import pathlib
import queue
import threading
import time
from fixture import environment, start, stop, temporary_root


def staged_identity(server):
    tooling = pathlib.Path(__file__).resolve().parent
    catalog = json.loads((tooling / '../../apps/daemon/src/languages/catalog/catalog.json').read_text())
    tool = next(row for row in catalog['tools'] if row['id'] == 'lua-language-server')
    artifact = next(row for row in tool['artifacts'] if row['id'] == server.name)
    descriptor = artifact['packaging']
    data = (tooling / descriptor['manifest']).read_bytes()
    assert 'sha256:' + hashlib.sha256(data).hexdigest() == descriptor['manifestIntegrity']
    manifest = json.loads(data)
    files = []
    for path in server.rglob('*'):
        if path.is_symlink():
            raise ValueError('Unexpected staged symbolic link')
        if path.is_file():
            content = path.read_bytes()
            files.append({'path': path.relative_to(server).as_posix(),
                          'integrity': 'sha256:' + hashlib.sha256(content).hexdigest(),
                          'size': len(content), 'mode': path.stat().st_mode & 0o777})
    files.sort(key=lambda row: row['path'].encode('utf8'))
    root = 'sha256:' + hashlib.sha256(json.dumps(files, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    assert root == descriptor['postFilterIntegrity'] and files == manifest['files']
    assert not any(row['path'].startswith('meta/3rd/') for row in files)
    return {'filter': descriptor['filter'], 'sourceIntegrity': descriptor['sourceIntegrity'],
            'postFilterIntegrity': root, 'retainedFilesVerified': len(files), 'thirdPartyAnnotationsPresent': False}


def probe(server, root):
    packaging = staged_identity(server)
    workspace = root / 'project'
    workspace.mkdir(parents=True, exist_ok=False)
    config = root / 'lua-config.lua'
    config.write_text('return { ["workspace.checkThirdParty"] = false, ["workspace.library"] = {}, ["telemetry.enable"] = false }\n')
    command = [str(server / 'bin/lua-language-server'), '--configpath=' + str(config),
               '--logpath=' + str(root / 'logs'), '--metapath=' + str(root / 'generated-meta')]
    env = environment(root)
    process = start(command, workspace, env)
    messages = queue.Queue()
    observed = []
    errors = []

    def receive():
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

    def stderr():
        for line in process.stderr:
            errors.append(line.decode(errors='replace'))

    readers = [threading.Thread(target=receive, daemon=True), threading.Thread(target=stderr, daemon=True)]
    for reader in readers:
        reader.start()

    def send(message):
        content = json.dumps(dict(jsonrpc='2.0', **message)).encode()
        process.stdin.write(('Content-Length: %s\r\n\r\n' % len(content)).encode() + content)
        process.stdin.flush()

    def next_message(deadline):
        item = messages.get(timeout=max(0.001, deadline - time.monotonic()))
        observed.append(item)
        if 'id' in item and 'method' in item:
            result = None
            if item['method'] == 'workspace/configuration':
                values = {'Lua': {'workspace': {'checkThirdParty': False, 'library': []}}, 'files.exclude': {}}
                result = [values.get(part.get('section'), {}) for part in item['params']['items']]
            send({'id': item['id'], 'result': result})
        return item

    def response(request_id):
        deadline = time.monotonic() + 20
        while True:
            item = next_message(deadline)
            if item.get('id') == request_id and 'method' not in item:
                if 'error' in item:
                    raise RuntimeError(item['error'])
                return item

    def request(request_id, method, params):
        send({'id': request_id, 'method': method, 'params': params})
        return response(request_id)

    uri = (workspace / 'features.lua').as_uri()
    document = {'uri': uri}
    try:
        initialized = request(1, 'initialize', {'processId': None, 'rootUri': workspace.as_uri(),
            'workspaceFolders': [{'uri': workspace.as_uri(), 'name': 'temporary-project'}],
            'capabilities': {'workspace': {'configuration': True}, 'textDocument': {'publishDiagnostics': {}}}})
        send({'method': 'initialized', 'params': {}})
        send({'method': 'textDocument/didOpen', 'params': {'textDocument': {
            'uri': uri, 'languageId': 'lua', 'version': 1, 'text': 'local x = string.'}}})
        deadline = time.monotonic() + 15
        identifier = 10
        while True:
            completion = request(identifier, 'textDocument/completion', {'textDocument': document,
                                  'position': {'line': 0, 'character': len('local x = string.')}})
            items = completion.get('result') or []
            if isinstance(items, dict):
                items = items['items']
            if any(item.get('insertText') == 'sub' and item['label'].startswith('sub(') for item in items):
                break
            if time.monotonic() >= deadline:
                raise AssertionError('Template-backed string.sub member completion missing')
            identifier += 1
            time.sleep(0.1)
        send({'method': 'textDocument/didChange', 'params': {'textDocument': {'uri': uri, 'version': 2},
              'contentChanges': [{'text': "local x = string.sub('abc', 1, 2)\nlocal broken =\n"}]}})
        hover = request(100, 'textDocument/hover', {'textDocument': document, 'position': {'line': 0, 'character': 19}})
        assert 'sub' in json.dumps(hover.get('result')) and 'string' in json.dumps(hover.get('result')), 'Typed member hover missing'
        deadline = time.monotonic() + 15
        while True:
            diagnostics = [item for item in observed if item.get('method') == 'textDocument/publishDiagnostics'
                           and item['params']['uri'] == uri]
            matching = [item for item in diagnostics if any(d.get('severity') == 1 and d['range']['start']['line'] == 1 for d in item['params']['diagnostics'])]
            if matching:
                diagnostic = matching[-1]
                break
            next_message(deadline)
        send({'method': 'textDocument/didChange', 'params': {'textDocument': {'uri': uri, 'version': 3},
              'contentChanges': [{'text': "local x=string.sub('abc',1,2)\n"}]}})
        formatting = request(101, 'textDocument/formatting', {'textDocument': document,
                             'options': {'tabSize': 2, 'insertSpaces': True}})
        assert formatting.get('result'), 'Formatting edits missing'
        shutdown = request(102, 'shutdown', None)
        send({'method': 'exit', 'params': None})
        process.wait(timeout=5)
        cleanup = stop(process)
        return {'initialized': initialized, 'memberCompletion': completion, 'memberHover': hover,
                'diagnostic': diagnostic, 'formatting': formatting, 'shutdown': shutdown,
                'exitCode': process.returncode, 'cleanup': cleanup, 'environmentKeys': sorted(env),
                'command': command, 'workspaceUri': workspace.as_uri(), 'documentUri': uri,
                'scope': 'Darwin arm64 real features only; server sources, locale and metadata outside Project scope',
                'stderr': ''.join(errors)[-4000:], 'packaging': packaging}
    finally:
        (root / 'observed.json').write_text(json.dumps(observed, indent=2) + '\n')
        stop(process)
        for reader in readers:
            reader.join(timeout=1)
            if reader.is_alive():
                raise RuntimeError('Fixture reader survived cleanup')
        for pipe in (process.stdin, process.stdout, process.stderr):
            pipe.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--server', required=True, type=pathlib.Path)
    parser.add_argument('--root', required=True, type=temporary_root)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    args = parser.parse_args()
    args.root.mkdir(parents=True, exist_ok=False)
    args.output.write_text(json.dumps(probe(args.server.resolve(), args.root), indent=2) + '\n')
    print('Template-backed member completion/hover, diagnostic and formatting passed.')
