/**
 * Hàm thuần của script phát hành app macOS 2P Crew (`release.mjs`): đọc đối số, kiểm cây git và tag, chọn danh tính
 * ký, dựng lệnh build/ký/notarize/đăng, đọc kết quả tự kiểm. Không gọi process nào, không đọc env, để test bằng
 * `node --test`.
 */

export const BUNDLE_ID = 'com.2p-solutions.crew.mac';
export const PRODUCT_NAME = '2P Crew';
/** Team ID của 2P SOLUTIONS JOINT STOCK COMPANY: mọi bản ký (kể cả Apple Development) phải thuộc team này. */
export const TEAM_ID = 'J7Y2DL6HZV';
export const RELEASE_OWNER = 'nquangphan';
export const RELEASE_REPO_NAME = 'crew-mac-releases';
export const RELEASE_REPO = `${RELEASE_OWNER}/${RELEASE_REPO_NAME}`;
export const NOTARY_PROFILE = 'crew-notary';
export const TAG_PREFIX = 'mac-app/v';

export const EXIT = {
  ok: 0,
  usage: 1,
  dirty: 2,
  tag: 3,
  identity: 4,
  build: 5,
  notarize: 6,
  verify: 7,
  publish: 8,
};

/** Loại chứng chỉ theo chế độ: phát hành cần Developer ID, `--dev-sign` dùng Apple Development. */
export const IDENTITY_KIND = { release: 'Developer ID Application', 'dev-sign': 'Apple Development' };

const USAGE_PREFIXES = [
  'Developer ID Application',
  'Developer ID Installer',
  'Apple Development',
  'Apple Distribution',
  'Mac Developer',
  '3rd Party Mac Developer Application',
  '3rd Party Mac Developer Installer',
];

const USAGE_DESCRIPTIONS = [
  'NSDocumentsFolderUsageDescription',
  'NSDesktopFolderUsageDescription',
  'NSDownloadsFolderUsageDescription',
  'NSRemovableVolumesUsageDescription',
];

/**
 * `release.mjs [--publish | --no-publish] [--identity <tên>]`, `--dev-sign [--no-publish] [--identity <tên>]`,
 * `--dry-run`. Đăng GitHub chỉ khi có `--publish` và chỉ ở chế độ phát hành.
 */
export function parseArgs(argv) {
  let mode = 'release';
  let publish = null;
  let identity = null;
  const modes = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dev-sign' || arg === '--dry-run') {
      modes.push(arg);
      mode = arg.slice(2);
    } else if (arg === '--publish') {
      if (publish === false) return { error: 'Không dùng --publish cùng --no-publish.' };
      publish = true;
    } else if (arg === '--no-publish') {
      if (publish === true) return { error: 'Không dùng --publish cùng --no-publish.' };
      publish = false;
    } else if (arg === '--identity') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) return { error: '--identity cần tên danh tính ký.' };
      identity = value;
      i++;
    } else if (arg.startsWith('--identity=')) {
      identity = arg.slice('--identity='.length);
      if (!identity) return { error: '--identity cần tên danh tính ký.' };
    } else {
      return { error: `Cờ không hỗ trợ: ${arg}` };
    }
  }
  if (modes.length > 1) return { error: 'Chọn một trong --dev-sign hoặc --dry-run.' };
  if (mode !== 'release' && publish === true)
    return { error: `--publish chỉ dùng cho bản phát hành, không dùng với --${mode}.` };
  if (mode === 'dry-run' && identity) return { error: '--dry-run không ký nên không nhận --identity.' };
  return { mode, publish: publish === true, identity };
}

export function isCleanTree(porcelain) {
  return porcelain.trim() === '';
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Tag nguồn `mac-app/v<version>` phải trỏ đúng HEAD; version là semver không prerelease (updater không nhận prerelease). */
export function checkTag({ version, tagsAtHead }) {
  if (!SEMVER.test(version))
    return { ok: false, reason: `version "${version}" trong package.json không phải semver x.y.z.` };
  const tag = `${TAG_PREFIX}${version}`;
  if (tagsAtHead.includes(tag)) return { ok: true, tag };
  const others = tagsAtHead.filter((t) => t.startsWith(TAG_PREFIX));
  const seen = others.length > 0 ? ` HEAD đang có ${others.join(', ')}.` : ' HEAD chưa có tag mac-app nào.';
  return { ok: false, reason: `Thiếu tag ${tag} tại HEAD.${seen} Tạo bằng: git tag ${tag}` };
}

/** Tên các danh tính ký hợp lệ trong `security find-identity -v -p codesigning`; không giữ hash. */
export function parseIdentities(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\d+\)\s+\S+\s+"(.+)"\s*$/);
    if (m) out.push({ name: m[1] });
  }
  return out;
}

export function teamIdFromSubject(subject) {
  const m = subject.match(/(?:^|\n|,\s*)OU=([A-Z0-9]{10})(?:\n|,|$)/);
  return m ? m[1] : null;
}

function kindOf(name) {
  const i = name.indexOf(': ');
  return i < 0 ? null : name.slice(0, i);
}

/**
 * Chọn đúng một danh tính loại `kind` thuộc `teamId`. `wanted` (từ `--identity`) phải khớp nguyên tên. Mỗi phần tử
 * `identities` có `teamId` (Developer ID lấy từ tên, Apple Development lấy từ OU của chứng chỉ).
 */
export function pickIdentity({ kind, identities, teamId, wanted = null }) {
  const ofKind = identities.filter((it) => kindOf(it.name) === kind);
  if (wanted) {
    const hit = identities.find((it) => it.name === wanted);
    if (!hit) return { ok: false, reason: `Keychain không có danh tính "${wanted}".` };
    if (kindOf(hit.name) !== kind) return { ok: false, reason: `"${wanted}" không phải ${kind}.` };
    if (hit.teamId !== teamId)
      return { ok: false, reason: `"${wanted}" thuộc team ${hit.teamId ?? 'không rõ'}, cần team ${teamId}.` };
    return { ok: true, name: hit.name, teamId };
  }
  if (ofKind.length === 0) return { ok: false, reason: `Keychain chưa có ${kind}.` };
  const ofTeam = ofKind.filter((it) => it.teamId === teamId);
  if (ofTeam.length === 0) return { ok: false, reason: `Keychain chưa có ${kind} của team ${teamId}.` };
  if (ofTeam.length > 1)
    return {
      ok: false,
      reason: `Có ${ofTeam.length} danh tính ${kind} của team ${teamId}; chọn một bằng --identity "<tên>": ${ofTeam
        .map((it) => it.name)
        .join(' | ')}`,
    };
  return { ok: true, name: ofTeam[0].name, teamId };
}

/** Developer ID Application: Team ID nằm trong ngoặc cuối tên. */
export function findDeveloperId(findIdentityOutput, { teamId = TEAM_ID, wanted = null } = {}) {
  const identities = parseIdentities(findIdentityOutput).map((it) => ({
    name: it.name,
    teamId: it.name.match(/\(([A-Z0-9]{10})\)$/)?.[1] ?? null,
  }));
  return pickIdentity({ kind: 'Developer ID Application', identities, teamId, wanted });
}

/** electron-builder nhận tên không có tiền tố loại chứng chỉ (nó tự chọn loại theo `mac.type`). */
export function cscName(name) {
  for (const prefix of USAGE_PREFIXES)
    if (name.startsWith(`${prefix}: `)) return name.slice(prefix.length + 2);
  return name;
}

/** Kết quả `xcrun notarytool history --keychain-profile crew-notary` (không in stdout của nó). */
export function notaryProfileState({ status, stderr }) {
  if (status === 0) return 'ok';
  if (/No Keychain password item found for profile/i.test(stderr ?? '')) return 'missing';
  return 'error';
}

/** Danh sách lý do dừng bản phát hành vì thiếu chứng chỉ hay notary profile (rỗng = đủ). */
export function missingCredentials({ identity, notary }) {
  const out = [];
  if (!identity.ok) out.push(`Chưa có Developer ID Application: ${identity.reason}`);
  if (notary === 'missing')
    out.push(
      `Chưa có notary profile ${NOTARY_PROFILE}. Owner tạo một lần: xcrun notarytool store-credentials ${NOTARY_PROFILE} (nhập Apple ID, Team ID, app-specific password khi được hỏi).`,
    );
  else if (notary === 'error')
    out.push(`Không kiểm được notary profile ${NOTARY_PROFILE} (mạng hoặc Apple). Chạy lại sau.`);
  return out;
}

export function parseNotarySubmit(json) {
  try {
    const data = JSON.parse(json);
    const id = typeof data.id === 'string' ? data.id : null;
    const status = typeof data.status === 'string' ? data.status : null;
    return { ok: status === 'Accepted', id, status };
  } catch {
    return { ok: false, id: null, status: null };
  }
}

export function notarizedBySpctl(text) {
  return /:\s*accepted\b/.test(text) && /source=Notarized Developer ID/.test(text);
}

/** Team ID trong designated requirement của bản Developer ID (`certificate leaf[subject.OU] = <team>`). */
export function teamIdOf(requirement) {
  const m = requirement.match(/certificate leaf\[subject\.OU\]\s*=\s*"?([A-Z0-9]{10})"?/);
  return m ? m[1] : null;
}

/** Đọc `codesign -dv --verbose=2` (ghi ra stderr). Bỏ qua CDHash. */
export function parseCodesignDetails(text) {
  const field = (key) => text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() ?? null;
  const flags = text.match(/^CodeDirectory .*flags=0x[0-9a-f]+\(([^)]*)\)/m)?.[1] ?? '';
  const team = field('TeamIdentifier');
  return {
    identifier: field('Identifier'),
    teamId: team && team !== 'not set' ? team : null,
    authority: field('Authority'),
    runtime: flags.split(',').includes('runtime'),
  };
}

export function checkSignature(details, { kind, teamId, bundleId = BUNDLE_ID }) {
  const problems = [];
  if (details.identifier !== bundleId) problems.push(`Identifier là ${details.identifier}, cần ${bundleId}.`);
  if (!details.authority?.startsWith(`${kind}: `))
    problems.push(`Ký bởi ${details.authority ?? 'không ai (ad-hoc/không ký)'}, cần ${kind}.`);
  if (details.teamId !== teamId)
    problems.push(`TeamIdentifier là ${details.teamId ?? 'không có'}, cần ${teamId}.`);
  if (!details.runtime) problems.push('Thiếu hardened runtime (flags không có runtime).');
  return problems;
}

export function checkInfoPlist(plist, { version }) {
  const problems = [];
  if (plist.CFBundleIdentifier !== BUNDLE_ID)
    problems.push(`CFBundleIdentifier là ${plist.CFBundleIdentifier}, cần ${BUNDLE_ID}.`);
  if (plist.CFBundleName !== PRODUCT_NAME)
    problems.push(`CFBundleName là ${plist.CFBundleName}, cần ${PRODUCT_NAME}.`);
  if (plist.CFBundleShortVersionString !== version)
    problems.push(`CFBundleShortVersionString là ${plist.CFBundleShortVersionString}, cần ${version}.`);
  for (const key of USAGE_DESCRIPTIONS) if (!plist[key]) problems.push(`Thiếu ${key}.`);
  return problems;
}

/** `Contents/Resources/app-update.yml` (electron-builder sinh từ mục `publish`) là nguồn cấu hình của updater. */
export function checkAppUpdateYml(text) {
  if (text == null)
    return ['Bundle thiếu Contents/Resources/app-update.yml (electron-builder.yml thiếu mục publish?).'];
  const want = [`owner: ${RELEASE_OWNER}`, `repo: ${RELEASE_REPO_NAME}`, 'provider: github'];
  const missing = want.filter((line) => !text.split('\n').some((l) => l.trim() === line));
  return missing.length ? [`app-update.yml không trỏ ${RELEASE_REPO} (thiếu ${missing.join(', ')}).`] : [];
}

export function artifactNames(version) {
  const zip = `2P-Crew-${version}-arm64-mac.zip`;
  const dmg = `2P-Crew-${version}-arm64.dmg`;
  return {
    zip,
    dmg,
    zipBlockmap: `${zip}.blockmap`,
    dmgBlockmap: `${dmg}.blockmap`,
    latest: 'latest-mac.yml',
  };
}

export function checkLatestMacYml(text, version) {
  if (text == null) return ['Thiếu latest-mac.yml.'];
  const problems = [];
  if (!new RegExp(`^version: ${version.replaceAll('.', '\\.')}$`, 'm').test(text))
    problems.push(`latest-mac.yml không ghi version ${version}.`);
  if (!text.includes(`url: ${artifactNames(version).zip}`))
    problems.push(`latest-mac.yml không trỏ ${artifactNames(version).zip}.`);
  return problems;
}

/** Che hash SHA-1 (danh tính ký, CDHash) trong log của công cụ; sha256 (64 ký tự) giữ nguyên. */
export function maskHashes(text) {
  return text.replace(/(?<![0-9A-Fa-f])[0-9A-Fa-f]{40}(?![0-9A-Fa-f])/g, '<đã che>');
}

/**
 * Thư mục ra của bản build. Phải nằm ngoài thư mục do File Provider quản (repo trên Mac mini ở ~/Documents, nơi
 * iCloud gắn com.apple.FinderInfo vào mọi bundle mới tạo, làm codesign báo "resource fork, Finder information, or
 * similar detritus not allowed").
 */
export function releaseOutDir(home) {
  return `${home}/Library/Caches/2p-crew-release`;
}

/**
 * Các lệnh build/ký/notarize/đóng gói/đăng theo thứ tự. Mỗi bước: `id`, `cmd`, `args` (mảng, không qua shell),
 * `cwd`, `env` thêm (danh tính chỉ đi qua `CSC_NAME`), `exit` khi lỗi, `parse: 'notary'` khi phải đọc JSON.
 * Không bước nào nhận secret: notarize chỉ qua keychain profile.
 */
export function buildCommands({ mode, publish, version, identityName, paths }) {
  const { root, appDir, appPath, dist, tmp } = paths;
  const names = artifactNames(version);
  const dmgPath = `${dist}/${names.dmg}`;
  const signEnv =
    mode === 'dry-run'
      ? { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
      : { CSC_NAME: cscName(identityName), CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  const outArg = `--config.directories.output=${dist}`;
  // Target zip (không phải dir): electron-builder chỉ ghi Contents/Resources/app-update.yml khi có target zip/dmg.
  // Zip của bước này bị bước `package` ghi đè bằng zip đóng từ bản đã staple.
  const packArgs = ['exec', 'electron-builder', '--mac', 'zip', '--arm64', '--publish', 'never', outArg];
  if (mode === 'dev-sign') packArgs.push('--config.mac.type=development');
  const notarize = (id, file) => ({
    id,
    cmd: 'xcrun',
    args: [
      'notarytool',
      'submit',
      file,
      '--keychain-profile',
      NOTARY_PROFILE,
      '--wait',
      '--output-format',
      'json',
    ],
    cwd: root,
    env: {},
    exit: EXIT.notarize,
    parse: 'notary',
  });
  const staple = (id, file) => ({
    id,
    cmd: 'xcrun',
    args: ['stapler', 'staple', file],
    cwd: root,
    env: {},
    exit: EXIT.notarize,
  });
  const steps = [
    {
      id: 'build-mac',
      cmd: 'pnpm',
      args: ['--filter', '@crew/mac', 'build'],
      cwd: root,
      env: {},
      exit: EXIT.build,
    },
    {
      id: 'build-app',
      cmd: 'pnpm',
      args: ['--filter', '@crew/mac-app', 'build'],
      cwd: root,
      env: {},
      exit: EXIT.build,
    },
    { id: 'pack-app', cmd: 'pnpm', args: packArgs, cwd: appDir, env: signEnv, exit: EXIT.build },
  ];
  if (mode === 'release') {
    steps.push(
      {
        id: 'zip-for-notary',
        cmd: 'ditto',
        args: ['-c', '-k', '--keepParent', appPath, `${tmp}/app.zip`],
        cwd: root,
        env: {},
        exit: EXIT.notarize,
      },
      notarize('notarize-app', `${tmp}/app.zip`),
      staple('staple-app', appPath),
    );
  }
  steps.push({
    id: 'package',
    cmd: 'pnpm',
    args: [
      'exec',
      'electron-builder',
      '--mac',
      'zip',
      'dmg',
      '--arm64',
      outArg,
      '--prepackaged',
      appPath,
      '--publish',
      'never',
    ],
    cwd: appDir,
    env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    exit: EXIT.build,
  });
  if (mode === 'release') steps.push(notarize('notarize-dmg', dmgPath), staple('staple-dmg', dmgPath));
  if (mode === 'release' && publish) {
    steps.push({
      id: 'publish',
      cmd: 'gh',
      args: [
        'release',
        'create',
        `v${version}`,
        '--repo',
        RELEASE_REPO,
        '--title',
        `${PRODUCT_NAME} ${version}`,
        '--notes',
        `Bản ${version} của app macOS ${PRODUCT_NAME}.`,
        ...[names.zip, names.dmg, names.zipBlockmap, names.dmgBlockmap, names.latest].map(
          (f) => `${dist}/${f}`,
        ),
      ],
      cwd: root,
      env: {},
      exit: EXIT.publish,
    });
  }
  return steps;
}
