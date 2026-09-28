import { type FlowsManifest, flowsForPath } from '@crew/shared';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { docsFlow } from '../lib/docs-links';
import { FLOW_ROLE_LABEL, manifestPaths, normalizeLookupPath } from '../lib/docs-space';

/** Type a repo path, see the flows that own it (with the role), its `unassigned` reason, or that none does. */
export function FileLookup({ projectKey, manifest }: { projectKey: string; manifest: FlowsManifest }) {
  const [text, setText] = useState('');
  const inputId = useId();
  const listId = useId();
  const suggestions = useMemo(() => manifestPaths(manifest), [manifest]);
  const path = normalizeLookupPath(text);
  const result = path ? flowsForPath(manifest, path) : null;

  return (
    <section
      aria-label="Tra cứu file theo đường dẫn"
      className="flex flex-col gap-2.5 rounded-md border border-line bg-panel p-3.5"
    >
      <label htmlFor={inputId} className="text-sm font-semibold">
        Tra cứu file theo đường dẫn
      </label>
      <div className="flex min-h-11 items-center gap-2 rounded border border-line bg-bg px-2.5 text-muted focus-within:border-accent xl:min-h-9">
        <Search size={16} aria-hidden />
        <input
          id={inputId}
          list={listId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="vd: src/routes/payment-routes.ts"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 grow bg-transparent font-mono text-[13px] text-ink outline-none"
        />
      </div>
      <datalist id={listId}>
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      <div aria-live="polite" className="text-sm">
        {result && result.flows.length > 0 && (
          <ul aria-label="Flow sở hữu file" className="m-0 flex list-none flex-col gap-1 p-0">
            {result.flows.map((flow) => (
              <li key={`${flow.flowId}:${flow.role}`} className="flex flex-wrap items-center gap-2">
                <Link
                  {...docsFlow(projectKey, flow.flowId)}
                  className="inline-flex min-h-11 items-center xl:min-h-0"
                >
                  {flow.title}
                </Link>
                <span className="font-mono text-xs text-muted">{flow.flowId}</span>
                <span className="rounded-[3px] bg-neutral-bg px-1.5 py-0.5 text-[11px] font-bold text-neutral-ink uppercase">
                  {FLOW_ROLE_LABEL[flow.role]}
                </span>
              </li>
            ))}
          </ul>
        )}
        {result && result.flows.length === 0 && result.unassignedReason && (
          <p className="m-0">
            <code className="font-mono text-[13px] break-all">{path}</code> không thuộc flow nào (ngoại lệ
            trong manifest): {result.unassignedReason}
          </p>
        )}
        {result && result.flows.length === 0 && !result.unassignedReason && (
          <p className="m-0 text-muted">
            <code className="font-mono text-[13px] break-all">{path}</code> không thuộc flow nào.
          </p>
        )}
      </div>
    </section>
  );
}
