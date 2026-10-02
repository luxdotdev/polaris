import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--root', required=True)
parser.add_argument('--output', default='tooling/language-catalog')
parser.add_argument('--phar')
parser.add_argument('--fixture')
args=parser.parse_args()
from pathlib import Path
private_root = Path(args.root).resolve()
temporary_root = Path('/tmp').resolve()
if not private_root.is_relative_to(temporary_root) or private_root == temporary_root:
    parser.error('Private temporary root required')
import pathlib,json,hashlib,tarfile
from importlib.machinery import SourceFileLoader
m=SourceFileLoader('legal','tooling/language-catalog/complete-notices.py').load_module();o=pathlib.Path(args.output);c=pathlib.Path(args.root)/'legal-cache';rows=[]
items=[('phpactor','phpactor/phpactor','f67b7753b966c874735a064978dd89837a369f59',['box.json','.github/build-phar.sh','.github/workflows/release-phar.yml']),('shellcheck','koalaman/shellcheck','aac0823e6b58f8a499e856e93738082691cbf212',['ShellCheck.cabal','stack.yaml','builders/darwin.aarch64/Dockerfile','builders/darwin.x86_64/Dockerfile','builders/linux.aarch64/Dockerfile','builders/linux.x86_64/Dockerfile','builders/linux.x86_64/build','.github/workflows/build.yml']),('flexmark','vsch/flexmark-java','f63c7959601288efcfe6328252490da72fd81283',['pom.xml'])]
for tool,repo,commit,paths in items:
 for p in paths:
  u='https://raw.githubusercontent.com/'+repo+'/'+commit+'/'+p;b=m.download(u,c);rows.append(dict(tool=tool,path=p,source=u,commit=commit,evidence=m.save_notice('build-provenance/'+p,b,o)))
  if tool=='phpactor':print(p,b.decode()[:1800])
rs=json.load(open(o/'rust-runtime-sources.json'))
for commit,r in rs.items():
 a=tarfile.open(c/hashlib.sha256(r['url'].encode()).hexdigest())
 for x in a.getmembers():
  if x.isfile() and 'musl' in x.name and x.name.endswith('.sh') and '/docker/scripts/' in x.name:
   b=a.extractfile(x).read();print(x.name,b.decode()[:1400]);rows.append(dict(tool='rust-runtime',source=r['url'],commit=commit,path=x.name,evidence=m.save_notice('build-provenance/'+x.name,b,o)))
(o/'build-provenance.json').write_text(json.dumps(rows,indent=2)+'\n')
