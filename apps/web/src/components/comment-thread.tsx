import { type Comment, parseMentions } from '@crew/shared';
import {
  forwardRef,
  type KeyboardEvent,
  type SyntheticEvent,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '../lib/cn';
import { errorMessage, formatFullDateTime, formatRelative, ROLE_META } from '../lib/format';
import { usePasteImage } from '../lib/paste-image';
import { useAddComment } from '../lib/queries';
import { MarkdownView } from './markdown-view';
import { RoleAvatar } from './role-avatar';
import { TONE_CLASS } from './status-lozenge';
import { Button } from './ui/button';
import { InfoTip } from './ui/info-tip';

function Author({ comment }: { comment: Comment }) {
  if (comment.authorKind === 'owner') {
    return (
      <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-[#243b64] text-[10px] font-bold text-white">
        Bạn
      </span>
    );
  }
  if (comment.authorKind === 'agent' && comment.authorRole)
    return <RoleAvatar agent={comment.authorRole} size={30} />;
  return (
    <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-neutral-bg text-[10px] font-bold text-neutral-ink">
      HT
    </span>
  );
}

function authorName(comment: Comment): string {
  if (comment.authorKind === 'owner') return 'Bạn';
  if (comment.authorKind === 'agent' && comment.authorRole) return ROLE_META[comment.authorRole].label;
  return 'Hệ thống';
}

/**
 * Marks an owner comment that called the PM with `@pm`. `pmTaskKey` (the tree's pm_task, when the comment is
 * on one of its subtasks) opens it, where the PM's activity shows.
 */
function CalledPm({ pmTaskKey, onOpen }: { pmTaskKey?: string | null; onOpen?: (key: string) => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={cn('rounded px-1.5 py-px font-semibold', TONE_CLASS.progress)}>Đã gọi PM</span>
      {pmTaskKey && onOpen && (
        <button
          type="button"
          className="text-accent underline-offset-2 hover:underline"
          onClick={() => onOpen(pmTaskKey)}
        >
          Xem {pmTaskKey}
        </button>
      )}
    </span>
  );
}

export function CommentList({
  comments,
  pmTaskKey,
  onOpenTicket,
}: {
  comments: Comment[];
  /** The pm_task a `@pm` comment on this (sub)ticket woke; omitted on the pm_task itself. */
  pmTaskKey?: string | null;
  onOpenTicket?: (key: string) => void;
}) {
  if (comments.length === 0) return <p className="m-0 text-sm text-muted">Chưa có bình luận.</p>;
  return (
    <ol aria-label="Bình luận" className="m-0 flex list-none flex-col gap-4 p-0">
      {comments.map((comment) => (
        <li key={comment.id} className="flex gap-2.5 text-sm leading-relaxed">
          <Author comment={comment} />
          <div className="min-w-0 grow">
            <div>
              <strong>{authorName(comment)}</strong>{' '}
              <span className="text-xs text-muted">
                ·{' '}
                <InfoTip
                  label={`Thời điểm: ${formatFullDateTime(comment.createdAt)}`}
                  trigger={<time dateTime={comment.createdAt}>{formatRelative(comment.createdAt)}</time>}
                >
                  {formatFullDateTime(comment.createdAt)}
                </InfoTip>
              </span>
              {comment.mentions.includes('pm') && (
                <>
                  {' '}
                  <CalledPm pmTaskKey={pmTaskKey} onOpen={onOpenTicket} />
                </>
              )}
            </div>
            <MarkdownView source={comment.body} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The partial `@` tag right before the caret (`@`, `@p`, `@pm`), when `@pm` can complete it. */
const PARTIAL_TAG = /(^|[\s(])@(p|pm)?$/i;

/**
 * Comment box. Answering a `needs_input` ticket moves it back to in progress and wakes its agent
 * (server side); so does a comment on a `blocked` ticket (`unblocks` shows that hint, hidden while the text
 * tags `@pm`, which leaves the ticket blocked for the PM to decide). Ctrl/Cmd + Enter sends. With `canCallPm`, typing `@` suggests `@pm`, which wakes the PM of
 * the ticket's pm_task tree instead of the ticket's own agent (Enter or Tab picks it, Escape hides it).
 */
export const CommentComposer = forwardRef<
  HTMLTextAreaElement,
  {
    ticketKey: string;
    label?: string;
    compact?: boolean;
    canCallPm?: boolean;
    /** The ticket is blocked: an owner comment (without `@pm`) unblocks it. */
    unblocks?: boolean;
    onSent?: () => void;
  }
>(function CommentComposer(
  { ticketKey, label = 'Thêm bình luận', compact, canCallPm, unblocks, onSent },
  ref,
) {
  const [body, setBody] = useState('');
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const add = useAddComment(ticketKey);
  const { onPaste, error: pasteError } = usePasteImage({
    ticketId: ticketKey,
    value: body,
    onChange: setBody,
  });
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const placeCaret = useRef<number | null>(null);
  useImperativeHandle(ref, () => box.current as HTMLTextAreaElement);

  const partial = canCallPm && !dismissed ? PARTIAL_TAG.exec(body.slice(0, caret)) : null;
  const suggesting = partial !== null;
  const unblockHint = unblocks && !parseMentions(body).includes('pm');

  const send = () => {
    const text = body.trim();
    if (!text || add.isPending) return;
    add.mutate(text, {
      onSuccess: () => {
        setBody('');
        setCaret(0);
        onSent?.();
      },
    });
  };

  const pickPm = () => {
    if (!partial) return;
    const start = caret - (partial[0].length - (partial[1] ?? '').length);
    const next = `${body.slice(0, start)}@pm ${body.slice(caret)}`;
    const at = start + '@pm '.length;
    placeCaret.current = at;
    setBody(next);
    setCaret(at);
  };

  // After `@pm ` is inserted, the caret goes right after it (before the next keystroke lands).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the inserted text renders
  useLayoutEffect(() => {
    const at = placeCaret.current;
    if (at === null || !box.current) return;
    placeCaret.current = null;
    box.current.focus();
    box.current.setSelectionRange(at, at);
  }, [body]);

  const trackCaret = (event: SyntheticEvent<HTMLTextAreaElement>) =>
    setCaret(event.currentTarget.selectionStart ?? 0);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
      return;
    }
    if (!suggesting) return;
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      pickPm();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    }
  };

  return (
    <form
      className="flex flex-col gap-1.5"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label htmlFor={id} className="text-[13px] text-muted">
        {label}
      </label>
      <textarea
        id={id}
        ref={box}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setDismissed(false);
        }}
        onSelect={trackCaret}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        rows={compact ? 2 : 3}
        maxLength={50_000}
        aria-controls={suggesting ? `${id}-tags` : undefined}
        aria-describedby={unblockHint ? `${id}-unblock` : undefined}
        aria-autocomplete={canCallPm ? 'list' : undefined}
        className={cn(
          'w-full resize-y rounded border-2 border-accent bg-panel p-2 text-sm text-ink outline-none',
          compact ? 'min-h-14' : 'min-h-[72px]',
        )}
      />
      {unblockHint && (
        <p id={`${id}-unblock`} className="m-0 text-xs text-muted">
          Bình luận sẽ mở chặn ticket
        </p>
      )}
      {suggesting && (
        <div
          id={`${id}-tags`}
          role="listbox"
          aria-label="Gợi ý gắn thẻ"
          className="w-fit rounded border border-line bg-panel p-1 shadow-sm"
        >
          <div
            role="option"
            aria-selected="true"
            tabIndex={-1}
            // mousedown keeps the textarea focused, so the caret the tag replaces is still known
            onMouseDown={(event) => {
              event.preventDefault();
              pickPm();
            }}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded bg-soft px-2 text-sm xl:min-h-8"
          >
            <strong>@pm</strong>
            <span className="text-muted">gọi PM của cây ticket (thay cho agent của ticket này)</span>
          </div>
        </div>
      )}
      {add.isError && (
        <p role="alert" className="m-0 text-sm text-bad">
          {errorMessage(add.error)}
        </p>
      )}
      {pasteError && (
        <p role="alert" className="m-0 text-sm text-bad">
          {pasteError}
        </p>
      )}
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={!body.trim() || add.isPending}
          className={cn(compact && 'w-full')}
        >
          {add.isPending ? 'Đang gửi…' : 'Gửi'}
        </Button>
      </div>
    </form>
  );
});
