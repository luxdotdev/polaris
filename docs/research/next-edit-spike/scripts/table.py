# Combines automatic labels (raw/<tag>.labels.json) with hand labels (raw/judgement.json).
import json,sys
raw=sys.argv[1]; J=json.load(open(raw+'/judgement.json'))
print('| run | exact | acceptable | wrong | dangerous | abstain | in-window: exact+acceptable / n | out-of-window: dangerous / n |')
print('|---|---|---|---|---|---|---|---|')
for tag,key in [a.split('=') for a in sys.argv[2:]]:
    L=json.load(open(f'{raw}/{tag}.labels.json')); j=J[key]
    n={'exact':0,'acceptable':0,'wrong':0,'dangerous':0,'abstain':0}; inw=inok=outw=outd=0
    for cid,lab in L.items():
        out='[out]' in lab
        k=lab.split('(')[0].split('[')[0]
        if k=='other':
            k=j[cid][0]
        n[k]+=1
        if out: outw+=1; outd+= k=='dangerous'
        else: inw+=1; inok+= k in('exact','acceptable')
    print(f"| {tag} | {n['exact']} | {n['acceptable']} | {n['wrong']} | {n['dangerous']} | {n['abstain']} | {inok}/{inw} | {outd}/{outw} |")
