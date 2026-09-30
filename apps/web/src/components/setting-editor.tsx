import {
  type DiffLine,
  type Machine,
  type SaveSettingsResponse,
  type SettingsKeyInput,
  type SettingsRevision,
  settingsText,
} from '@crew/shared';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../lib/api-client';
import { cn } from '../lib/cn';
import { errorMessage, formatFullDateTime } from '../lib/format';
import { keys, useMachines, useSettingsHistory } from '../lib/queries';
import { Button } from './ui/button';
import { DialogContent, DialogRoot } from './ui/dialog';
import { Field, Input } from './ui/field';
import { useToast } from './ui/toast';

/**
 * The latest save (or restore) of a setting in this browser tab. Kept in the query cache, not in component
 * state: a save changes the active revision, which remounts the editor, and the owner must still see which
 * machines picked the new revision up.
 */
const savedKey = (key: SettingsKeyInput) => ['settingsSaved', ...keys.settingsHistory(key).slice(2)];

function rememberSave(queryClient: QueryClient, key: SettingsKeyInput, saved: SaveSettingsResponse): void {
  queryClient.setQueryData(savedKey(key), saved);
}

function useLastSave(key: SettingsKeyInput): SaveSettingsResponse | null {
  const query = useQuery<SaveSettingsResponse | null>({
    queryKey: savedKey(key),
    queryFn: () => null,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
  });
  return query.data ?? null;
}

/** The active revision of one setting key among the overview's active revisions. */
export function activeOf(
  active: readonly SettingsRevision[],
  key: SettingsKeyInput,
): SettingsRevision | null {
  return (
    active.find(
      (row) =>
        row.kind === key.kind &&
        row.scope === key.scope &&
        row.machineId === (key.machineId ?? null) &&
        row.projectId === (key.projectId ?? null) &&
        row.name === (key.name ?? ''),
    ) ?? null
  );
}

/** "owner:quang" → "quang", "machine:mac" → "máy mac". */
export function authorLabel(author: string): string {
  if (author.startsWith('owner:')) return author.slice('owner:'.length);
  if (author.startsWith('machine:')) return `máy ${author.slice('machine:'.length)}`;
  return author;
}

/** A save error the owner can act on: a newer revision, the server's field problems, or the generic text. */
function saveError(error: unknown): string {
  if (error instanceof ApiRequestError && error.status === 409) {
    const current = (error.details as { currentVersion?: number } | undefined)?.currentVersion;
    return `Cài đặt vừa được lưu ở nơi khác${current ? ` (bản ${current})` : ''}. Tải lại trang để xem bản mới rồi sửa lại.`;
  }
  if (error instanceof ApiRequestError && Array.isArray(error.details)) {
    return (error.details as { message: string }[]).map((item) => item.message).join(' ');
  }
  return errorMessage(error);
}

/** Changed lines with a little context; long unchanged runs fold into one line. */
export function DiffView({ lines, label }: { lines: readonly DiffLine[]; label: string }) {
  if (lines.every((line) => line.op === 'same')) {
    return <p className="m-0 text-sm text-muted">Không có khác biệt.</p>;
  }
  const near = (at: number) => {
    for (let i = Math.max(0, at - 2); i <= Math.min(lines.length - 1, at + 2); i++) {
      if (lines[i]?.op !== 'same') return true;
    }
    return false;
  };
  const rows: ReactNode[] = [];
  let folded = 0;
  const fold = (at: number) => {
    if (folded === 0) return;
    rows.push(
      <div key={`fold-${at}`} className="px-2 text-muted">
        … {folded} dòng giống nhau
      </div>,
    );
    folded = 0;
  };
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] as DiffLine;
    if (!near(at)) {
      folded++;
      continue;
    }
    fold(at);
    rows.push(
      <div
        key={`line-${at}`}
        className={cn(
          'px-2 whitespace-pre-wrap break-words',
          line.op === 'add' && 'bg-ok-bg text-ok-ink',
          line.op === 'del' && 'bg-bad-bg text-bad-ink',
        )}
      >
        {line.op === 'add' ? '+ ' : line.op === 'del' ? '- ' : '  '}
        {line.text || ' '}
      </div>,
    );
  }
  fold(lines.length);
  return (
    <section
      aria-label={label}
      className="max-h-96 overflow-auto rounded border border-line2 py-1 font-mono text-xs leading-relaxed"
    >
      {rows}
    </section>
  );
}

/**
 * Which machines the saved revision applies to and whether each has picked it up yet (from their heartbeats:
 * the revision a machine reports equals the one the server would give it now). Polls every 3 s while one
 * has not.
 */
export function PickupStatus({ machineIds }: { machineIds: readonly string[] }) {
  const [fast, setFast] = useState(true);
  const machines = useMachines(fast ? 3_000 : 30_000);
  const list = machineIds
    .map((id) => machines.data?.find((machine) => machine.id === id))
    .filter((machine): machine is Machine => Boolean(machine));
  const waiting = list.filter((machine) => !machine.settings.current).length;
  const loaded = Boolean(machines.data);
  useEffect(() => {
    if (loaded && waiting === 0) setFast(false);
  }, [loaded, waiting]);
  if (machineIds.length === 0) {
    return (
      <p className="m-0 text-[13px] text-muted">
        Chưa máy nào dùng cài đặt này; máy nhận nó khi bắt đầu dùng (ví dụ khi nhận dự án).
      </p>
    );
  }
  return (
    <ul aria-label="Máy đã nhận cài đặt" className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
      {list.map((machine) => (
        <li key={machine.id} className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden
            className={cn('size-2 rounded-full', machine.settings.current ? 'bg-ok' : 'bg-warn-line')}
          />
          <span className="font-semibold">{machine.name}</span>
          <span className="text-muted">
            {machine.settings.current
              ? 'đã nhận, job kế tiếp dùng bản này'
              : machine.online
                ? 'chưa nhận (chờ heartbeat kế tiếp)'
                : 'đang offline: nhận khi kết nối lại'}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Every revision of one setting, newest first, with the diff to the one before it and a restore button. */
export function SettingHistory({ settingKey }: { settingKey: SettingsKeyInput }) {
  const history = useSettingsHistory(settingKey);
  const [open, setOpen] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ id: string; lines: DiffLine[] } | null>(null);
  const [restoring, setRestoring] = useState<SettingsRevision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const items = history.data ?? [];

  const showDiff = async (revision: SettingsRevision, previous: SettingsRevision | undefined) => {
    if (open === revision.id) {
      setOpen(null);
      return;
    }
    setOpen(revision.id);
    setError(null);
    try {
      const lines = previous
        ? (await api.diffSettings(previous.id, revision.id)).lines
        : [{ op: 'add' as const, text: settingsText(revision.kind, revision.content) }];
      setDiff({ id: revision.id, lines });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const restore = async () => {
    if (!restoring) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.restoreSettings(restoring.id);
      rememberSave(queryClient, settingKey, saved);
      toast(`Đã khôi phục bản ${restoring.version} thành bản ${saved.revision.version}`, 'success');
      setRestoring(null);
      await queryClient.invalidateQueries({ queryKey: keys.settings });
    } catch (caught) {
      setError(saveError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Lịch sử thay đổi" className="flex flex-col gap-2">
      <h2 className="m-0 text-sm font-semibold">Lịch sử thay đổi</h2>
      {history.isLoading && <p className="m-0 text-sm text-muted">Đang tải…</p>}
      {history.isError && <p className="m-0 text-sm text-bad">{errorMessage(history.error)}</p>}
      {history.data && items.length === 0 && (
        <p className="m-0 text-sm text-muted">Chưa có bản nào: đang dùng mặc định.</p>
      )}
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((revision, index) => (
          <li key={revision.id} className="rounded border border-line2 p-2.5 text-[13px]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <strong>Bản {revision.version}</strong>
              {index === 0 && (
                <span className="rounded-[3px] bg-accent-bg px-1.5 text-[11px] font-bold text-accent uppercase">
                  Đang dùng
                </span>
              )}
              <span className="text-muted">
                {formatFullDateTime(revision.createdAt)} · {authorLabel(revision.author)}
                {revision.restoredFrom ? ` · khôi phục bản ${revision.restoredFrom}` : ''}
                {revision.content === null ? ' · bỏ ghi đè, dùng mặc định' : ''}
              </span>
              <span className="grow" />
              <Button size="sm" variant="ghost" onClick={() => void showDiff(revision, items[index + 1])}>
                {open === revision.id ? 'Ẩn khác biệt' : 'Khác biệt với bản trước'}
              </Button>
              {index > 0 && (
                <Button size="sm" onClick={() => setRestoring(revision)}>
                  Khôi phục
                </Button>
              )}
            </div>
            {revision.note && <p className="m-0 mt-1">{revision.note}</p>}
            {open === revision.id && diff?.id === revision.id && (
              <div className="mt-2">
                <DiffView lines={diff.lines} label={`Khác biệt của bản ${revision.version}`} />
              </div>
            )}
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="m-0 text-sm text-bad">
          {error}
        </p>
      )}
      <DialogRoot open={restoring !== null} onOpenChange={(value) => !value && setRestoring(null)}>
        <DialogContent
          title={`Khôi phục bản ${restoring?.version ?? ''}?`}
          description="Nội dung của bản này được lưu thành bản mới nhất; các máy dùng nó cho job kế tiếp."
        >
          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={() => setRestoring(null)}>Không</Button>
            <Button variant="primary" disabled={busy} onClick={() => void restore()}>
              Khôi phục
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </section>
  );
}

export interface SettingEditorProps {
  settingKey: SettingsKeyInput;
  /** The active revision of the key; null when it was never saved. */
  active: SettingsRevision | null;
  /** What Save stores (already shaped like the setting). */
  draft: unknown;
  /** Problems found in the form; Save stays disabled while there are any. */
  errors: readonly string[];
  /** The form differs from the active value. */
  dirty: boolean;
  /** The button that removes the override (null content), e.g. "Dùng mặc định"; null hides it. */
  resetLabel: string | null;
  /** What applies while there is no override, e.g. "mặc định của app". */
  fallbackLabel: string;
  children: ReactNode;
}

/**
 * The frame of every settings form: what is in use (version, author, time, note), the change note, Save, the
 * button that removes the override, which machines picked the saved revision up, and the history.
 */
export function SettingEditor({
  settingKey,
  active,
  draft,
  errors,
  dirty,
  resetLabel,
  fallbackLabel,
  children,
}: SettingEditorProps) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useLastSave(settingKey);
  const [confirmReset, setConfirmReset] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  const save = async (content: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveSettings({
        key: settingKey,
        content,
        note: note.trim(),
        baseVersion: active?.version ?? 0,
      });
      rememberSave(queryClient, settingKey, result);
      setNote('');
      setConfirmReset(false);
      toast(`Đã lưu bản ${result.revision.version}`, 'success');
      await queryClient.invalidateQueries({ queryKey: keys.settings });
    } catch (caught) {
      setError(saveError(caught));
    } finally {
      setBusy(false);
    }
  };

  const overridden = active !== null && active.content !== null;
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13px] text-muted">
        {overridden && active
          ? `Đang dùng bản ${active.version}, lưu ${formatFullDateTime(active.createdAt)} bởi ${authorLabel(active.author)}${active.note ? `: ${active.note}` : ''}.`
          : `Đang dùng ${fallbackLabel}.`}
      </p>
      {children}
      {errors.length > 0 && (
        <ul role="alert" aria-label="Lỗi cài đặt" className="m-0 flex flex-col gap-0.5 pl-5 text-sm text-bad">
          {errors.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <Field label="Ghi chú thay đổi" hint="Ghi lý do đổi; hiện trong lịch sử.">
        <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={busy || !dirty || errors.length > 0}
          onClick={() => void save(draft)}
        >
          Lưu
        </Button>
        {resetLabel && overridden && (
          <Button disabled={busy} onClick={() => setConfirmReset(true)}>
            {resetLabel}
          </Button>
        )}
        {!dirty && <span className="text-xs text-muted">Chưa có thay đổi.</span>}
      </div>
      {error && (
        <p role="alert" className="m-0 text-sm text-bad">
          {error}
        </p>
      )}
      {saved && (
        <section aria-label="Máy nhận bản vừa lưu" className="rounded border border-line2 p-3">
          <h2 className="m-0 mb-1.5 text-sm font-semibold">Bản {saved.revision.version}: máy đã nhận</h2>
          <PickupStatus machineIds={saved.affectedMachineIds} />
        </section>
      )}
      <SettingHistory settingKey={settingKey} />
      <DialogRoot open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent
          title={`${resetLabel ?? ''}?`}
          description={`Bỏ ghi đè: ${fallbackLabel} áp dụng cho job kế tiếp.`}
        >
          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={() => setConfirmReset(false)}>Không</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save(null)}>
              Xác nhận
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
