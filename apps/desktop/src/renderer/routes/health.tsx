import {
  HEALTH_GROUP_TITLES,
  type HealthCheckResult,
  HealthGroup,
  type HealthReport,
  type Navigate,
} from '@crew/shared';
import { useEffect, useState } from 'react';
import { HealthCheckRow } from '../components/health-check-row';
import { ErrorBox, HEALTH_LABEL, HEALTH_TONE, Lozenge, Notice, PageHeader } from '../components/ui';
import { errorText, formatTime } from '../lib/format';
import { invoke, useDesktopEvent } from '../lib/ipc';

/** Fixes that only open another screen of the app. */
export function navigationFor(fixId: string): Navigate | 'api-key-help' | null {
  const [action, key] = fixId.split(':');
  if (action === 'repair') return { route: 'setup', section: 'pairing' };
  if (action === 'repick-folder') return { route: 'settings-projects', ...(key ? { projectKey: key } : {}) };
  if (action === 'adjust-limits') return { route: 'settings', section: 'resources' };
  if (action === 'api-key-help') return 'api-key-help';
  return null;
}

export function groupResults(report: HealthReport): { group: HealthGroup; results: HealthCheckResult[] }[] {
  return HealthGroup.options
    .map((group) => ({ group, results: report.results.filter((item) => item.group === group) }))
    .filter((entry) => entry.results.length > 0);
}

/** The health dashboard: every check with its status, explanation and one-click fix. */
export function HealthPage({ navigate }: { navigate: (to: Navigate) => void }) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  useDesktopEvent('health.report', setReport);

  const runAll = async () => {
    setRunning(true);
    setError(null);
    try {
      setReport(await invoke('health.run', {}));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setRunning(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once when the page opens.
  useEffect(() => {
    void invoke('health.get', {}).then((latest) => {
      if (latest) setReport(latest);
      else void runAll();
    });
  }, []);

  const fix = async (result: HealthCheckResult) => {
    if (!result.fix) return;
    const target = navigationFor(result.fix.id);
    if (target === 'api-key-help') {
      setHelp(true);
      return;
    }
    if (target) {
      navigate(target);
      return;
    }
    setFixing(result.id);
    setError(null);
    try {
      setReport(await invoke('health.fix', { group: result.group, fixId: result.fix.id }));
    } catch (caught) {
      setError(`${result.title}: ${errorText(caught)}`);
    } finally {
      setFixing(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-8">
      <PageHeader
        title="Sức khỏe máy"
        subtitle={
          report
            ? `Kiểm tra lúc ${formatTime(report.generatedAt)} · tự chạy khi mở app và mỗi 5 phút`
            : 'Đang kiểm tra lần đầu…'
        }
        actions={
          <>
            {report && (
              <Lozenge tone={HEALTH_TONE[report.summary.status]}>
                {HEALTH_LABEL[report.summary.status]}
              </Lozenge>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={running}
              onClick={() => void runAll()}
            >
              {running ? 'Đang kiểm tra…' : 'Kiểm tra ngay'}
            </button>
          </>
        }
      />
      <ErrorBox message={error} />
      {help && (
        <div className="mb-4">
          <Notice tone="warn">
            <p className="font-semibold">Gỡ ANTHROPIC_API_KEY khỏi môi trường</p>
            <p className="mt-1">
              Tìm dòng <code>export ANTHROPIC_API_KEY=…</code> trong <code>~/.zshrc</code>,{' '}
              <code>~/.zprofile</code> hoặc <code>~/.bash_profile</code>, xoá dòng đó, rồi thoát hẳn và mở lại
              2P Crew. Nếu biến được đặt bằng <code>launchctl setenv</code>, chạy{' '}
              <code>launchctl unsetenv ANTHROPIC_API_KEY</code>. Agent chỉ dùng gói đăng ký Claude, không tính
              phí API.
            </p>
            <button type="button" className="btn mt-2" onClick={() => setHelp(false)}>
              Đã hiểu
            </button>
          </Notice>
        </div>
      )}
      <div className="space-y-5">
        {report &&
          groupResults(report).map(({ group, results }) => (
            <section key={group} className="card" data-group={group}>
              <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold">
                {HEALTH_GROUP_TITLES[group]}
              </h2>
              {results.map((result) => (
                <HealthCheckRow
                  key={result.id}
                  result={result}
                  busy={fixing === result.id}
                  onFix={(r) => void fix(r)}
                />
              ))}
            </section>
          ))}
      </div>
    </div>
  );
}
