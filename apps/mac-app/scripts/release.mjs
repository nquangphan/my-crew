#!/usr/bin/env node
/**
 * Phát hành app macOS 2P Crew trên Mac mini.
 *
 *   node apps/mac-app/scripts/release.mjs [--publish | --no-publish] [--identity "<tên>"]
 *     Bản phát hành: cây sạch, tag mac-app/v<version> tại HEAD, ký Developer ID Application, notarize + staple
 *     app và dmg bằng keychain profile crew-notary, tự kiểm. Chỉ đăng lên GitHub Releases khi có --publish.
 *   node apps/mac-app/scripts/release.mjs --dev-sign [--no-publish] [--identity "<tên>"]
 *     Bản thử: ký Apple Development của team 2P, không kiểm tag, không notarize, không bao giờ đăng.
 *   node apps/mac-app/scripts/release.mjs --dry-run
 *     Không ký, không notarize, không đăng: chỉ thử build và đóng gói.
 *
 * Mọi lệnh chạy bằng mảng đối số (không shell). Không đọc, in hay đưa vào argv mật khẩu/API key: notarize chỉ qua
 * `--keychain-profile`, danh tính ký chỉ qua biến CSC_NAME. Log của công cụ được che hash SHA-1.
 * Mã thoát: xem EXIT trong release-lib.mjs (2 cây bẩn, 3 tag, 4 danh tính/notary profile, 5 build, 6 notarize,
 * 7 tự kiểm, 8 đăng).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  artifactNames,
  BUNDLE_ID,
  buildCommands,
  checkAppUpdateYml,
  checkInfoPlist,
  checkLatestMacYml,
  checkSignature,
  checkTag,
  EXIT,
  findDeveloperId,
  IDENTITY_KIND,
  isCleanTree,
  maskHashes,
  missingCredentials,
  NOTARY_PROFILE,
  notarizedBySpctl,
  notaryProfileState,
  PRODUCT_NAME,
  parseArgs,
  parseCodesignDetails,
  parseIdentities,
  parseNotarySubmit,
  pickIdentity,
  releaseOutDir,
  TEAM_ID,
  teamIdFromSubject,
  teamIdOf,
} from './release-lib.mjs';

class Stop extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const say = (line) => process.stdout.write(`${maskHashes(line)}\n`);

/** Chạy lệnh lấy đầu ra (không in). */
function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Chạy lệnh dài, in đầu ra theo dòng sau khi che hash. */
function stream(cmd, args, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const pipe = (src, dst) => {
      let buf = '';
      src.setEncoding('utf8');
      src.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) dst.write(`${maskHashes(line)}\n`);
      });
      src.on('end', () => buf && dst.write(`${maskHashes(buf)}\n`));
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    child.on('error', (err) => resolve({ status: -1, error: err }));
    child.on('close', (status) => resolve({ status }));
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

function repoRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  const r = capture('git', ['rev-parse', '--show-toplevel'], { cwd: here });
  if (r.status !== 0) throw new Stop(EXIT.usage, 'Không tìm thấy repo git.');
  return r.stdout.trim();
}

/** Team ID của một danh tính Apple Development: OU của chứng chỉ có CN trùng tên (chỉ đọc phần công khai). */
function teamOfCertificate(name) {
  const r = capture('security', ['find-certificate', '-a', '-c', name, '-p']);
  if (r.status !== 0) return null;
  const pems = r.stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  for (const pem of pems) {
    const subject = new X509Certificate(pem).subject;
    if (subject.split('\n').includes(`CN=${name}`)) return teamIdFromSubject(subject);
  }
  return null;
}

function resolveIdentity(mode, wanted) {
  const found = capture('security', ['find-identity', '-v', '-p', 'codesigning']);
  if (found.status !== 0)
    throw new Stop(EXIT.identity, 'Không đọc được danh tính ký trong Keychain (security find-identity).');
  if (mode === 'release') return findDeveloperId(found.stdout, { teamId: TEAM_ID, wanted });
  const kind = IDENTITY_KIND[mode];
  const identities = parseIdentities(found.stdout).map((it) => ({
    name: it.name,
    teamId: it.name.startsWith(`${kind}: `) ? teamOfCertificate(it.name) : null,
  }));
  return pickIdentity({ kind, identities, teamId: TEAM_ID, wanted });
}

function checkNotaryProfile() {
  const r = capture('xcrun', [
    'notarytool',
    'history',
    '--keychain-profile',
    NOTARY_PROFILE,
    '--output-format',
    'json',
  ]);
  return notaryProfileState(r);
}

async function runStep(step) {
  say(`\n▶ ${step.id}: ${step.cmd} ${step.args.join(' ')}`);
  const env = { ...process.env, ...step.env };
  if (step.parse === 'notary') {
    const r = capture(step.cmd, step.args, { cwd: step.cwd, env });
    const result = parseNotarySubmit(r.stdout);
    say(`  notarize: id=${result.id ?? '?'} status=${result.status ?? '?'}`);
    if (r.status !== 0 || !result.ok) {
      if (r.stderr.trim()) say(`  ${r.stderr.trim().split('\n').slice(-3).join('\n  ')}`);
      const hint = result.id
        ? ` Xem lý do: xcrun notarytool log ${result.id} --keychain-profile ${NOTARY_PROFILE}`
        : '';
      throw new Stop(step.exit, `Notarize không được chấp nhận (${step.id}).${hint}`);
    }
    return;
  }
  const r = await stream(step.cmd, step.args, { cwd: step.cwd, env });
  if (r.status !== 0) throw new Stop(step.exit, `Bước ${step.id} lỗi (mã ${r.status}).`);
}

function verifySigned(appPath, { kind, teamId }, label) {
  const problems = [];
  const v = capture('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  if (v.status !== 0)
    problems.push(`${label}: codesign --verify --deep --strict lỗi: ${maskHashes(v.stderr.trim())}`);
  else say(`  ✓ ${label}: codesign --verify --deep --strict đạt`);
  const d = capture('codesign', ['-dv', '--verbose=2', appPath]);
  const details = parseCodesignDetails(`${d.stdout}\n${d.stderr}`);
  const sig = checkSignature(details, { kind, teamId, bundleId: BUNDLE_ID });
  problems.push(...sig.map((p) => `${label}: ${p}`));
  if (sig.length === 0)
    say(
      `  ✓ ${label}: ${details.authority}, TeamIdentifier=${details.teamId}, ${details.identifier}, hardened runtime`,
    );
  return problems;
}

async function verify({ mode, version, identity, paths }) {
  say('\n▶ tự kiểm');
  const { appPath, dist, tmp } = paths;
  const names = artifactNames(version);
  const problems = [];
  const signed = mode !== 'dry-run';
  const want = { kind: IDENTITY_KIND[mode], teamId: identity?.teamId };

  if (signed) problems.push(...verifySigned(appPath, want, '.app'));

  const plist = capture('plutil', ['-convert', 'json', '-o', '-', join(appPath, 'Contents/Info.plist')]);
  const plistProblems =
    plist.status === 0
      ? checkInfoPlist(JSON.parse(plist.stdout), { version })
      : ['Không đọc được Info.plist.'];
  problems.push(...plistProblems);
  if (plistProblems.length === 0)
    say(`  ✓ Info.plist: ${BUNDLE_ID}, ${PRODUCT_NAME} ${version}, đủ 4 lời xin quyền`);

  const updateYml = join(appPath, 'Contents/Resources/app-update.yml');
  const ymlProblems = checkAppUpdateYml(existsSync(updateYml) ? readFileSync(updateYml, 'utf8') : null);
  problems.push(...ymlProblems);
  if (ymlProblems.length === 0) say('  ✓ app-update.yml trỏ nquangphan/crew-mac-releases');

  for (const f of [names.zip, names.dmg, names.zipBlockmap, names.dmgBlockmap])
    if (!existsSync(join(dist, f))) problems.push(`Thiếu ${f} trong ${dist}.`);
  const latest = join(dist, names.latest);
  const latestProblems = checkLatestMacYml(existsSync(latest) ? readFileSync(latest, 'utf8') : null, version);
  problems.push(...latestProblems);
  if (latestProblems.length === 0) say(`  ✓ latest-mac.yml: version ${version}, ${names.zip}`);

  if (signed && existsSync(join(dist, names.zip))) {
    const out = join(tmp, 'unzip');
    const x = capture('ditto', ['-x', '-k', join(dist, names.zip), out]);
    if (x.status !== 0) problems.push(`Không giải nén được ${names.zip}.`);
    else problems.push(...verifySigned(join(out, `${PRODUCT_NAME}.app`), want, `app trong ${names.zip}`));
  }

  if (mode === 'release') {
    const s = capture('spctl', ['-a', '-vv', appPath]);
    if (!notarizedBySpctl(`${s.stdout}\n${s.stderr}`))
      problems.push(`spctl không nhận bản notarize: ${s.stderr.trim()}`);
    else say('  ✓ spctl: accepted, Notarized Developer ID');
    for (const file of [appPath, join(dist, names.dmg)]) {
      const st = capture('xcrun', ['stapler', 'validate', file]);
      if (st.status !== 0) problems.push(`stapler validate lỗi: ${file}`);
      else say(`  ✓ stapler validate: ${file}`);
    }
    const req = capture('codesign', ['-d', '-r-', appPath]);
    const team = teamIdOf(`${req.stdout}\n${req.stderr}`);
    if (team !== identity.teamId)
      problems.push(`Designated requirement có team ${team ?? 'không có'}, cần ${identity.teamId}.`);
    else say(`  ✓ designated requirement: subject.OU = ${team}`);
  }

  if (problems.length > 0) throw new Stop(EXIT.verify, `Tự kiểm lỗi:\n  - ${problems.join('\n  - ')}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error)
    throw new Stop(
      EXIT.usage,
      `${opts.error}\nDùng: release.mjs [--publish|--no-publish] [--identity "<tên>"] | --dev-sign [--identity "<tên>"] | --dry-run`,
    );
  const { mode, publish } = opts;
  const root = repoRoot();
  const appDir = join(root, 'apps/mac-app');
  const version = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')).version;
  say(
    `2P Crew ${version} — chế độ ${mode}${mode === 'release' ? (publish ? ', có đăng GitHub' : ', không đăng') : ', không đăng'}`,
  );

  const status = capture('git', ['status', '--porcelain'], { cwd: root });
  if (status.status !== 0 || !isCleanTree(status.stdout))
    throw new Stop(EXIT.dirty, `Cây git không sạch:\n${status.stdout.trimEnd()}`);
  say('✓ cây git sạch');

  if (mode === 'release') {
    const tags = capture('git', ['tag', '--points-at', 'HEAD'], { cwd: root })
      .stdout.split('\n')
      .filter(Boolean);
    const tag = checkTag({ version, tagsAtHead: tags });
    if (!tag.ok) throw new Stop(EXIT.tag, tag.reason);
    say(`✓ tag ${tag.tag} tại HEAD`);
  } else {
    say('· chế độ thử: không kiểm tag mac-app/v*');
  }

  let identity = null;
  if (mode === 'release') {
    const id = resolveIdentity(mode, opts.identity);
    const missing = missingCredentials({ identity: id, notary: checkNotaryProfile() });
    if (missing.length > 0)
      throw new Stop(
        EXIT.identity,
        `Dừng bản phát hành:\n  - ${missing.join('\n  - ')}\nBản thử ký Apple Development: release.mjs --dev-sign`,
      );
    identity = id;
  } else if (mode === 'dev-sign') {
    const id = resolveIdentity(mode, opts.identity);
    if (!id.ok) throw new Stop(EXIT.identity, id.reason);
    identity = id;
  }
  if (identity) say(`✓ danh tính ký: ${identity.name} (team ${identity.teamId})`);
  if (mode === 'release') say(`✓ notary profile ${NOTARY_PROFILE} có trong Keychain`);

  const tmp = mkdtempSync(join(tmpdir(), 'crew-mac-release-'));
  const paths = {
    root,
    appDir,
    appPath: join(releaseOutDir(homedir()), 'mac-arm64', `${PRODUCT_NAME}.app`),
    dist: releaseOutDir(homedir()),
    tmp,
  };
  try {
    const steps = buildCommands({ mode, publish, version, identityName: identity?.name ?? null, paths });
    const publishStep = steps.find((s) => s.id === 'publish');
    for (const step of steps) if (step !== publishStep) await runStep(step);
    await verify({ mode, version, identity, paths });
    if (publishStep) await runStep(publishStep);

    say('\nKết quả:');
    say(`  app: ${paths.appPath}`);
    if (identity) say(`  ký: ${identity.name}, Team ID ${identity.teamId}`);
    const names = artifactNames(version);
    for (const f of [names.zip, names.dmg, names.latest])
      say(`  ${await sha256(join(paths.dist, f))}  ${join(paths.dist, f)}`);
    say(
      publishStep
        ? `  đã đăng: https://github.com/nquangphan/crew-mac-releases/releases/tag/v${version}`
        : '  không đăng GitHub',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(EXIT.ok),
  (err) => {
    if (err instanceof Stop) {
      process.stderr.write(`${maskHashes(err.message)}\n`);
      process.exit(err.code);
    }
    process.stderr.write(`${maskHashes(String(err?.stack ?? err))}\n`);
    process.exit(EXIT.build);
  },
);
