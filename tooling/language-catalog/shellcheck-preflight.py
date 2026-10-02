"""Record an existing developer toolchain; never install one or inspect user configuration."""
import argparse
import json
import pathlib
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
rows = []
for name in ('ghc', 'cabal', 'stack'):
    executable = shutil.which(name)
    row = {'tool': name, 'path': executable, 'available': executable is not None}
    if executable:
        result = subprocess.run([executable, '--numeric-version'], env={'PATH': '/usr/bin:/bin'},
                                capture_output=True, text=True, timeout=10, check=False)
        row.update(version=result.stdout.strip(), exitCode=result.returncode)
    rows.append(row)
record = {'tools': rows, 'buildExecuted': False, 'systemLibrariesVerified': False,
          'solverClosureVerified': False, 'runtimeClosureVerified': False,
          'missingEvidence': ['No authorized existing GHC/Cabal fixture; published binary closure is unverified.']}
pathlib.Path(args.output).write_text(json.dumps(record, indent=2) + '\n')
raise SystemExit(0 if all(row['available'] for row in rows[:2]) else 1)
