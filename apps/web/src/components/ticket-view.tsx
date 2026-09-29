import type { Ticket, TicketDetailResponse, TicketStatus } from '@crew/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { docsFlow } from '../lib/docs-links';
import { errorMessage, isOpen } from '../lib/format';
import {
  useMachineNames,
  useProjects,
  useReports,
  useRunningTicketIds,
  useTicket,
  useTransition,
  useUpdateTicket,
} from '../lib/queries';
import { useViewport } from '../lib/ui-state';
import { AgentActivityLine } from './agent-activity';
import { CancelDialog } from './cancel-dialog';
import { CommentComposer, CommentList } from './comment-thread';
import { DetailsBox } from './details-box';
import { EventTimeline } from './event-timeline';
import { MarkdownEditor } from './markdown-editor';
import { MarkdownView } from './markdown-view';
import { ReportPanel } from './report-panel';
import { SubtaskTree } from './subtask-tree';
import { TypeIcon } from './type-icon';
import { Button } from './ui/button';
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from './ui/tabs';
import { useToast } from './ui/toast';

type ActivityTab = 'comments' | 'history' | 'report';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function InlineTitle({
  ticket,
  level,
  onSave,
}: {
  ticket: Ticket;
  level: 1 | 2;
  onSave: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ticket.title);
  const Heading = level === 1 ? 'h1' : 'h2';
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== ticket.title) onSave(next);
    else setDraft(ticket.title);
  };
  if (editing) {
    return (
      <input
        aria-label="Tiêu đề"
        value={draft}
        maxLength={300}
        // biome-ignore lint/a11y/noAutofocus: the owner just asked to edit the title
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(ticket.title);
            setEditing(false);
          }
        }}
        className="min-h-11 w-full rounded border border-accent bg-panel px-2 text-xl font-semibold outline-none"
      />
    );
  }
  return (
    <Heading
      className={cn(
        'm-0 min-w-0 font-semibold leading-snug break-words',
        level === 1 ? 'text-2xl' : 'text-xl',
      )}
    >
      <button
        type="button"
        title="Bấm để sửa tiêu đề"
        onClick={() => {
          setDraft(ticket.title);
          setEditing(true);
        }}
        className="rounded text-left hover:bg-soft"
      >
        {ticket.title}
      </button>
    </Heading>
  );
}

function Description({
  ticket,
  onSave,
  saving,
}: {
  ticket: Ticket;
  onSave: (text: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ticket.description);
  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <MarkdownEditor label="Mô tả" value={draft} onChange={setDraft} rows={8} autoFocus />
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={saving}
            onClick={() => {
              onSave(draft);
              setEditing(false);
            }}
          >
            Lưu
          </Button>
          <Button onClick={() => setEditing(false)}>Hủy</Button>
        </div>
      </div>
    );
  }
  return (
    <Section title="Mô tả">
      {ticket.description.trim() ? (
        <MarkdownView source={ticket.description} />
      ) : (
        <p className="m-0 text-sm text-muted">Chưa có mô tả.</p>
      )}
      <div>
        <Button
          size="sm"
          variant="ghost"
          className="text-accent"
          onClick={() => {
            setDraft(ticket.description);
            setEditing(true);
          }}
        >
          Sửa mô tả
        </Button>
      </div>
    </Section>
  );
}

function NeedsInputBanner({ ticket, onReply }: { ticket: Ticket; onReply?: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2.5 rounded-md border border-warn-line bg-warn-bg px-3 py-2.5 text-sm text-warn-ink"
    >
      <strong>Agent đang chờ bạn trả lời</strong>
      <span>
        {ticket.budgetHold
          ? 'Đã chạm giới hạn; trả lời để duyệt cho chạy tiếp.'
          : 'Xem câu hỏi trong phần bình luận.'}
      </span>
      <span className="grow" />
      {onReply && (
        <Button size="sm" onClick={onReply}>
          Trả lời
        </Button>
      )}
    </div>
  );
}

/**
 * The ticket, identical in the board side panel and on the full page: title (inline edit), description
 * (markdown editor), child issues, related docs, the Activity tabs (Bình luận, Lịch sử, Report) and the
 * Details box, laid out per viewport.
 */
export function TicketView({
  ticketKey,
  mode,
  onOpenTicket,
}: {
  ticketKey: string;
  mode: 'panel' | 'page';
  /** Opens another ticket; defaults to its full page. */
  onOpenTicket?: (key: string) => void;
}) {
  const detail = useTicket(ticketKey);
  if (detail.isLoading) return <p className="m-0 p-5 text-sm text-muted">Đang tải {ticketKey}…</p>;
  if (detail.isError || !detail.data) {
    return (
      <p role="alert" className="m-0 p-5 text-sm text-bad">
        {errorMessage(detail.error)}
      </p>
    );
  }
  return <TicketViewBody data={detail.data} mode={mode} onOpenTicket={onOpenTicket} />;
}

function TicketViewBody({
  data,
  mode,
  onOpenTicket,
}: {
  data: TicketDetailResponse;
  mode: 'panel' | 'page';
  onOpenTicket?: (key: string) => void;
}) {
  const { ticket, children, comments, report, events } = data;
  const viewport = useViewport();
  const navigate = useNavigate();
  const toast = useToast();
  const parent = useTicket(ticket.parentId);
  const projects = useProjects();
  const machines = useMachineNames();
  const running = useRunningTicketIds();
  const transition = useTransition();
  const update = useUpdateTicket();
  const [tab, setTab] = useState<ActivityTab>('comments');
  const [cancelOpen, setCancelOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const reports = useReports(ticket.key, tab === 'report');
  const phone = viewport === 'phone';
  const needsInput = ticket.status === 'needs_input';
  const pinReply = phone && needsInput;

  // A different ticket starts on the comments tab.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per ticket only
  useEffect(() => setTab('comments'), [ticket.id]);

  const open =
    onOpenTicket ??
    ((key: string) => void navigate({ to: '/tickets/$ticketKey', params: { ticketKey: key } }));
  const project = projects.data?.find((p) => p.id === (ticket.projectId ?? ticket.projectHintId));
  // `@pm` reaches the PM of a pm_task tree: from the pm_task itself or any of its subtasks, never a request.
  const canCallPm = ticket.type !== 'request';
  const pmTaskKey = parent.data?.ticket.type === 'pm_task' ? parent.data.ticket.key : null;
  const siblings = parent.data?.children ?? [];
  const family =
    parent.data && parent.data.ticket.type === 'pm_task' && children.length === 0 ? siblings : children;

  const openCancel = () => {
    transition.reset();
    setCancelOpen(true);
  };

  const move = (to: TicketStatus) => {
    if (to === 'cancelled') {
      openCancel();
      return;
    }
    transition.mutate({ ticket, to }, { onError: (error) => toast(errorMessage(error), 'error') });
  };

  const reply = () => {
    setTab('comments');
    setTimeout(() => composerRef.current?.focus(), 0);
  };

  const actions = (
    <div className="flex flex-wrap gap-2">
      {(ticket.status === 'done' || ticket.status === 'in_review') && (
        <Button onClick={() => move('in_progress')} disabled={transition.isPending}>
          Mở lại
        </Button>
      )}
      {(ticket.status === 'blocked' || ticket.status === 'needs_input') && (
        <Button onClick={() => move('in_progress')} disabled={transition.isPending}>
          Bỏ chặn
        </Button>
      )}
      {isOpen(ticket.status) && (
        <Button onClick={openCancel} disabled={transition.isPending}>
          Hủy
        </Button>
      )}
    </div>
  );

  const details = (
    <DetailsBox
      ticket={ticket}
      parent={parent.data?.ticket ?? null}
      siblings={siblings}
      machine={ticket.assigneeMachineId ? machines.get(ticket.assigneeMachineId) : undefined}
      project={project}
      running={running.has(ticket.id) || ticket.agentActivity?.status === 'running'}
      onStatus={move}
      onPriority={(priority) =>
        update.mutate(
          { ticket, patch: { priority } },
          { onError: (error) => toast(errorMessage(error), 'error') },
        )
      }
      busy={transition.isPending || update.isPending}
      collapsible={phone}
    />
  );

  const childHeading =
    family === siblings && parent.data ? `Ticket con của PM task ${parent.data.ticket.key}` : 'Ticket con';

  const activity = (
    <TabsRoot value={tab} onValueChange={(value) => setTab(value as ActivityTab)}>
      <TabsList label="Hoạt động">
        <TabsTrigger value="comments">Bình luận ({comments.length})</TabsTrigger>
        <TabsTrigger value="history">Lịch sử</TabsTrigger>
        <TabsTrigger value="report">Report</TabsTrigger>
      </TabsList>
      <TabsContent value="comments" className="flex flex-col gap-4 pt-3">
        <CommentList comments={comments} pmTaskKey={pmTaskKey} onOpenTicket={open} />
        {!pinReply && (
          <CommentComposer
            ref={composerRef}
            ticketKey={ticket.key}
            label={needsInput ? 'Trả lời' : 'Thêm bình luận'}
            canCallPm={canCallPm}
          />
        )}
      </TabsContent>
      <TabsContent value="history" className="pt-3">
        <EventTimeline events={events} />
      </TabsContent>
      <TabsContent value="report" className="pt-3">
        <ReportPanel
          report={report}
          history={reports.data?.history ?? []}
          related={[...siblings, ...children]}
        />
      </TabsContent>
    </TabsRoot>
  );

  const main = (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-start gap-2.5">
        <TypeIcon type={ticket.type} className="mt-1.5" />
        <InlineTitle
          ticket={ticket}
          level={mode === 'page' ? 1 : 2}
          onSave={(title) =>
            update.mutate(
              { ticket, patch: { title } },
              { onError: (error) => toast(errorMessage(error), 'error') },
            )
          }
        />
      </div>
      {phone && details}
      <AgentActivityLine ticket={ticket} />
      {needsInput && !pinReply && <NeedsInputBanner ticket={ticket} onReply={reply} />}
      {actions}
      {mode === 'panel' && !phone && details}
      <Description
        ticket={ticket}
        saving={update.isPending}
        onSave={(description) =>
          update.mutate(
            { ticket, patch: { description } },
            { onError: (error) => toast(errorMessage(error), 'error') },
          )
        }
      />
      {family.length > 0 && (
        <Section title={childHeading}>
          <SubtaskTree tickets={family} running={running} highlightId={ticket.id} onOpen={open} />
        </Section>
      )}
      {ticket.type !== 'request' && (
        <Section title="Docs liên quan">
          {ticket.flows.length > 0 && project ? (
            <div className="flex flex-wrap gap-2">
              {ticket.flows.map((flow) => (
                <Link
                  key={flow}
                  {...docsFlow(project.key, flow)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] text-ink no-underline hover:bg-soft xl:min-h-7"
                >
                  <FileText size={14} aria-hidden /> Flow: {flow}
                </Link>
              ))}
            </div>
          ) : (
            <p className="m-0 text-sm text-muted">Chưa gắn flow nào.</p>
          )}
        </Section>
      )}
      {mode === 'page' && viewport === 'tablet' && details}
      {activity}
    </div>
  );

  return (
    <>
      {mode === 'page' && viewport === 'desktop' ? (
        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-7">
          {main}
          <aside className="flex flex-col gap-3.5">{details}</aside>
        </div>
      ) : (
        main
      )}
      {pinReply && (
        <div className="sticky bottom-0 z-10 -mx-3 mt-2 flex flex-col gap-2 border-t border-line bg-panel px-3 py-2.5">
          <NeedsInputBanner ticket={ticket} />
          <CommentComposer
            ref={composerRef}
            ticketKey={ticket.key}
            label="Trả lời"
            compact
            canCallPm={canCallPm}
          />
        </div>
      )}
      <CancelDialog
        ticket={ticket}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        busy={transition.isPending}
        error={transition.error}
        onConfirm={() =>
          transition.mutate(
            { ticket, to: 'cancelled' },
            {
              onSuccess: () => {
                setCancelOpen(false);
                toast(`Đã hủy ${ticket.key}`, 'success');
              },
            },
          )
        }
      />
    </>
  );
}
