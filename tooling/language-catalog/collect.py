import pathlib,json,urllib.request,tarfile,io,hashlib,base64,concurrent.futures,time
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--root',required=True,type=pathlib.Path);parser.add_argument('--output',required=True,type=pathlib.Path);args=parser.parse_args();root=args.root;out=args.output;
if not str(root.resolve()).startswith('/private/tmp/'):parser.error('Temporary fixture root required')
 (out/'bundles').mkdir(exist_ok=True);(out/'notices').mkdir(exist_ok=True)
locks={p.parent.name:json.loads(p.read_text()) for p in (root/'npm').glob('*/package-lock.json')}
unique={v['resolved']:v for lock in locks.values() for k,v in lock['packages'].items() if k}
def collect(pair):
 url,pkg=pair
 cache=root/'tarballs';cache.mkdir(exist_ok=True);target=cache/(hashlib.sha256(url.encode()).hexdigest()+'.tgz')
 if target.exists():data=target.read_bytes()
 else:
  for attempt in range(4):
   try:
    data=urllib.request.urlopen(url,timeout=60).read();target.write_bytes(data);break
   except Exception:
    if attempt==3:print('FAILED URL',url,flush=True);raise
    time.sleep(1+attempt)
 expected=pkg['integrity']; actual='sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()
 if expected!=actual: raise ValueError(url+' integrity mismatch')
 notices=[];license=pkg.get('license','UNKNOWN')
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
  for f in archive.getmembers():
   parts=f.name.split('/');base=parts[-1].lower()
   if f.isfile() and ((base.startswith(('license','licence','copying','notice','third_party','third-party','thirdparty')) or '.license.' in base) or base=='copyright') and f.size<1500000:
    content=archive.extractfile(f).read(); digest=hashlib.sha256(content).hexdigest();(out/'notices'/(digest+'.txt')).write_bytes(content)
    notices.append({'path':f.name,'sha256':digest})
  manifests=[f for f in archive.getmembers() if f.isfile() and f.name.endswith('/package.json')];manifest=min(manifests,key=lambda f:len(f.name));meta=json.load(archive.extractfile(manifest))
  license=meta.get('license',license)
  if isinstance(license,dict): license=license.get('type','UNKNOWN')
 return url,{'name':meta['name'],'version':pkg['version'],'license':license,'integrity':expected,'url':url,'notices':notices,'verifiedBytes':len(data)}
records={}
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
 for index,(url,record) in enumerate(pool.map(collect,unique.items())):
  records[url]=record
  if index%100==0:print('verified',index,flush=True)
for name,lock in locks.items():
 packages=[dict(records[pkg['resolved']],location=path) for path,pkg in lock['packages'].items() if path]
 bundle={'name':name,'manifest':json.loads((root/'npm'/name/'package.json').read_text()),'lock':lock,'packages':packages}
 (out/'bundles'/(name+'.json')).write_text(json.dumps(bundle,indent=2)+'\n')
 missing=[p['name']+'@'+p['version'] for p in packages if not p['notices']]
 print(name,len(packages),'missing notices',missing,flush=True)
print('unique verified packages',len(records))
