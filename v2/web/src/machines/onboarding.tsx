/**
 * “Đăng ký máy”: the owner names a machine and the server returns `{machine, token}` once. The token exists
 * only in this component's memory: never in the query cache, the pending store, storage or a log. It is
 * cleared on close, unmount, session expiry or logout and tab hide. If the response is lost the same key and
 * body are replayed (no second machine); once the token is gone it cannot be shown again.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useEffect, useId, useState } from 'react';
import { useRuntime } from '../app-runtime.ts';
import { decodeProvisionedMachine, type ProvisionedMachine } from '../contracts/machines.ts';
import { queryRoots } from '../lib/query-keys.ts';
import {
  heldOperation,
  machineNameError,
  machineNameMax,
  machinesQueryOptions,
  onboardingFailureText,
  readFailureText,
  submitIntent,
  useUnresolved,
} from './onboarding-state.ts';

const machineIntent = 'machine:create';

const fieldStyle: CSSProperties = { display: 'grid', gap: '0.25rem', maxWidth: '28rem' };
const buttonStyle: CSSProperties = {
  font: 'inherit',
  padding: '0.4rem 0.75rem',
  borderRadius: '0.5rem',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};
const panelStyle: CSSProperties = {
  border: '1px solid currentColor',
  borderRadius: '0.75rem',
  padding: '1rem',
  display: 'grid',
  gap: '0.75rem',
};

function TokenPanel({ issued, onClose }: { issued: ProvisionedMachine; onClose: () => void }) {
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopyNote('Đã sao chép token.');
    } catch {
      setCopyNote('Không sao chép được. Hãy bôi đen token và chép thủ công.');
    }
  };
  return (
    <section style={panelStyle} aria-label="Token máy vừa đăng ký">
      <h2 style={{ margin: 0 }}>Đã đăng ký máy “{issued.machine.name}”</h2>
      <p style={{ margin: 0 }}>
        Token chỉ hiển thị một lần và không được lưu ở trình duyệt. Hãy sao chép rồi dán vào ứng dụng Crew
        trên máy đó trước khi đóng.
      </p>
      <code style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{issued.token}</code>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" style={buttonStyle} onClick={() => void copy()}>
          Sao chép token
        </button>
        <button type="button" style={buttonStyle} onClick={onClose}>
          Đã lưu token, đóng
        </button>
      </div>
      {copyNote && (
        <p role="status" style={{ margin: 0 }}>
          {copyNote}
        </p>
      )}
    </section>
  );
}

export function MachineOnboarding() {
  const { client, pending, session } = useRuntime();
  const cache = useQueryClient();
  const nameId = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<ProvisionedMachine | null>(null);
  const machines = useQuery(machinesQueryOptions(client));
  const held = heldOperation(useUnresolved(pending, machineIntent));
  const heldName = held ? (JSON.parse(held.bodyJson) as { name: string }).name : null;

  // The credential never outlives the authenticated view that received it.
  useEffect(() => {
    const clear = () => setIssued(null);
    const off = session.subscribe(() => {
      if (session.snapshot().state !== 'authenticated') clear();
    });
    window.addEventListener('pagehide', clear);
    return () => {
      off();
      window.removeEventListener('pagehide', clear);
    };
  }, [session]);

  const submit = async () => {
    const value = heldName ?? name.trim();
    if (heldName === null) {
      const problem = machineNameError(name);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setError(null);
    setBusy(true);
    try {
      const result = await submitIntent(
        pending,
        client,
        { intentId: machineIntent, method: 'POST', path: '/v2/machines', body: { name: value } },
        decodeProvisionedMachine,
      );
      setIssued(result);
      setName('');
      void cache.invalidateQueries({ queryKey: queryRoots.machines });
    } catch (failure) {
      setError(onboardingFailureText(failure, 'machine'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page-stack" aria-labelledby="machine-onboarding-heading">
      <div className="page-intro">
        <h1 id="machine-onboarding-heading">Đăng ký máy</h1>
        <p>
          Mỗi máy chạy Crew cần một token riêng. Sau khi đăng ký, tạo dự án rồi gắn máy ở mục “Tạo dự án/Gắn
          máy”.
        </p>
      </div>
      {issued && <TokenPanel issued={issued} onClose={() => setIssued(null)} />}
      <form
        aria-label="Biểu mẫu đăng ký máy"
        style={{ display: 'grid', gap: '0.75rem' }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void submit();
        }}
      >
        <div style={fieldStyle}>
          <label htmlFor={nameId}>Tên máy</label>
          <input
            id={nameId}
            type="text"
            autoComplete="off"
            value={heldName ?? name}
            disabled={busy || held !== null}
            maxLength={machineNameMax * 2}
            aria-invalid={error !== null}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </div>
        {held && (
          <p role="status" style={{ margin: 0 }}>
            Yêu cầu đăng ký máy “{heldName}” chưa được xác nhận. Gửi lại đúng yêu cầu cũ để không đăng ký máy
            thứ hai.
          </p>
        )}
        {error && (
          <p role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <div>
          <button type="submit" style={buttonStyle} disabled={busy}>
            {held ? 'Gửi lại đúng yêu cầu cũ' : 'Đăng ký máy'}
          </button>
        </div>
      </form>
      <section aria-labelledby="machine-list-heading" style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 id="machine-list-heading">Máy đã đăng ký</h2>
        {machines.isPending && <p role="status">Đang tải danh sách máy…</p>}
        {machines.error && (
          <p role="alert">
            Không tải được danh sách máy: {readFailureText(machines.error)}{' '}
            <button type="button" style={buttonStyle} onClick={() => void machines.refetch()}>
              Thử lại
            </button>
          </p>
        )}
        {machines.data?.length === 0 && <p>Chưa có máy nào được đăng ký.</p>}
        {machines.data && machines.data.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: '0.35rem' }}>
            {machines.data.map((machine) => (
              <li key={machine.id}>
                <strong>{machine.name}</strong> · {machine.revokedAt ? 'Đã thu hồi' : 'Đang dùng'} ·{' '}
                <code>{machine.id.slice(0, 8)}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
