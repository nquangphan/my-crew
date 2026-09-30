import type { TicketPriority } from '@crew/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api-client';
import { errorMessage, PRIORITIES, PRIORITY_META } from '../lib/format';
import { invalidateTicketData, useProjects } from '../lib/queries';
import { MarkdownEditor } from './markdown-editor';
import { RoleAvatar } from './role-avatar';
import { Button } from './ui/button';
import { DialogContent, DialogRoot } from './ui/dialog';
import { Field, Input, Select } from './ui/field';
import { useToast } from './ui/toast';

/**
 * Jira-style "Tạo" modal. The assignee is always the assistant; the project is only a hint for triage.
 * "Tạo thêm" keeps the modal open for the next ticket. The "Mô tả" editor allows pasting a clipboard image
 * before the ticket exists (`draftAttachments`, `usePasteImage()`); "Tạo" is disabled while an image is
 * still uploading so the description sent to the API never carries an unresolved `uploading:` placeholder.
 */
export function NewTicketDialog({
  open,
  onOpenChange,
  defaultProjectKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectKey?: string;
}) {
  const projects = useProjects();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [projectHintId, setProjectHintId] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [allowConfigChange, setAllowConfigChange] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);

  useEffect(() => {
    if (!open) return;
    const hint = projects.data?.find((p) => p.key === defaultProjectKey);
    setProjectHintId(hint?.id ?? '');
    setError(null);
  }, [open, defaultProjectKey, projects.data]);

  const reset = () => {
    setTitle('');
    setDescription('');
    setAllowConfigChange(false);
    setPriority('medium');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // Belt-and-suspenders alongside the disabled "Tạo" button below: never send a description that still
    // holds an unresolved `uploading:` placeholder.
    if (uploadingImages) return;
    if (!title.trim()) {
      setError('Nhập tiêu đề.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ticket = await api.createTicket({
        title: title.trim(),
        description,
        priority,
        projectHintId: projectHintId || null,
        allowConfigChange,
      });
      await invalidateTicketData(queryClient);
      toast(`Đã tạo ${ticket.key}: ${ticket.title}`, 'success');
      reset();
      if (!createMore) {
        onOpenChange(false);
        void navigate({ to: '/requests', search: { selected: ticket.key } });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Tạo ticket"
        description="Ticket được giao cho trợ lý, trợ lý sẽ chọn dự án và PM."
        wide
      >
        <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Tạo ticket">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Dự án (gợi ý)" hint="Trợ lý vẫn tự kiểm tra theo mô tả dự án.">
              <Select value={projectHintId} onChange={(e) => setProjectHintId(e.target.value)}>
                <option value="">Để trợ lý tự chọn</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key} · {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ưu tiên">
              <Select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_META[p].arrow} {PRIORITY_META[p].label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Tiêu đề">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              required
              autoFocus
            />
          </Field>
          <MarkdownEditor
            label="Mô tả"
            value={description}
            onChange={setDescription}
            rows={7}
            draftAttachments
            onUploadingChange={setUploadingImages}
          />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[13px] font-semibold text-muted">Người xử lý</span>
            <RoleAvatar agent="assistant" size={22} /> Trợ lý
          </div>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={allowConfigChange}
              onChange={(e) => setAllowConfigChange(e.target.checked)}
            />
            <span>
              Cho phép sửa config
              <span className="block text-xs text-muted">
                Agent được sửa các file config được bảo vệ (hook, CI, cấu hình agent) trong cây ticket này.
              </span>
            </span>
          </label>
          {error && (
            <p role="alert" className="m-0 text-sm text-bad">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-line2 pt-4">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={createMore}
                onChange={(e) => setCreateMore(e.target.checked)}
              />
              Tạo thêm
            </label>
            <span className="grow" />
            <Button onClick={() => onOpenChange(false)}>Hủy</Button>
            <Button type="submit" variant="primary" disabled={busy || uploadingImages}>
              {busy ? 'Đang tạo…' : uploadingImages ? 'Đang tải ảnh…' : 'Tạo'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
