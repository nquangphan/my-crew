import json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[4]
e=root/'plans/261002-0002-crew-v2/execution-phase03/task5-evidence'
m=json.loads((e/'candidate-test-files.json').read_text())
files=m['reviewed']+m['task5'];db='v2/gateway/test/execution-bridge-db.test.ts'
args=['pnpm','test','--test-concurrency=1','--test-file',str(root/db)]+[str(root/f) for f in files if f!=db]
(e/'cover-command.json').write_text(json.dumps({'cwd':str(root/'v2/server'),'argv':args},indent=2)+'\n')
with (e/'cover-final.log').open('w') as out: result=subprocess.run(args,cwd=root/'v2/server',stdout=out,stderr=subprocess.STDOUT)
(e/'cover-exit.json').write_text(json.dumps({'exitCode':result.returncode})+'\n')
sys.exit(result.returncode)
