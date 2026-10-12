"""Isolated fixtures and /proc measurements for the opt-in lucas-rpi acceptance."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import statistics
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request


def install_package(root, name):
    with urllib.request.urlopen(f"https://registry.npmjs.org/{name}/7.0.2", timeout=30) as response:
        metadata = json.load(response)
    dist = metadata["dist"]
    with urllib.request.urlopen(dist["tarball"], timeout=60) as response:
        data = response.read(64 * 1024 * 1024)
    algorithm, checksum = dist["integrity"].split("-", 1)
    assert algorithm == "sha512"
    assert base64.b64encode(hashlib.sha512(data).digest()).decode() == checksum
    target = root / "node_modules" / name
    target.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        archive.extractall(target, filter="data")
    for child in (target / "package").iterdir():
        child.rename(target / child.name)
    (target / "package").rmdir()
    return {"name": name, "version": metadata["version"], "integrity": dist["integrity"]}


def fixtures():
    root = Path(tempfile.mkdtemp(prefix=".polaris-slice6-", dir=Path.home()))
    source = 'import { answer } from "./value";\nconst local = answer;\nconst bad: string = answer;\n'
    for name in ["fresh", "project", "python", "manual-fresh", "manual-project", "manual-python", "repository", "manual-repository"]:
        directory = root / name
        directory.mkdir()
        subprocess.run(["git", "init", "-q", str(directory)], check=True)
    for name in ["fresh", "project", "manual-fresh", "manual-project", "repository", "manual-repository"]:
        directory = root / name
        (directory / "proof.ts").write_text(source)
        (directory / "value.ts").write_text("export const answer = 42;\n")
        (directory / "tsconfig.json").write_text(json.dumps({"compilerOptions": {"strict": True}, "include": ["*.ts"]}))
        (directory / "package.json").write_text(json.dumps({"name": "slice6-" + name, "private": True}))
    project = root / "project"
    packages = [install_package(project, name) for name in ["typescript", "@typescript/typescript-linux-arm64"]]
    shutil.copytree(project / "node_modules", root / "manual-project/node_modules")
    for name in ["python", "manual-python", "repository", "manual-repository"]:
        subprocess.run(["python3", "-m", "venv", str(root / name / ".venv")], check=True)
        (root / name / "proof.py").write_text("import os\nfrom value import answer\nbad: str = answer()\nresult=answer()\n")
        (root / name / "value.py").write_text("def answer() -> int:\n    return 42\n")
    print(json.dumps({"root": str(root), "packages": packages}))


def process(pid):
    path = Path(f"/proc/{pid}")
    fields = (path / "stat").read_text().rsplit(")", 1)[1].split()
    status = dict(line.split(":", 1) for line in (path / "status").read_text().splitlines())
    command = (path / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
    return {"pid": pid, "ppid": int(fields[1]), "ownTicks": int(fields[11]) + int(fields[12]),
            "ticks": sum(int(fields[n]) for n in [11, 12, 13, 14]),
            "rssKiB": int(status.get("VmRSS", "0 kB").split()[0]), "command": command}


def process_tree(pid):
    result = []
    waiting = {pid}
    seen = set()
    while waiting:
        current = waiting.pop()
        if current in seen:
            continue
        seen.add(current)
        try:
            result.append(process(current))
            for path in Path(f"/proc/{current}/task").glob("*/children"):
                waiting.update(int(child) for child in path.read_text().split())
        except (OSError, ValueError, IndexError):
            pass
    return result


def sample():
    pid = int((Path.home() / ".polaris/daemon.pid").read_text())
    start = time.monotonic()
    before = process_tree(pid)
    rss = []
    daemon_rss = []
    for _ in range(30):
        rows = process_tree(pid)
        rss.append(sum(row["rssKiB"] for row in rows) / 1024)
        daemon_rss.append(next(row["rssKiB"] / 1024 for row in rows if row["pid"] == pid))
        time.sleep(0.5)
    after = process_tree(pid)
    elapsed = time.monotonic() - start
    ticks = sum(row["ticks"] for row in after) - sum(row["ticks"] for row in before)
    daemon_ticks = next(row["ownTicks"] for row in after if row["pid"] == pid) - next(row["ownTicks"] for row in before if row["pid"] == pid)
    print(json.dumps({"seconds": elapsed, "daemonRssMiB": statistics.median(daemon_rss),
                      "treeRssMiB": statistics.median(rss), "treePeakRssMiB": max(rss),
                      "daemonCpuPct": daemon_ticks / os.sysconf("SC_CLK_TCK") / elapsed * 100,
                      "treeCpuPct": ticks / os.sysconf("SC_CLK_TCK") / elapsed * 100,
                      "processes": after, "loadAverage": os.getloadavg()}))


if sys.argv[1] == "fixtures":
    fixtures()
elif sys.argv[1] == "sample":
    sample()
else:
    raise ValueError("Unknown operation")
