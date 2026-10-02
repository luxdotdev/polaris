import pathlib,json,hashlib,zipfile,tarfile,struct,zlib,re
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--root',required=True,type=pathlib.Path);parser.add_argument('--output',required=True,type=pathlib.Path);args=parser.parse_args();root=args.root;out=args.output;
if not str(root.resolve()).startswith('/private/tmp/'):parser.error('Temporary fixture root required')
notice=out/'notices';notice.mkdir(exist_ok=True)
def save(path,bytes):
 digest=hashlib.sha256(bytes).hexdigest();(notice/(digest+'.txt')).write_bytes(bytes);return dict(path=path,sha256=digest)
# JAR manifests and legal texts only, no implementation code.
bundles=[]
for file in (root/'native/jdt/plugins').glob('*.jar'):
 with zipfile.ZipFile(file) as jar:
  names=jar.namelist();manifest=jar.read('META-INF/MANIFEST.MF').decode(errors='replace');notices=[]
  for name in names:
   if re.search(r'(^|/)(license|notice|about|epl|copying|copyright)[^/]*(?:\.(html|txt|md))?$',name,re.I):notices.append(save(file.name+'/'+name,jar.read(name)))
  licenses=re.findall(r'^Bundle-License: (.*)$',manifest,re.M)
  bundles.append(dict(name=file.name,sha256=hashlib.sha256(file.read_bytes()).hexdigest(),license=licenses,notices=notices))
(root/'jdt-audit.json').write_text(json.dumps(bundles,indent=2))
print('JDT bundles',len(bundles),'no notices',sum(not p['notices'] for p in bundles))
# Phar manifest is a binary container index. Extract ONLY notices and Composer dependency metadata.
data=(root/'assets/phpactor.phar').read_bytes();marker=b'__HALT_COMPILER();';start=data.index(marker)+len(marker)
if data[start:start+3]==b' ?>':start+=3
if data[start:start+2]==b'\r\n':start+=2
elif data[start:start+1]==b'\n':start+=1
length=struct.unpack_from('<I',data,start)[0];cursor=start+4
count=struct.unpack_from('<I',data,cursor)[0];cursor+=4+2+4
alias=struct.unpack_from('<I',data,cursor)[0];cursor+=4+alias
metadata=struct.unpack_from('<I',data,cursor)[0];cursor+=4+metadata
files=[]
for index in range(count):
 n=struct.unpack_from('<I',data,cursor)[0];cursor+=4;name=data[cursor:cursor+n].decode();cursor+=n
 size,timestamp,compressed,crc,flags=struct.unpack_from('<IIIII',data,cursor);cursor+=20
 meta=struct.unpack_from('<I',data,cursor)[0];cursor+=4+meta;files.append((name,size,compressed,flags))
offset=start+4+length;notices=[];installed=[]
for name,size,compressed,flags in files:
 bytes=data[offset:offset+compressed];offset+=compressed
 if re.search(r'(^|/)(license|notice|copying|copyright)[^/]*$',name,re.I) or name.endswith('vendor/composer/installed.json'):
  if flags & 0x1000:bytes=zlib.decompress(bytes,-15)
  if name.endswith('vendor/composer/installed.json'):installed=json.loads(bytes)
  else:notices.append(save(name,bytes))
(root/'php-audit.json').write_text(json.dumps(dict(notices=notices,installed=installed),indent=2))
print('PHP phar',count,'files',len(notices),'legal files', 'packages',len(installed if isinstance(installed,list) else installed.get('packages',[])))
for id,path in [('lua-language-server',root/'native/lua')]:
 ns=[save(str(p.relative_to(path)),p.read_bytes()) for p in path.rglob('*') if p.is_file() and re.search(r'^(license|notice|copying)',p.name,re.I)]
 (root/(id+'-audit.json')).write_text(json.dumps(ns,indent=2));print(id,len(ns),'notices')
