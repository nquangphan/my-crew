import type { Comment } from '@crew/shared';
import { forwardRef, type KeyboardEvent, useId, useState } from 'react';
import { cn } from '../lib/cn';
import { errorMessage, formatFullDateTime, formatRelative, ROLE_META } from '../lib/format';
import { useAddComment } from '../lib/queries';
import { MarkdownView } from './markdown-view';
import { RoleAvatar } from './role-avatar';
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

export function CommentList({ comments }: { comments: Comment[] }) {
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
            </div>
            <MarkdownView source={comment.body} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Comment box. Answering a `needs_input` ticket moves it back to in progress and wakes its agent
 * (server side). Ctrl/Cmd + Enter sends.
 */
export const CommentComposer = forwardRef<
  HTMLTextAreaElement,
  { ticketKey: string; label?: string; compact?: boolean; onSent?: () => void }
>(function CommentComposer({ ticketKey, label = 'Thêm bình luận', compact, onSent }, ref) {
  const [body, setBody] = useState('');
  const add = useAddComment(ticketKey);
  const id = useId();

  const send = () => {
    const text = body.trim();
    if (!text || add.isPending) return;
    add.mutate(text, {
      onSuccess: () => {
        setBody('');
        onSent?.();
      },
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
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
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        rows={compact ? 2 : 3}
        maxLength={50_000}
        className={cn(
          'w-full resize-y rounded border-2 border-accent bg-panel p-2 text-sm text-ink outline-none',
          compact ? 'min-h-14' : 'min-h-[72px]',
        )}
      />
      {add.isError && (
        <p role="alert" className="m-0 text-sm text-bad">
          {errorMessage(add.error)}
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
