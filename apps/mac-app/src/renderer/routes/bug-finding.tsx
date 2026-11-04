import { useCallback, useEffect, useState } from 'react';
import type { LaunchResult } from '../../main/bug-finding/launch';
import type {
  BugFindingRequestRow,
  BugFindingRequestState,
  BugFindingView,
} from '../../main/bug-finding/state';
import { ErrorBox, Lozenge, Notice, PageHeader, type Tone } from '../components/ui';
import { invoke, useStateChanged } from '../lib/ipc';

/** Màn đang mở thì đọc lại trạng thái mỗi 10 giây (heartbeat của Bug Finding ghi mỗi 15 giây). */
const REFRESH_MS = 10_000;
/** Cùng `HEARTBEAT_STALE_SEC` của Main. */
const STALE_SEC = 60;

const OPEN_MESSAGE: Record<Extract<LaunchResult, { ok: false }>['reason'], string> = {
  standalone_running:
    'Thoát Bug Finding (bản cài riêng) trước, rồi bấm Mở Bug Finding lại. Hai bản dùng chung dữ liệu nên không chạy cùng lúc.',
  missing: 'Không tìm thấy app Bug Finding đi kèm 2P Crew. Cài lại 2P Crew bản mới nhất.',
};

const STATE_LABEL: Record<BugFindingRequestState, string> = {
  pending: 'Chờ Bug Finding nhận',
  queued: 'Đang chờ',
  running: 'Đang review',
  succeeded: 'Xong',
  failed: 'Lỗi',
  cancelled: 'Đã hủy',
};

const STATE_TONE: Record<BugFindingRequestState, Tone> = {
  pending: 'gray',
  queued: 'warn',
  running: 'info',
  succeeded: 'ok',
  failed: 'bad',
  cancelled: 'gray',
};

const VERDICT_TONE: Record<string, Tone> = { APPROVE: 'ok', BLOCK: 'bad', COMMENT: 'warn' };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function age(seconds: number): string {
  if (seconds < 60) return `${seconds} giây`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} phút`;
  return `${Math.round(seconds / 3600)} giờ`;
}

function signal(view: BugFindingView): string {
  if (view.heartbeatAgeSec === null) return 'Chưa nhận tín hiệu từ Bug Finding';
  if (view.heartbeatAgeSec <= STALE_SEC) return `Đã nhận tín hiệu ${view.heartbeatAgeSec} giây trước`;
  return `Mất tín hiệu từ ${age(view.heartbeatAgeSec)} trước`;
}

function RequestRow({ row, onOpen }: { row: BugFindingRequestRow; onOpen: () => void }) {
  const lanes =
    row.state === 'running' && row.lanesDone !== null && row.lanesTotal !== null
      ? `${row.lanesDone}/${row.lanesTotal} lane xong`
      : null;
  return (
    <tr>
      <td className="mono">{row.identifier ?? row.requestId}</td>
      <td className="mono">{row.prNumber !== null ? `#${row.prNumber}` : '–'}</td>
      <td>{row.run === null ? '–' : row.run > 1 ? `${row.run} (chạy lại)` : String(row.run)}</td>
      <td>
        <Lozenge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Lozenge>
        {lanes && <span className="muted"> {lanes}</span>}
      </td>
      <td>
        {row.verdict ? (
          <Lozenge tone={VERDICT_TONE[row.verdict] ?? 'gray'}>{row.verdict}</Lozenge>
        ) : (
          <span className="muted">{row.error ?? '–'}</span>
        )}
      </td>
      <td>
        <button type="button" className="btn" onClick={onOpen}>
          Xem trong Bug Finding
        </button>
      </td>
    </tr>
  );
}

export function BugFindingScreen() {
  const [view, setView] = useState<BugFindingView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    invoke('bugFinding:state')
      .then(setView)
      .catch((e: unknown) => setError(messageOf(e)));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);
  useStateChanged(load);

  const act = (label: string, run: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setMessage(null);
    run()
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => {
        setBusy(null);
        load();
      });
  };

  const open = () =>
    act('open', async () => {
      const result = await invoke('bugFinding:open');
      if (!result.ok) setError(OPEN_MESSAGE[result.reason]);
    });
  const trash = () =>
    act('trash', async () => {
      const result = await invoke('bugFinding:trashStandalone');
      setMessage({ ok: result.ok, text: result.message });
    });
  const sync = () =>
    act('sync', async () => {
      const result = await invoke('bugFinding:syncNow');
      setMessage({ ok: true, text: `Đã đồng bộ ${result.count} project` });
    });

  const standalone = view?.standaloneApp ?? null;

  return (
    <>
      <PageHeader
        title="Bug Finding"
        subtitle="App review MR/PR đi kèm 2P Crew. Crew xếp MR của ticket tổng vào hàng đợi; giao diện, đăng nhập GitLab/GitHub và báo cáo vẫn ở app Bug Finding."
        actions={
          <button
            type="button"
            className="btn primary"
            disabled={!view?.installed || busy !== null}
            onClick={open}
          >
            {busy === 'open' ? 'Đang mở...' : 'Mở Bug Finding'}
          </button>
        }
      />
      <ErrorBox message={error} />
      {message && <Notice tone={message.ok ? 'ok' : 'bad'}>{message.text}</Notice>}
      {view && !view.installed && <Notice tone="warn">{OPEN_MESSAGE.missing}</Notice>}
      {standalone?.running && (
        <Notice tone="warn">
          Bug Finding bản cài riêng ({standalone.path}) đang chạy. Thoát bản đó trước khi mở bản đi kèm 2P
          Crew: hai bản dùng chung dữ liệu nên không chạy cùng lúc.
        </Notice>
      )}

      {view && (
        <div className="bf-sections">
          <section className="wizard-card" aria-label="Trạng thái app">
            <h2>Trạng thái app</h2>
            <dl className="kv">
              <dt>Phiên bản</dt>
              <dd>{view.version ? `${view.version} (cập nhật cùng 2P Crew)` : 'Chưa cài'}</dd>
              <dt>Tiến trình</dt>
              <dd>
                <Lozenge tone={view.running ? 'ok' : 'gray'}>
                  {view.running ? 'Đang chạy' : 'Không chạy'}
                </Lozenge>
                {view.pid !== null && <span className="muted mono"> pid {view.pid}</span>}
              </dd>
              <dt>Hàng đợi</dt>
              <dd>
                {view.running ? `${view.runningReviews} đang review, ${view.waitingReviews} đang chờ` : '–'}
              </dd>
              <dt>Kết nối với Crew</dt>
              <dd>{signal(view)}</dd>
              <dt>Bản cài riêng cũ</dt>
              <dd className="row-actions">
                {standalone ? (
                  <>
                    <span className="mono">Còn {standalone.path}</span>
                    <button
                      type="button"
                      className="btn danger"
                      disabled={standalone.running || busy !== null}
                      onClick={trash}
                    >
                      Chuyển vào Thùng rác
                    </button>
                  </>
                ) : (
                  'Không có'
                )}
              </dd>
            </dl>
          </section>

          <section className="wizard-card" aria-label="Đồng bộ project">
            <h2>Đồng bộ project</h2>
            <p className="muted">
              Mọi project Crew có repo trên máy này được tạo sẵn bên Bug Finding. Thêm project trong Crew thì
              bên kia tự có. Gỡ khỏi Crew thì Bug Finding giữ lịch sử và gắn nhãn “Crew đã gỡ”.
            </p>
            <div>
              <button type="button" className="btn" disabled={busy !== null} onClick={sync}>
                {busy === 'sync' ? 'Đang đồng bộ...' : 'Đồng bộ lại'}
              </button>
            </div>
          </section>

          <section className="wizard-card" aria-label="MR do Crew xếp">
            <h2>MR do Crew xếp</h2>
            <p className="muted">Chi tiết tiến độ, lane và log xem trong app Bug Finding.</p>
            {view.requests.length === 0 ? (
              <p className="muted">Chưa có lượt review nào do Crew xếp.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Ticket tổng</th>
                    <th>PR</th>
                    <th>Lần</th>
                    <th>Trạng thái</th>
                    <th>Kết quả</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {view.requests.map((row) => (
                    <RequestRow key={row.requestId} row={row} onOpen={open} />
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <p className="muted">
            Màn này chỉ để xem nhanh và mở app. Mọi thao tác review (dừng, resume, hủy, phản hồi, đăng nhập
            GitLab, token GitHub) làm trong app Bug Finding như trước.
          </p>
        </div>
      )}
    </>
  );
}
