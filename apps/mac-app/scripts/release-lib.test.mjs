import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  artifactNames,
  BUG_FINDING_BUNDLE_ID,
  bugFindingBuildCommands,
  buildCommands,
  checkAppUpdateYml,
  checkBugFindingSignature,
  checkInfoPlist,
  checkLatestMacYml,
  checkSignature,
  checkTag,
  cscName,
  EXIT,
  findDeveloperId,
  hasSwift6,
  isCleanTree,
  maskHashes,
  missingCredentials,
  notarizedBySpctl,
  notaryProfileState,
  parseArgs,
  parseCodesignDetails,
  parseIdentities,
  parseNotarySubmit,
  pickIdentity,
  publishCommands,
  readBugFindingPin,
  redactUrlCredentials,
  releaseOutDir,
  releaseState,
  scrubLog,
  teamIdFromSubject,
  teamIdOf,
} from './release-lib.mjs';

const FIND_IDENTITY = [
  '  1) 1111111111111111111111111111111111111111 "Apple Distribution: QASOFT SOFTWARE COMPANY LIMITED (GWKDUTP5SG)"',
  '  2) 2222222222222222222222222222222222222222 "Apple Development: Nhật Quang Phan (29CVPDJ2XX)"',
  '  3) 3333333333333333333333333333333333333333 "Apple Distribution: 2P SOLUTIONS JOINT STOCK COMPANY (J7Y2DL6HZV)"',
  '  4) 4444444444444444444444444444444444444444 "Apple Development: Cheak Channorin (56P57KQ5XS)"',
  '     4 valid identities found',
].join('\n');

test('đối số: mặc định phát hành nhưng không đăng; đăng chỉ khi có --publish', () => {
  assert.deepEqual(parseArgs([]), { mode: 'release', publish: false, identity: null });
  assert.deepEqual(parseArgs(['--publish']), { mode: 'release', publish: true, identity: null });
  assert.deepEqual(parseArgs(['--no-publish']), { mode: 'release', publish: false, identity: null });
  assert.deepEqual(parseArgs(['--dev-sign', '--no-publish']), {
    mode: 'dev-sign',
    publish: false,
    identity: null,
  });
  assert.deepEqual(parseArgs(['--dry-run']), { mode: 'dry-run', publish: false, identity: null });
  assert.deepEqual(parseArgs(['--identity', 'Apple Development: A (X)', '--dev-sign']), {
    mode: 'dev-sign',
    publish: false,
    identity: 'Apple Development: A (X)',
  });
  assert.deepEqual(
    parseArgs(['--identity=Developer ID Application: B (Y)']).identity,
    'Developer ID Application: B (Y)',
  );
});

test('đối số: cờ lạ hay mâu thuẫn bị từ chối', () => {
  assert.match(parseArgs(['--dev-sign', '--publish']).error, /--publish/);
  assert.match(parseArgs(['--dry-run', '--publish']).error, /--publish/);
  assert.match(parseArgs(['--publish', '--no-publish']).error, /--no-publish/);
  assert.match(parseArgs(['--dev-sign', '--dry-run']).error, /--dry-run/);
  assert.match(parseArgs(['--dry-run', '--identity', 'x']).error, /--identity/);
  assert.match(parseArgs(['--identity']).error, /--identity/);
  assert.match(parseArgs(['--force']).error, /--force/);
});

test('tag phải là mac-app/v<version của package.json> và trỏ HEAD', () => {
  assert.deepEqual(checkTag({ version: '0.1.0', tagsAtHead: ['mac-app/v0.1.0'] }), {
    ok: true,
    tag: 'mac-app/v0.1.0',
  });
  assert.equal(checkTag({ version: '0.1.0', tagsAtHead: [] }).ok, false);
  assert.equal(checkTag({ version: '0.1.0', tagsAtHead: ['mac-app/v0.1.1'] }).ok, false);
  assert.equal(checkTag({ version: '0.1.0', tagsAtHead: ['v0.1.0', 'crew/v0.1.0'] }).ok, false);
  const pre = checkTag({ version: '0.1.0-beta.1', tagsAtHead: ['mac-app/v0.1.0-beta.1'] });
  assert.equal(pre.ok, false);
  assert.match(pre.reason, /semver/);
});

test('cây sạch: git status --porcelain rỗng', () => {
  assert.equal(isCleanTree(''), true);
  assert.equal(isCleanTree('\n'), true);
  assert.equal(isCleanTree(' M apps/mac-app/package.json\n'), false);
  assert.equal(isCleanTree('?? apps/mac-app/scripts/new.mjs\n'), false);
});

test('đọc danh tính ký: chỉ giữ tên, bỏ hash', () => {
  const ids = parseIdentities(FIND_IDENTITY);
  assert.deepEqual(
    ids.map((it) => it.name),
    [
      'Apple Distribution: QASOFT SOFTWARE COMPANY LIMITED (GWKDUTP5SG)',
      'Apple Development: Nhật Quang Phan (29CVPDJ2XX)',
      'Apple Distribution: 2P SOLUTIONS JOINT STOCK COMPANY (J7Y2DL6HZV)',
      'Apple Development: Cheak Channorin (56P57KQ5XS)',
    ],
  );
  assert.equal(JSON.stringify(ids).includes('2222222222'), false);
});

test('chọn đúng một Developer ID Application', () => {
  const out = [
    '  1) AAAA "Apple Development: Phan (X1)"',
    '  2) BBBB "Developer ID Application: 2P SOLUTIONS (J7Y2DL6HZV)"',
    '     2 valid identities found',
  ].join('\n');
  assert.deepEqual(findDeveloperId(out), {
    ok: true,
    name: 'Developer ID Application: 2P SOLUTIONS (J7Y2DL6HZV)',
    teamId: 'J7Y2DL6HZV',
  });
  const none = findDeveloperId('  1) AAAA "Apple Distribution: 2P SOLUTIONS (J7Y2DL6HZV)"');
  assert.equal(none.ok, false);
  assert.match(none.reason, /chưa có Developer ID Application/);
  const two = findDeveloperId(
    [
      '  1) AAAA "Developer ID Application: 2P SOLUTIONS (J7Y2DL6HZV)"',
      '  2) BBBB "Developer ID Application: 2P SOLUTIONS JSC (J7Y2DL6HZV)"',
    ].join('\n'),
  );
  assert.equal(two.ok, false);
  assert.match(two.reason, /--identity/);
  assert.equal(findDeveloperId(FIND_IDENTITY).ok, false);
});

test('Team ID của chứng chỉ lấy từ OU của subject', () => {
  assert.equal(
    teamIdFromSubject(
      'UID=WZG33P7JB9\nCN=Apple Development: Nhật Quang Phan (29CVPDJ2XX)\nOU=J7Y2DL6HZV\nO=2P SOLUTIONS\nC=US',
    ),
    'J7Y2DL6HZV',
  );
  assert.equal(teamIdFromSubject('CN=x\nO=y'), null);
});

test('chọn Apple Development theo Team ID 2P, hoặc theo --identity', () => {
  const ids = [
    { name: 'Apple Development: Nhật Quang Phan (29CVPDJ2XX)', teamId: 'J7Y2DL6HZV' },
    { name: 'Apple Development: Cheak Channorin (56P57KQ5XS)', teamId: 'RQQ7T4Z27Y' },
    { name: 'Apple Distribution: 2P SOLUTIONS JOINT STOCK COMPANY (J7Y2DL6HZV)', teamId: 'J7Y2DL6HZV' },
  ];
  assert.deepEqual(pickIdentity({ kind: 'Apple Development', identities: ids, teamId: 'J7Y2DL6HZV' }), {
    ok: true,
    name: 'Apple Development: Nhật Quang Phan (29CVPDJ2XX)',
    teamId: 'J7Y2DL6HZV',
  });
  const wrongTeam = pickIdentity({
    kind: 'Apple Development',
    identities: ids,
    teamId: 'J7Y2DL6HZV',
    wanted: 'Apple Development: Cheak Channorin (56P57KQ5XS)',
  });
  assert.equal(wrongTeam.ok, false);
  assert.match(wrongTeam.reason, /J7Y2DL6HZV/);
  const wrongKind = pickIdentity({
    kind: 'Apple Development',
    identities: ids,
    teamId: 'J7Y2DL6HZV',
    wanted: 'Apple Distribution: 2P SOLUTIONS JOINT STOCK COMPANY (J7Y2DL6HZV)',
  });
  assert.equal(wrongKind.ok, false);
  const missing = pickIdentity({ kind: 'Apple Development', identities: [], teamId: 'J7Y2DL6HZV' });
  assert.match(missing.reason, /chưa có Apple Development/);
});

test('CSC_NAME bỏ tiền tố loại chứng chỉ (electron-builder từ chối tiền tố Developer ID)', () => {
  assert.equal(cscName('Developer ID Application: 2P SOLUTIONS (J7Y2DL6HZV)'), '2P SOLUTIONS (J7Y2DL6HZV)');
  assert.equal(cscName('Apple Development: Nhật Quang Phan (29CVPDJ2XX)'), 'Nhật Quang Phan (29CVPDJ2XX)');
});

test('notary profile: có, thiếu hay lỗi khác', () => {
  assert.equal(notaryProfileState({ status: 0, stderr: '' }), 'ok');
  assert.equal(
    notaryProfileState({
      status: 69,
      stderr: 'Error: No Keychain password item found for profile: crew-notary\n',
    }),
    'missing',
  );
  assert.equal(notaryProfileState({ status: 1, stderr: 'Error: HTTP status code: 401' }), 'error');
});

test('báo đủ mọi thứ còn thiếu trước khi build bản phát hành', () => {
  assert.deepEqual(missingCredentials({ identity: { ok: true }, notary: 'ok' }), []);
  const both = missingCredentials({
    identity: { ok: false, reason: 'Keychain chưa có Developer ID Application.' },
    notary: 'missing',
  });
  assert.equal(both.length, 2);
  assert.match(both[0], /Developer ID Application/);
  assert.match(both[1], /notary profile crew-notary/);
  assert.match(both[1], /store-credentials crew-notary/);
  assert.match(missingCredentials({ identity: { ok: true }, notary: 'error' })[0], /crew-notary/);
});

test('kết quả notarytool submit --output-format json', () => {
  assert.deepEqual(parseNotarySubmit('{"id":"abc-1","status":"Accepted","message":"ok"}'), {
    ok: true,
    id: 'abc-1',
    status: 'Accepted',
  });
  assert.deepEqual(parseNotarySubmit('{"id":"abc-2","status":"Invalid"}'), {
    ok: false,
    id: 'abc-2',
    status: 'Invalid',
  });
  assert.deepEqual(parseNotarySubmit('không phải json'), { ok: false, id: null, status: null });
});

test('spctl và designated requirement', () => {
  assert.equal(
    notarizedBySpctl(
      'x.app: accepted\nsource=Notarized Developer ID\norigin=Developer ID Application: 2P SOLUTIONS (J7Y2DL6HZV)',
    ),
    true,
  );
  assert.equal(notarizedBySpctl('x.app: accepted\nsource=Apple Development'), false);
  assert.equal(notarizedBySpctl('x.app: rejected\nsource=Notarized Developer ID'), false);
  assert.equal(
    teamIdOf('designated => anchor apple generic and certificate leaf[subject.OU] = J7Y2DL6HZV'),
    'J7Y2DL6HZV',
  );
  assert.equal(teamIdOf('designated => identifier "x" and certificate leaf[subject.CN] = "y"'), null);
});

const CODESIGN_DV = [
  'Executable=/tmp/2P Crew.app/Contents/MacOS/2P Crew',
  'Identifier=com.2p-solutions.crew.mac',
  'Format=app bundle with Mach-O thin (arm64)',
  'CodeDirectory v=20500 size=1000 flags=0x10000(runtime) hashes=20+7 location=embedded',
  'CDHash=5555555555555555555555555555555555555555',
  'Authority=Apple Development: Nhật Quang Phan (29CVPDJ2XX)',
  'Authority=Apple Worldwide Developer Relations Certification Authority',
  'Authority=Apple Root CA',
  'TeamIdentifier=J7Y2DL6HZV',
].join('\n');

test('đọc codesign -dv và kiểm chữ ký theo loại, Team ID, bundle id, hardened runtime', () => {
  const d = parseCodesignDetails(CODESIGN_DV);
  assert.deepEqual(d, {
    identifier: 'com.2p-solutions.crew.mac',
    teamId: 'J7Y2DL6HZV',
    authority: 'Apple Development: Nhật Quang Phan (29CVPDJ2XX)',
    runtime: true,
    timestamp: null,
  });
  const want = { kind: 'Apple Development', teamId: 'J7Y2DL6HZV', bundleId: 'com.2p-solutions.crew.mac' };
  assert.deepEqual(checkSignature(d, want), []);
  assert.equal(checkSignature(d, { ...want, kind: 'Developer ID Application' }).length, 1);
  assert.equal(checkSignature({ ...d, runtime: false }, want).length, 1);
  assert.equal(checkSignature({ ...d, teamId: 'not set' }, want).length, 1);
  const adhoc = parseCodesignDetails(
    'Identifier=com.2p-solutions.crew.mac\nSignature=adhoc\nTeamIdentifier=not set',
  );
  assert.ok(checkSignature(adhoc, want).length >= 2);
});

const BF_DV = [
  'Executable=/a/2P Crew.app/Contents/Resources/Bug Finding.app/Contents/MacOS/MRReviewQueue',
  'Identifier=local.mrreviewqueue',
  'CodeDirectory v=20500 size=900 flags=0x10000(runtime) hashes=20+7 location=embedded',
  'Authority=Developer ID Application: 2P SOLUTIONS JOINT STOCK COMPANY (J7Y2DL6HZV)',
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'Timestamp=4 Nov 2026 at 15:00:00',
  'TeamIdentifier=J7Y2DL6HZV',
].join('\n');

test('Bug Finding nhúng giữ chữ ký riêng: bundle id, Team ID, runtime, timestamp, entitlements của nó', () => {
  const want = { kind: 'Developer ID Application', teamId: 'J7Y2DL6HZV' };
  const d = parseCodesignDetails(BF_DV);
  assert.equal(d.identifier, BUG_FINDING_BUNDLE_ID);
  assert.equal(d.timestamp, '4 Nov 2026 at 15:00:00');
  const own = { 'com.apple.security.network.client': true };
  assert.deepEqual(checkBugFindingSignature(d, own, want), []);
  // Bị electron-builder ký lại bằng entitlements Electron.
  const electron = {
    ...own,
    'com.apple.security.cs.allow-jit': true,
    'com.apple.security.cs.disable-library-validation': true,
  };
  assert.match(checkBugFindingSignature(d, electron, want).join('\n'), /allow-jit/);
  assert.match(checkBugFindingSignature(d, {}, want).join('\n'), /Entitlements/);
  assert.match(checkBugFindingSignature(d, null, want).join('\n'), /Không đọc được entitlements/);
  // Sai bundle id (ký lại thành identifier khác), thiếu runtime, thiếu timestamp, khác team: mỗi lỗi một dòng.
  assert.equal(
    checkBugFindingSignature({ ...d, identifier: 'com.2p-solutions.crew.mac' }, own, want).length,
    1,
  );
  assert.equal(checkBugFindingSignature({ ...d, runtime: false }, own, want).length, 1);
  assert.match(checkBugFindingSignature({ ...d, timestamp: null }, own, want).join('\n'), /timestamp/);
  assert.equal(checkBugFindingSignature(d, own, { ...want, teamId: 'AAAAAAAAAA' }).length, 1);
  assert.equal(checkBugFindingSignature(d, own, { ...want, kind: 'Apple Development' }).length, 1);
  // codesign không timestamp in "Signed Time=", không phải "Timestamp=".
  const noTs = parseCodesignDetails(BF_DV.replace(/^Timestamp=.*$/m, 'Signed Time=4 Nov 2026 at 15:00:00'));
  assert.equal(noTs.timestamp, null);
});

test('che userinfo của URL trong log, giữ phần còn lại', () => {
  assert.equal(
    redactUrlCredentials('git clone https://bot:ghp_secret123@github.com/nquangphan/bug-finding.git /t/bf'),
    'git clone https://***@github.com/nquangphan/bug-finding.git /t/bf',
  );
  assert.equal(redactUrlCredentials('https://x-access-token:abc@h/r'), 'https://***@h/r');
  assert.equal(
    redactUrlCredentials('git@github.com:nquangphan/bug-finding.git'),
    'git@github.com:nquangphan/bug-finding.git',
  );
  assert.equal(redactUrlCredentials('https://github.com/a/b'), 'https://github.com/a/b');
  const line = scrubLog(`repo https://u:tok@github.com/a/b, commit ${'a'.repeat(40)}`);
  assert.ok(!line.includes('tok') && !line.includes('a'.repeat(40)), line);
});

test('Info.plist đúng bundle id, tên, phiên bản và lời xin quyền tiếng Việt', () => {
  const plist = {
    CFBundleIdentifier: 'com.2p-solutions.crew.mac',
    CFBundleName: '2P Crew',
    CFBundleShortVersionString: '0.1.0',
    NSDocumentsFolderUsageDescription: 'a',
    NSDesktopFolderUsageDescription: 'b',
    NSDownloadsFolderUsageDescription: 'c',
    NSRemovableVolumesUsageDescription: 'd',
  };
  assert.deepEqual(checkInfoPlist(plist, { version: '0.1.0' }), []);
  assert.equal(
    checkInfoPlist({ ...plist, CFBundleIdentifier: 'com.2p-solutions.crew' }, { version: '0.1.0' }).length,
    1,
  );
  assert.equal(
    checkInfoPlist({ ...plist, CFBundleShortVersionString: '0.0.9' }, { version: '0.1.0' }).length,
    1,
  );
  const { NSRemovableVolumesUsageDescription: _, ...noRemovable } = plist;
  assert.match(checkInfoPlist(noRemovable, { version: '0.1.0' })[0], /NSRemovableVolumesUsageDescription/);
});

test('app-update.yml trong bundle trỏ đúng repo phát hành', () => {
  assert.deepEqual(checkAppUpdateYml('owner: nquangphan\nrepo: crew-mac-releases\nprovider: github\n'), []);
  assert.equal(checkAppUpdateYml('owner: nquangphan\nrepo: crew\nprovider: github\n').length, 1);
  assert.equal(checkAppUpdateYml(null).length, 1);
});

test('tên file phát hành và latest-mac.yml theo kênh phát hành', () => {
  assert.deepEqual(artifactNames('0.1.0'), {
    zip: '2P-Crew-0.1.0-arm64-mac.zip',
    dmg: '2P-Crew-0.1.0-arm64.dmg',
    zipBlockmap: '2P-Crew-0.1.0-arm64-mac.zip.blockmap',
    dmgBlockmap: '2P-Crew-0.1.0-arm64.dmg.blockmap',
    latest: 'latest-mac.yml',
  });
  const yml =
    'version: 0.1.0\nfiles:\n  - url: 2P-Crew-0.1.0-arm64-mac.zip\n    sha512: x\npath: 2P-Crew-0.1.0-arm64-mac.zip\n';
  assert.deepEqual(checkLatestMacYml(yml, '0.1.0'), []);
  assert.equal(checkLatestMacYml(yml.replaceAll('0.1.0', '0.0.9'), '0.1.0').length, 2);
  assert.equal(checkLatestMacYml(null, '0.1.0').length, 1);
});

test('thư mục ra nằm ngoài thư mục File Provider (~/Documents, ~/Desktop)', () => {
  assert.equal(releaseOutDir('/Users/a'), '/Users/a/Library/Caches/2p-crew-release');
});

test('che hash chứng chỉ 40 ký tự hex, giữ sha256', () => {
  const sha256 = 'a'.repeat(64);
  assert.equal(
    maskHashes('identityHash=ABCDEF0123456789ABCDEF0123456789ABCDEF01 x'),
    'identityHash=<đã che> x',
  );
  assert.equal(maskHashes(sha256), sha256);
});

const PATHS = {
  root: '/r',
  appDir: '/r/apps/mac-app',
  appPath: '/h/Library/Caches/2p-crew-release/mac-arm64/2P Crew.app',
  dist: '/h/Library/Caches/2p-crew-release',
  tmp: '/t',
};

function flat(steps) {
  return steps.map((s) => [s.cmd, ...s.args].join(' '));
}

test('dựng lệnh bản phát hành: ký bằng CSC_NAME, notarize app và dmg bằng keychain profile, staple', () => {
  const steps = buildCommands({
    mode: 'release',
    version: '0.1.0',
    identityName: 'Developer ID Application: 2P SOLUTIONS (J7Y2DL6HZV)',
    paths: PATHS,
  });
  const ids = steps.map((s) => s.id);
  assert.deepEqual(ids, [
    'build-docs',
    'build-mac',
    'build-app',
    'pack-app',
    'zip-for-notary',
    'notarize-app',
    'staple-app',
    'package',
    'notarize-dmg',
    'staple-dmg',
  ]);
  const pack = steps.find((s) => s.id === 'pack-app');
  assert.deepEqual(pack.env, { CSC_NAME: '2P SOLUTIONS (J7Y2DL6HZV)', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  assert.equal(pack.cwd, PATHS.appDir);
  assert.ok(pack.args.includes('--publish') && pack.args.includes('never'));
  assert.ok(pack.args.includes(`--config.directories.output=${PATHS.dist}`));
  // electron-builder chỉ ghi Contents/Resources/app-update.yml khi bước đóng gói có target zip/dmg.
  assert.deepEqual(pack.args.slice(pack.args.indexOf('--mac'), pack.args.indexOf('--mac') + 3), [
    '--mac',
    'zip',
    '--arm64',
  ]);
  assert.equal(
    pack.args.some((a) => a.includes('development')),
    false,
  );
  const notarize = steps.find((s) => s.id === 'notarize-app');
  assert.deepEqual(notarize.args, [
    'notarytool',
    'submit',
    '/t/app.zip',
    '--keychain-profile',
    'crew-notary',
    '--wait',
    '--output-format',
    'json',
  ]);
  assert.equal(notarize.parse, 'notary');
  assert.equal(notarize.exit, EXIT.notarize);
  const pkg = steps.find((s) => s.id === 'package');
  assert.ok(pkg.args.includes('--prepackaged') && pkg.args.includes(PATHS.appPath));
  assert.ok(pkg.args.includes(`--config.directories.output=${PATHS.dist}`));
  assert.equal(pkg.env.CSC_NAME, undefined);
  assert.ok(flat(steps).every((line) => !/gh |password|--apple-id|--key /.test(line)));
});

test('đăng lần đầu: tạo release nháp không file, tải file (latest-mac.yml sau cùng), rồi mới công khai', () => {
  const steps = publishCommands({ version: '0.1.0', state: 'missing', paths: PATHS });
  assert.deepEqual(
    steps.map((s) => s.id),
    ['publish-create', 'publish-upload', 'publish-latest', 'publish-release'],
  );
  for (const s of steps) {
    assert.equal(s.cmd, 'gh');
    assert.equal(s.exit, EXIT.publish);
    assert.deepEqual(s.args.slice(2, 5), ['v0.1.0', '--repo', 'nquangphan/crew-mac-releases']);
  }
  const [create, upload, latest, release] = steps;
  assert.deepEqual(create.args.slice(0, 2), ['release', 'create']);
  assert.ok(create.args.includes('--draft'));
  assert.ok(!create.args.some((a) => a.startsWith(PATHS.dist)), 'create không kèm file');
  const names = artifactNames('0.1.0');
  assert.ok(upload.args.includes('--clobber') && latest.args.includes('--clobber'));
  assert.deepEqual(
    upload.args.filter((a) => a.startsWith(PATHS.dist)),
    [names.zip, names.dmg, names.zipBlockmap, names.dmgBlockmap].map((f) => `${PATHS.dist}/${f}`),
  );
  assert.deepEqual(
    latest.args.filter((a) => a.startsWith(PATHS.dist)),
    [`${PATHS.dist}/${names.latest}`],
  );
  assert.deepEqual(release.args, [
    'release',
    'edit',
    'v0.1.0',
    '--repo',
    'nquangphan/crew-mac-releases',
    '--draft=false',
    '--latest',
  ]);
});

test('chạy lại sau lỗi giữa chừng: dùng lại release đã có, thay file, không tạo lại', () => {
  for (const state of ['draft', 'published']) {
    const ids = publishCommands({ version: '0.1.0', state, paths: PATHS }).map((s) => s.id);
    assert.deepEqual(ids, ['publish-upload', 'publish-latest', 'publish-release'], state);
  }
  assert.throws(() => publishCommands({ version: '0.1.0', state: 'error', paths: PATHS }), /không rõ/);
});

test('trạng thái release trên GitHub: chưa có, nháp, đã công khai, hay lỗi', () => {
  assert.equal(releaseState({ status: 0, stdout: '{"isDraft":true}', stderr: '' }), 'draft');
  assert.equal(releaseState({ status: 0, stdout: '{"isDraft":false}', stderr: '' }), 'published');
  assert.equal(releaseState({ status: 1, stdout: '', stderr: 'release not found\n' }), 'missing');
  assert.equal(releaseState({ status: 1, stdout: '', stderr: 'HTTP 401: Bad credentials' }), 'error');
  assert.equal(releaseState({ status: 0, stdout: 'not json', stderr: '' }), 'error');
});

test('dựng lệnh --dev-sign: ký Apple Development, không notarize, không đăng', () => {
  const steps = buildCommands({
    mode: 'dev-sign',
    version: '0.1.0',
    identityName: 'Apple Development: Nhật Quang Phan (29CVPDJ2XX)',
    paths: PATHS,
  });
  assert.deepEqual(
    steps.map((s) => s.id),
    ['build-docs', 'build-mac', 'build-app', 'pack-app', 'package'],
  );
  const pack = steps.find((s) => s.id === 'pack-app');
  assert.equal(pack.env.CSC_NAME, 'Nhật Quang Phan (29CVPDJ2XX)');
  assert.ok(pack.args.includes('--config.mac.type=development'));
  assert.ok(flat(steps).every((line) => !/notarytool|stapler|^gh /.test(line)));
});

test('dựng lệnh --dry-run: không ký (tắt tự tìm danh tính), không notarize, không đăng', () => {
  const steps = buildCommands({
    mode: 'dry-run',
    version: '0.1.0',
    identityName: null,
    paths: PATHS,
  });
  const pack = steps.find((s) => s.id === 'pack-app');
  assert.deepEqual(pack.env, { CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  assert.ok(flat(steps).every((line) => !/notarytool|stapler|^gh /.test(line)));
});

test('bước build/ký không bao giờ có lệnh gh (đăng chỉ ở publishCommands)', () => {
  for (const mode of ['release', 'dev-sign', 'dry-run']) {
    const steps = buildCommands({
      mode,
      version: '0.1.0',
      identityName: 'x: y',
      paths: PATHS,
    });
    assert.equal(
      steps.some((s) => s.cmd === 'gh'),
      false,
      mode,
    );
  }
});

function pinDir(pin) {
  const dir = mkdtempSync(join(tmpdir(), 'pin-'));
  writeFileSync(join(dir, 'bug-finding.pin.json'), JSON.stringify(pin));
  return dir;
}

test('readBugFindingPin đọc file ghim hợp lệ', (t) => {
  const pin = { repo: 'git@github.com:nquangphan/bug-finding.git', commit: 'a'.repeat(40), version: '0.2.0' };
  const dir = pinDir(pin);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(readBugFindingPin(dir), pin);
});

test('readBugFindingPin từ chối commit không đủ 40 hex hay repo rỗng', (t) => {
  const short = pinDir({ repo: 'x', commit: 'abc', version: '0.2.0' });
  const noRepo = pinDir({ repo: '', commit: 'a'.repeat(40), version: '0.2.0' });
  t.after(() => {
    for (const dir of [short, noRepo]) rmSync(dir, { recursive: true, force: true });
  });
  assert.throws(() => readBugFindingPin(short), /commit/);
  assert.throws(() => readBugFindingPin(noRepo), /repo/);
});

test('bugFindingBuildCommands build đúng commit và ký bằng danh tính phát hành', () => {
  const cmds = bugFindingBuildCommands({
    checkout: '/t/bf',
    outDir: '/o',
    identity: 'Developer ID Application: 2P',
  });
  assert.deepEqual(cmds.at(-1), [
    'bash',
    '/t/bf/apps/mr-review-queue/scripts/build-app.sh',
    '--out',
    '/o',
    '--sign',
    'Developer ID Application: 2P',
    '--hardened-runtime',
  ]);
  // --dry-run không có danh tính: ký ad-hoc, không hardened runtime, không chạm keychain.
  assert.deepEqual(bugFindingBuildCommands({ checkout: '/t/bf', outDir: '/o', identity: null }).at(-1), [
    'bash',
    '/t/bf/apps/mr-review-queue/scripts/build-app.sh',
    '--out',
    '/o',
    '--sign',
    '-',
  ]);
});

test('cần Swift 6 để build Bug Finding', () => {
  const v6 = 'swift-driver version: 1.168.6 Apple Swift version 6.4 (swiftlang-6.4.0.34.1)';
  assert.equal(hasSwift6({ status: 0, stdout: v6 }), true);
  assert.equal(hasSwift6({ status: 0, stdout: 'Apple Swift version 5.10' }), false);
  assert.equal(hasSwift6({ status: 1, stdout: '' }), false);
  assert.equal(EXIT.swift, 9);
});
