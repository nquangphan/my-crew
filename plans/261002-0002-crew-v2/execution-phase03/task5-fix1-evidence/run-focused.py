import subprocess,pathlib,json,os
base=pathlib.Path.cwd();ev=base/'plans/261002-0002-crew-v2/execution-phase03/task5-fix1-evidence';root=pathlib.Path(json.loads((ev/'snapshot-identity.json').read_text())['root'])
env=dict(os.environ);env['NODE_OPTIONS']='--loader='+str(ev/'external-loader.mjs')
argv=['pnpm','test','--test-concurrency=1','--test-file',str(root/'v2/gateway/test/execution-bridge-db.test.ts')]
(ev/'db-focused-command.json').write_text(json.dumps({'cwd':str(root/'v2/server'),'argv':argv,'NODE_OPTIONS':env['NODE_OPTIONS']},indent=2))
r=subprocess.run(argv,cwd=root/'v2/server',env=env,stdout=(ev/'db-focused.log').open('w'),stderr=subprocess.STDOUT)
(ev/'db-focused-exit.json').write_text(json.dumps({'exit':r.returncode}));print(r.returncode)
