import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/cn';

/**
 * Renders untrusted markdown (agent comments, reports, descriptions). Raw HTML is never parsed, and the
 * rehype-sanitize default (GitHub) schema strips dangerous URLs and attributes from what markdown produces.
 */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn('prose-crew', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
