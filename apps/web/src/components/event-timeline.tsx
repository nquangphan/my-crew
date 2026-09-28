import type { EventEnvelope } from '@crew/shared';
import { describeEvent, formatFullDateTime, formatRelative } from '../lib/format';

/** The ticket's history ("Lịch sử"): every server event about it, oldest first. */
export function EventTimeline({ events }: { events: EventEnvelope[] }) {
  if (events.length === 0) return <p className="m-0 text-sm text-muted">Chưa có sự kiện.</p>;
  return (
    <ol aria-label="Lịch sử" className="m-0 flex list-none flex-col gap-0 border-l-2 border-line2 p-0 pl-4">
      {events.map((event) => (
        <li key={event.id} className="relative py-1.5 text-sm">
          <span className="absolute top-3 -left-[21px] size-2 rounded-full bg-line" aria-hidden />
          <span>{describeEvent(event)}</span>{' '}
          <time
            dateTime={event.createdAt}
            title={formatFullDateTime(event.createdAt)}
            className="text-xs text-muted"
          >
            · {formatRelative(event.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}
