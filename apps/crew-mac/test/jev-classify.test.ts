import { describe, expect, it } from 'vitest';
import {
  type Category,
  dangerCategory,
  type GitFacts,
  gitPushDir,
  needsGitFacts,
  readGitFacts,
} from '../src/jev/classify.js';
import { fakeMac } from './helpers/fake-mac.js';
import { FakeRunner } from './helpers/fake-runner.js';

const GITHUB_ON_FEATURE: GitFacts = { defaultBranch: 'main', currentBranch: 'crew/x', originIsGithub: true };
const GITHUB_ON_MAIN: GitFacts = { defaultBranch: 'main', currentBranch: 'main', originIsGithub: true };
const GITLAB_ON_MAIN: GitFacts = { defaultBranch: 'main', currentBranch: 'main', originIsGithub: false };

const dangerous: Array<[string, Category, GitFacts?]> = [
  // rm_recursive
  ['rm -rf build', 'rm_recursive'],
  ['rm -fr build', 'rm_recursive'],
  ['rm -r dir', 'rm_recursive'],
  ['rm -R dir', 'rm_recursive'],
  ['rm --recursive dir', 'rm_recursive'],
  ['sudo rm -rf /tmp/x', 'rm_recursive'],
  ['env FOO=1 rm -rf x', 'rm_recursive'],
  ['cd /tmp && rm -rf x', 'rm_recursive'],
  ['ls; rm -Rf y', 'rm_recursive'],
  ['rm -rf "$D"', 'rm_recursive'],
  ['D=$(mktemp -d); D=/; rm -rf "$D"', 'rm_recursive'],
  ['D=$(mktemp); rm -rf "$D"', 'rm_recursive'],
  ['D=$(mktemp -d); rm -rf "$D/../x"', 'rm_recursive'],
  ['D=$(mktemp -d); rm -rf "$D" /etc', 'rm_recursive'],
  // tiền tố và từ khóa shell
  ['sudo -u root rm -rf /x', 'rm_recursive'],
  ['/usr/bin/sudo rm -rf /x', 'rm_recursive'],
  ['/usr/bin/env git push --force origin crew/x', 'force_push'],
  ['nice git push --force origin crew/x', 'force_push'],
  ['nice -n 5 rm -rf x', 'rm_recursive'],
  ['timeout 10 git push --force origin crew/x', 'force_push'],
  ['timeout -s KILL 10 rm -rf x', 'rm_recursive'],
  ['caffeinate -i rm -rf x', 'rm_recursive'],
  ['command rm -rf x', 'rm_recursive'],
  ['exec git push -f origin crew/x', 'force_push'],
  ['if true; then git push --force origin crew/x; fi', 'force_push'],
  ['for d in a b; do rm -rf "$d"; done', 'rm_recursive'],
  ['while true; do rm -rf x; done', 'rm_recursive'],
  ['{ git push --force origin crew/x; }', 'force_push'],
  ['( rm -rf x )', 'rm_recursive'],
  ['! rm -rf x', 'rm_recursive'],
  ['find . -name "*.log" -delete', 'rm_recursive'],
  ['find . -type d -exec rm -rf {} \\;', 'rm_recursive'],
  ['bash -c "rm -rf node_cache"', 'rm_recursive'],
  ['ls | xargs rm -rf', 'rm_recursive'],
  // no_verify
  ['git commit --no-verify -m "x"', 'no_verify'],
  ['git commit -n -m "x"', 'no_verify'],
  ['git commit -anm "x"', 'no_verify'],
  ['git push --no-verify origin crew/x', 'no_verify'],
  ['git -c core.hooksPath=/dev/null commit -m x', 'no_verify'],
  ['git -C /repo -c core.hookspath=x commit -m y', 'no_verify'],
  // force_push
  ['git push -f origin crew/x', 'force_push'],
  ['git push --force origin crew/x', 'force_push'],
  ['git push --force-with-lease origin crew/x', 'force_push'],
  ['git push --force-with-lease=crew/x origin crew/x', 'force_push'],
  ['git push --mirror backup', 'force_push'],
  ['git push origin +crew/x', 'force_push'],
  ['git push -uf origin crew/x', 'force_push'],
  // push_default
  ['git push origin main', 'push_default', GITHUB_ON_FEATURE],
  ['git push origin HEAD:main', 'push_default', GITHUB_ON_FEATURE],
  ['git push origin refs/heads/main', 'push_default', GITHUB_ON_FEATURE],
  ['git push origin crew/x:refs/heads/main', 'push_default', GITHUB_ON_FEATURE],
  ['git push', 'push_default', GITHUB_ON_MAIN],
  ['git push origin', 'push_default', GITHUB_ON_MAIN],
  ['git push -u origin HEAD', 'push_default', GITHUB_ON_MAIN],
  [
    'git push origin master',
    'push_default',
    { defaultBranch: null, currentBranch: 'crew/x', originIsGithub: true },
  ],
  // pr_merge
  ['gh pr merge 12 --squash', 'pr_merge'],
  ['gh api -X PUT repos/o/r/pulls/12/merge', 'pr_merge'],
  ['gh pr --repo o/r merge 12', 'pr_merge'],
  ['gh -R o/r pr merge 12', 'pr_merge'],
  ['gh pr merge --repo o/r 12', 'pr_merge'],
  ['curl -X PUT -H "Authorization: Bearer $GH" https://api.github.com/repos/o/r/pulls/5/merge', 'pr_merge'],
  [
    'gh api graphql -f query=\'mutation{mergePullRequest(input:{pullRequestId:"x"}){clientMutationId}}\'',
    'pr_merge',
  ],
  // credential
  ['security find-generic-password -s crew.jev.x -w', 'credential'],
  ['security find-internet-password -s github.com', 'credential'],
  ['security dump-keychain', 'credential'],
  ['cat ~/.ssh/id_ed25519', 'credential'],
  ['cp $HOME/.ssh/id_rsa /tmp/k', 'credential'],
  ['cat server.pem', 'credential'],
  ['base64 cert.p12', 'credential'],
  ['cat .env', 'credential'],
  ['source ./apps/web/.env.local', 'credential'],
  ['grep TOKEN < .env', 'credential'],
  ['cat ~/.config/gh/hosts.yml', 'credential'],
  ['cat ~/.claude/.credentials.json', 'credential'],
  ['cat ~/.crew/jev/config.json', 'credential'],
  ['tail -n 5 ~/.crew/jev/gate.log', 'credential'],
  ['printenv', 'credential'],
  ['env', 'credential'],
  ['echo $PAPERCLIP_API_KEY', 'credential'],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: lệnh shell có ${VAR}, không phải template của JS
  ['printf "%s" "${GITHUB_TOKEN}"', 'credential'],
  ['echo $db_password', 'credential'],
  ['printenv PAPERCLIP_API_KEY', 'credential'],
  ['tar czf /tmp/k.tgz ~/.ssh', 'credential'],
  ['zip -r /tmp/k.zip ~/.ssh/', 'credential'],
  ['cp -r ~/.ssh /tmp/x', 'credential'],
  ['cat ~/.ssh/id*', 'credential'],
  ['cat ~/.ssh/*', 'credential'],
  ['cat .env*', 'credential'],
  ['export -p', 'credential'],
  ['export', 'credential'],
  ['set', 'credential'],
  ['declare -x', 'credential'],
  ['sudo cat /root/.ssh/id_rsa', 'credential'],
  ['/usr/bin/env', 'credential'],
];

const safe: Array<[string, GitFacts?]> = [
  ['curl -H "Authorization: Bearer $PAPERCLIP_API_KEY" https://paperclip.example/api/x'],
  ['git push origin crew/req/TPS-1', GITHUB_ON_FEATURE],
  ['git push origin crew/x', GITHUB_ON_MAIN],
  ['git push -u origin crew/x', GITHUB_ON_FEATURE],
  ['git push', GITHUB_ON_FEATURE],
  ['git push origin main', GITLAB_ON_MAIN],
  ['git push origin main'],
  ['rm file.txt'],
  ['rm -f file.txt'],
  ['cp .env.example .env'],
  ['cat .env.sample'],
  ['git status'],
  ['pnpm test'],
  ['git commit -m "fix: rm -rf trong message"'],
  ['git commit -m "-n là cờ"'],
  ['echo "rm -rf /"'],
  ['echo hello $HOME'],
  ['printenv PATH'],
  ['env FOO=1 node script.js'],
  ['gh pr view 12'],
  ['gh pr create --fill'],
  ['find . -name "*.ts"'],
  ['ls ~/.ssh'],
  ['git log --oneline -n 5'],
  [''],
  ['D=$(mktemp -d)\nrm -rf "$D"'],
  ['D=$(mktemp -d -t crew); trap \'rm -rf "$D"\' EXIT; rm -rf "$D"'],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: lệnh shell có ${D}, không phải template của JS
  ['D="$(mktemp -d)"; rm -rf "${D}/out"'],
  ['git push origin crew/req/TPS-9 && git push origin crew/req/TPS-9:crew/req/TPS-9', GITHUB_ON_MAIN],
  [
    'curl -sf -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" https://p/api/issues',
  ],
  ['cp .env.example .env && cat .env.example'],
  ["echo '$X_TOKEN là tên biến'"],
  ['cat > notes.md <<EOF\nrm -rf build\ngit push --force\nEOF'],
  ["cat <<'EOF' > a.sh\nrm -rf /\nEOF\nls"],
  ['printenv HOME'],
  ['set -euo pipefail'],
  ['export FOO=1'],
  ['declare -a xs'],
  ['gh pr view 12 --repo o/r'],
  ['nice -n 5 pnpm test'],
  ['timeout 30 pnpm test'],
  ['if [ -f x ]; then cat x; fi'],
  ['tar czf out.tgz src'],
];

describe('dangerCategory', () => {
  it.each(dangerous)('%j → %s', (command, category, git) => {
    expect(dangerCategory(command, git ?? null)).toBe(category);
  });

  it.each(safe)('%j không thuộc nhóm nào', (command, git) => {
    expect(dangerCategory(command, git ?? null)).toBeNull();
  });

  it('có đủ ca cho mọi nhóm', () => {
    expect(dangerous.length + safe.length).toBeGreaterThanOrEqual(35);
    const seen = new Set(dangerous.map(([, category]) => category));
    expect([...seen].sort()).toEqual(
      ['credential', 'force_push', 'no_verify', 'pr_merge', 'push_default', 'rm_recursive'].sort(),
    );
  });
});

describe('needsGitFacts', () => {
  it('chỉ đúng khi lệnh có git push thật', () => {
    expect(needsGitFacts('git push origin main')).toBe(true);
    expect(needsGitFacts('cd x && git -C y push')).toBe(true);
    expect(needsGitFacts('bash -c "git push"')).toBe(true);
    expect(needsGitFacts('git status')).toBe(false);
    expect(needsGitFacts('rm -rf x')).toBe(false);
    expect(needsGitFacts('echo "use git push --force"')).toBe(false);
    expect(needsGitFacts('git commit -m "push"')).toBe(false);
  });

  it('gitPushDir theo cd đứng trước và git -C', () => {
    expect(gitPushDir('git push', '/w')).toBe('/w');
    expect(gitPushDir('cd /r && git push', '/w')).toBe('/r');
    expect(gitPushDir('cd sub; git push', '/w')).toBe('/w/sub');
    expect(gitPushDir('git -C ../o push', '/w/a')).toBe('/w/o');
    expect(gitPushDir('cd ~/x && git push', '/w')).toBe('/w');
    expect(gitPushDir('ls', '/w')).toBeNull();
  });
});

describe('readGitFacts', () => {
  it('đọc nhánh mặc định, nhánh hiện tại và origin bằng git -C với hạn 1 giây', async () => {
    const { ctx } = fakeMac();
    const runner = new FakeRunner().on('git', (args) => {
      const joined = args.join(' ');
      if (joined.includes('refs/remotes/origin/HEAD')) return { stdout: 'origin/main\n' };
      if (joined.endsWith('symbolic-ref --quiet --short HEAD')) return { stdout: 'crew/x\n' };
      if (joined.includes('get-url')) return { stdout: 'git@github.com:o/r.git\n' };
      return { code: 1 };
    });
    const facts = await readGitFacts({ ...ctx, runner }, '/repo');
    expect(facts).toEqual({ defaultBranch: 'main', currentBranch: 'crew/x', originIsGithub: true });
    expect(runner.calls.every((c) => c.args[0] === '-C' && c.args[1] === '/repo')).toBe(true);
    expect(runner.calls.every((c) => c.options.timeoutMs === 1000)).toBe(true);
  });

  it('git lỗi thì trả giá trị rỗng, không ném', async () => {
    const { ctx } = fakeMac();
    const runner = new FakeRunner().on('git', () => ({ code: 128 }));
    expect(await readGitFacts({ ...ctx, runner }, '/repo')).toEqual({
      defaultBranch: null,
      currentBranch: null,
      originIsGithub: false,
    });
  });
});
