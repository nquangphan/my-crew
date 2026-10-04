import subprocess,pathlib,json,os,time
base=pathlib.Path.cwd();ev=base/'plans/261002-0002-crew-v2/execution-phase03/task5-fix1-evidence';root=pathlib.Path(json.loads((ev/'snapshot-identity.json').read_text())['root'])
env=dict(os.environ);env['NODE_OPTIONS']='--loader='+str(ev/'external-loader.mjs')
prior=json.loads((ev.parent/'task5-evidence/cover-command.json').read_text());argv=[arg.replace(str(base)+'/v2/gateway',str(root)+'/v2/gateway') for arg in prior['argv']]
(ev/'cover-command.json').write_text(json.dumps({'cwd':str(root/'v2/server'),'argv':argv,'NODE_OPTIONS':env['NODE_OPTIONS'],'base':'9182e89','migrationPrefix':8},indent=2))
start=time.monotonic();r=subprocess.run(argv,cwd=root/'v2/server',env=env,stdout=(ev/'cover-final.log').open('w'),stderr=subprocess.STDOUT)
(ev/'cover-exit.json').write_text(json.dumps({'exit':r.returncode,'seconds':time.monotonic()-start}));print(r.returncode)
