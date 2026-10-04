/**
 * Safe attachment rendering. Inline content is limited to PNG/JPEG rasters (local Blob sniffed by magic
 * bytes, or authorized bytes whose SHA-256/MIME match the producer record) and verified text derivatives
 * escaped by React with a size cap. PDF/OOXML/other originals are download links only: no iframe/object/embed
 * of HTML, SVG or PDF from this origin, no markup interpretation, formulas and macros are shown as literal
 * text. Object URLs are revoked when the preview unmounts.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { OwnerClient } from '../lib/api.ts';
import type { ByteFetch, Extraction, TicketAttachment } from './queries.ts';
import {
  commentAttachmentsQuery,
  extractionsQuery,
  fetchVerifiedBytes,
  groupTicketAttachments,
  sniffRaster,
  summarizeExtraction,
  textPreviewMaxChars,
  ticketAttachmentsQuery,
} from './queries.ts';

const browserFetch: ByteFetch = (input, init) => globalThis.fetch(input, init);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/** Object URL for a Blob, revoked on change/unmount. */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/** Thumbnail of a file selected in this tab; only PNG/JPEG by magic bytes, never by name or `File.type`. */
export function LocalImagePreview({ file, label }: { file: File; label: string }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let active = true;
    setBlob(null);
    void file
      .slice(0, 8)
      .arrayBuffer()
      .then((head) => {
        const raster = sniffRaster(new Uint8Array(head));
        if (active && raster) setBlob(file.slice(0, file.size, raster));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [file]);
  const url = useObjectUrl(blob);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={label}
      style={{ maxWidth: '6rem', maxHeight: '6rem', objectFit: 'contain', borderRadius: '0.5rem' }}
    />
  );
}

type VerifiedPreviewProps = {
  fetch: ByteFetch;
  path: string;
  sha256: string;
  byteLength: number;
  mime: string;
  label: string;
  onUnauthorized?: () => void;
};

/** Authorized bytes, verified against the record before display. Text is escaped and truncated. */
export function VerifiedPreview(props: VerifiedPreviewProps) {
  const [state, setState] = useState<{ blob: Blob | null; text: string | null; error: string | null }>({
    blob: null,
    text: null,
    error: null,
  });
  const { fetch, path, sha256, byteLength, mime, onUnauthorized } = props;
  useEffect(() => {
    const abort = new AbortController();
    setState({ blob: null, text: null, error: null });
    fetchVerifiedBytes({
      fetch,
      path,
      expectedSha256: sha256,
      expectedBytes: byteLength,
      expectedMime: mime,
      signal: abort.signal,
      onUnauthorized,
    })
      .then(async (verified) => {
        if (verified.mime === 'text/plain') {
          const text = await verified.blob.text();
          if (!abort.signal.aborted) setState({ blob: null, text, error: null });
        } else if (!abort.signal.aborted) setState({ blob: verified.blob, text: null, error: null });
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted)
          setState({
            blob: null,
            text: null,
            error: error instanceof Error ? error.message : 'PREVIEW_FAILED',
          });
      });
    return () => abort.abort();
  }, [fetch, path, sha256, byteLength, mime, onUnauthorized]);
  const url = useObjectUrl(state.blob);
  if (state.error) return <p role="status">Không hiển thị được bản xem trước ({state.error}).</p>;
  if (state.text !== null) {
    const truncated = state.text.length > textPreviewMaxChars;
    return (
      <figure style={{ margin: 0 }}>
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '20rem', overflow: 'auto' }}>
          {truncated ? state.text.slice(0, textPreviewMaxChars) : state.text}
        </pre>
        {truncated && <figcaption>Chỉ hiển thị phần đầu; tải tệp để xem đầy đủ.</figcaption>}
      </figure>
    );
  }
  if (url) return <img src={url} alt={props.label} style={{ maxWidth: '100%', maxHeight: '24rem' }} />;
  return <p aria-live="polite">Đang tải bản xem trước…</p>;
}

/** Coverage and problems of one extraction; verified bytes are explicitly not “read by a model”. */
export function ExtractionStatusView({ extraction }: { extraction: Extraction }) {
  const summary = summarizeExtraction(extraction);
  return (
    <section aria-label="Trạng thái trích xuất" style={{ display: 'grid', gap: '0.25rem' }}>
      <p>
        <strong>{summary.label}</strong> · {summary.available} phần đã trích xuất
        {summary.missing.length > 0 && `, ${summary.missing.length} phần còn thiếu`}
        {!summary.verified && ' · chưa xác minh được manifest'}
      </p>
      {summary.missing.length > 0 && (
        <ul>
          {summary.missing.map((unit) => (
            <li key={unit.id}>
              {unit.where} — cần {unit.needs === 'vision' ? 'đọc hình ảnh' : 'đọc văn bản'}
              {unit.reason ? `: ${unit.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
      {extraction.problems.length > 0 && (
        <ul>
          {extraction.problems.map((problem) => (
            <li key={`${problem.code}:${problem.unitIds.join(',')}`}>
              <code>{problem.code}</code> {problem.message}
            </li>
          ))}
        </ul>
      )}
      <p>
        Dữ liệu đã xác minh chỉ cho biết tệp được lưu và trích xuất đúng; điều này không có nghĩa là Trợ lý
        hay mô hình đã đọc tệp.
      </p>
    </section>
  );
}

function AttachmentRow({
  item,
  client,
  fetch,
  onUnauthorized,
}: {
  item: TicketAttachment;
  client: OwnerClient;
  fetch: ByteFetch;
  onUnauthorized?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const extractions = useQuery({ ...extractionsQuery(client, item.attachmentId), enabled: open });
  const latest = extractions.data?.at(-1)?.extraction ?? null;
  const raster = item.mime === 'image/png' || item.mime === 'image/jpeg';
  const original = `/v2/attachments/${item.attachmentId}/content`;
  return (
    <li data-attachment-id={item.attachmentId}>
      <p>
        <strong>{item.fileName}</strong> · {formatBytes(item.byteLength)} ·{' '}
        {/* Same-origin download; the server answers with `content-disposition: attachment`. */}
        <a href={original} download={item.fileName} rel="noopener">
          Tải tệp gốc
        </a>{' '}
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? 'Ẩn chi tiết' : 'Xem chi tiết'}
        </button>
      </p>
      {open && (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {raster && item.mime && (
            <VerifiedPreview
              fetch={fetch}
              path={original}
              sha256={item.sha256}
              byteLength={item.byteLength}
              mime={item.mime}
              label={item.fileName}
              onUnauthorized={onUnauthorized}
            />
          )}
          {extractions.isPending && <p aria-live="polite">Đang tải trạng thái trích xuất…</p>}
          {extractions.isError && <p role="status">Không đọc được trạng thái trích xuất.</p>}
          {extractions.isSuccess && !latest && <p>Chưa có kết quả trích xuất.</p>}
          {latest && <ExtractionStatusView extraction={latest} />}
          {latest &&
            summarizeExtraction(latest)
              .previewable.filter((derivative) => derivative.kind === 'text' || !raster)
              .slice(0, 3)
              .map((derivative) => (
                <VerifiedPreview
                  key={derivative.id}
                  fetch={fetch}
                  path={`/v2/attachments/${item.attachmentId}/derivatives/${derivative.id}/content`}
                  sha256={derivative.sha256}
                  byteLength={derivative.byteLength}
                  mime={derivative.mime}
                  label={`${item.fileName} (bản chuẩn hóa)`}
                  onUnauthorized={onUnauthorized}
                />
              ))}
        </div>
      )}
    </li>
  );
}

/**
 * Attachment refs of a ticket, including refs inherited from ancestors. The producer list is flattened and
 * has no `commentId` or source level yet (G2 projection), so refs are listed without grouping or a
 * request/step/comment label rather than guessed from order.
 */
export function TicketAttachments({
  ticketId,
  client,
  fetch = browserFetch,
  onUnauthorized,
}: {
  ticketId: string;
  client: OwnerClient;
  fetch?: ByteFetch;
  onUnauthorized?: () => void;
}) {
  const query = useQuery(ticketAttachmentsQuery(client, ticketId));
  const byComment = useQuery(commentAttachmentsQuery(client, ticketId));
  if (query.isPending || byComment.isPending) return <p aria-live="polite">Đang tải tệp đính kèm…</p>;
  if (query.isError) return <p role="status">Không đọc được danh sách tệp đính kèm.</p>;
  if (query.data.length === 0) return <p>Ticket chưa có tệp đính kèm.</p>;
  const groups = byComment.isError
    ? { comments: [], other: query.data }
    : groupTicketAttachments(query.data, byComment.data);
  const row = (item: TicketAttachment) => (
    <AttachmentRow
      key={item.linkId}
      item={item}
      client={client}
      fetch={fetch}
      onUnauthorized={onUnauthorized}
    />
  );
  const list = { display: 'grid', gap: '0.5rem', paddingLeft: '1.25rem' } as const;
  return (
    <section aria-label="Tệp đính kèm" style={{ display: 'grid', gap: '0.5rem' }}>
      {byComment.isError && (
        <p role="status">Chưa đọc được nhóm tệp theo bình luận; đang hiện danh sách chung.</p>
      )}
      {groups.comments.map((group) => (
        <section key={group.commentId} aria-label="Tệp của bình luận" data-comment-id={group.commentId}>
          <h4 style={{ margin: 0 }}>Tệp của bình luận</h4>
          <ul style={list}>{group.attachments.map(row)}</ul>
        </section>
      ))}
      {groups.other.length > 0 && (
        <section aria-label="Tệp của ticket và tệp kế thừa">
          <h4 style={{ margin: 0 }}>Tệp của ticket và tệp kế thừa</h4>
          <p style={{ margin: 0 }}>Nhãn nguồn request/step cho tệp kế thừa sẽ có khi máy chủ cung cấp.</p>
          <ul style={list}>{groups.other.map(row)}</ul>
        </section>
      )}
    </section>
  );
}
