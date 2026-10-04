import assert from 'node:assert/strict';
import { lstat, rm } from 'node:fs/promises';
import { ProcessJournal } from '../../../../v2/gateway/src/journal/process-journal.ts';
const roots = [
 { root: '/private/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-task5-bridge-mcMngx', device: '16777229', inode: '63732486', uid: 501 },
 { root: '/private/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-task5-bridge-qDp7Vk', device: '16777229', inode: '63740613', uid: 501 },
];
for (const expected of roots) {
 const st = await lstat(expected.root);
 assert.equal(String(st.dev), expected.device); assert.equal(String(st.ino), expected.inode); assert.equal(st.uid, expected.uid);
 const journal = await ProcessJournal.open(expected.root);
 try {
  const records = await journal.processes(); assert.equal(records.length, 1);
  for (const record of records) {
   const receipt = await journal.pinRetirement(record); assert(receipt);
   assert.equal(receipt.stop.groupEmpty, true); assert.equal(receipt.stop.launchId, record.launchId);
   assert.equal(receipt.stop.processInstanceId, record.processInstanceId);
   assert.equal(await journal.identity.groupEmpty(receipt.stop.processGroupId), true);
   assert.equal(await journal.identity.probe(receipt.stop.pid), null);
   console.log('Task5 cleanup retirement proof', JSON.stringify({ root: expected.root, receipt }));
  }
 } finally { await journal.close(); }
 const current = await lstat(expected.root); assert.equal(current.dev, st.dev); assert.equal(current.ino, st.ino); assert.equal(current.uid, st.uid);
 await rm(expected.root, { recursive: true });
 console.log('Task5 owned cleanup', JSON.stringify({ ...expected, deleted: true, reason: 'failed assertion after genuine immutable retirement; current exact group and PID absent' }));
}
