"""Verify nested JAR bytes and retain only immutable legal/build/package metadata."""
import argparse,pathlib,json,hashlib,io,zipfile,re,xml.etree.ElementTree as ET
parser=argparse.ArgumentParser()
parser.add_argument('--fixture',required=True,type=pathlib.Path)
parser.add_argument('--output',required=True,type=pathlib.Path)
args=parser.parse_args()
if not args.fixture.resolve().is_relative_to(pathlib.Path('/tmp').resolve()):parser.error('Private fixture required')
fixture=args.fixture/'native/jdt/plugins'
source=pathlib.Path(__file__).resolve().parent
expected=json.loads((source/'jdtls-bundles.json').read_text())
inventory=json.loads((source/'jdt-nested-inventory.json').read_text())
output=args.output;output.mkdir(exist_ok=True,parents=True)
(output/'notices').mkdir(exist_ok=True)
records=[];written=set();total=0

def snapshot(name,data):
 global total
 digest=hashlib.sha256(data).hexdigest()
 if digest not in written:
  total+=len(data)
  if total>2*1024*1024:raise ValueError('Bounded metadata budget exceeded')
  (output/'notices'/f'{digest}.txt').write_bytes(data);written.add(digest)
 return {'path':name,'sha256':digest,'bytes':len(data)}

for row in inventory['files']:
 if row['kind']!='nested-jar':continue
 parts=row['path'].split('!/')
 outer=next(item for item in expected if item['name']==parts[0])
 data=(fixture/parts[0]).read_bytes()
 if hashlib.sha256(data).hexdigest()!=outer['sha256']:raise ValueError('Top-level archive integrity')
 for part in parts[1:]:
  with zipfile.ZipFile(io.BytesIO(data)) as archive:data=archive.read(part)
 if hashlib.sha256(data).hexdigest()!=row['sha256']:raise ValueError('Nested archive integrity')
 metadata=[];legal=[];coordinates=[];licenses=[]
 with zipfile.ZipFile(io.BytesIO(data)) as archive:
  for name in sorted(archive.namelist()):
   if name.endswith('/'):continue
   if name.endswith(('pom.xml','pom.properties','MANIFEST.MF')):
    raw=archive.read(name);metadata.append(snapshot(name,raw))
    if name.endswith('pom.properties'):
     props=dict(line.split('=',1) for line in raw.decode().splitlines() if '=' in line and not line.startswith('#'))
     coordinates.append(props)
    if name.endswith('pom.xml'):
     xml=ET.fromstring(raw)
     for license in xml.findall('.//{*}licenses/{*}license'):
      licenses.append({child.tag.rsplit('}',1)[-1]:child.text for child in license})
   elif re.match(r'^(licen[sc]e|copying|notice|copyright|patents|authors)([._-].*)?$',pathlib.PurePosixPath(name).name,re.I):
    legal.append(snapshot(name,archive.read(name)))
 records.append({'path':row['path'],'sha256':row['sha256'],'topLevelSha256':outer['sha256'],'coordinates':coordinates,'declaredLicenses':licenses,'metadata':metadata,'notices':legal,'scope':'Verified immutable bytes; exact source/native closure remains unverified.'})
(output/'jdt-nested-metadata.json').write_text(json.dumps(records,indent=2)+'\n')
print('Nested JAR metadata records',len(records),'with embedded coordinates',sum(bool(r['coordinates']) for r in records),'with notices',sum(bool(r['notices']) for r in records),'unique retained metadata/legal bytes',total)
print('Remaining without embedded coordinates:',[r['path'] for r in records if not r['coordinates']])
