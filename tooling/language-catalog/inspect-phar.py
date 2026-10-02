import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--root', required=True)
parser.add_argument('--output', default='tooling/language-catalog')
parser.add_argument('--phar', required=True)
parser.add_argument('--fixture')
args=parser.parse_args()
from pathlib import Path
private_root = Path(args.root).resolve()
temporary_root = Path('/tmp').resolve()
if not private_root.is_relative_to(temporary_root) or private_root == temporary_root:
    parser.error('Private temporary root required')
import struct,zlib,json,pathlib,hashlib,re
p=pathlib.Path(args.phar);d=p.read_bytes();start=d.index(b'__HALT_COMPILER();')+len(b'__HALT_COMPILER();')
if d[start:start+3]==b' ?>':start+=3
if d[start:start+2]==b'\r\n':start+=2
elif d[start:start+1]==b'\n':start+=1
length=struct.unpack_from('<I',d,start)[0];c=start+4;count=struct.unpack_from('<I',d,c)[0];c+=10
n=struct.unpack_from('<I',d,c)[0];c+=4+n;n=struct.unpack_from('<I',d,c)[0];c+=4+n;files=[]
for _ in range(count):
 n=struct.unpack_from('<I',d,c)[0];c+=4;name=d[c:c+n].decode();c+=n;size,ts,compressed,crc,flags=struct.unpack_from('<IIIII',d,c);c+=20;n=struct.unpack_from('<I',d,c)[0];c+=4+n;files.append((name,size,compressed,flags))
o=start+4+length;rows=[];meta={}
for name,size,compressed,flags in files:
 b=d[o:o+compressed];o+=compressed
 if flags&0x1000:b=zlib.decompress(b,-15)
 rows.append(dict(path=name,sha256=hashlib.sha256(b).hexdigest(),size=len(b)))
 if name.endswith(('installed.php','installed.json','composer.json','composer.lock')):
  meta[name]=b.decode();print(name,b.decode()[:250])
print('Vendor roots',sorted({p['path'].split('/')[1]+'/'+p['path'].split('/')[2] for p in rows if p['path'].startswith('vendor/') and len(p['path'].split('/'))>=4}))
out=pathlib.Path(args.output);(out/'phpactor-file-inventory.json').write_text(json.dumps(dict(artifactSha256=hashlib.sha256(d).hexdigest(),files=rows,metadata=meta),indent=2)+'\n')
