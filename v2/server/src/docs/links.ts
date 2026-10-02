import { posix } from 'node:path';
import type { AuditIssue, DocLink } from './contracts.ts';
import { validPath } from './manifest.ts';

const finding = (
  code: string,
  path: string,
  message: string,
  severity: AuditIssue['severity'],
): AuditIssue => ({ code, path, message, severity });

function slug(text: string): string | null {
  const clean = text
    .replace(/<[^>]*>/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .trim()
    .toLowerCase();
  if (!clean || /[{}]/.test(clean)) return null;
  return clean.replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
}

function anchors(text: string): { found: Set<string>; uncertain: boolean } {
  const found = new Set<string>();
  const counts = new Map<string, number>();
  let fenced = false;
  let uncertain = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = slug(heading[1] ?? '');
    if (base === null) {
      uncertain = true;
      continue;
    }
    const suffix = counts.get(base) ?? 0;
    counts.set(base, suffix + 1);
    found.add(suffix === 0 ? base : `${base}-${suffix}`);
  }
  return { found, uncertain };
}

function scanText(text: string): { visible: string; references: Map<string, string>; unsupported: boolean } {
  const references = new Map<string, string>();
  const visible: string[] = [];
  let fenced = false;
  let unsupported = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const def = /^\s{0,3}\[([^\]]+)\]:\s*(\S+)/.exec(line);
    if (def) {
      references.set((def[1] ?? '').toLowerCase().trim(), def[2] ?? '');
      continue;
    }
    // Code outside a label is inert; code inside a label still leaves a link token.
    const withoutCode = line.replace(/`[^`]*`/g, (_span, offset: number, source: string) => {
      const before = source.slice(0, offset);
      return before.lastIndexOf('[') > before.lastIndexOf(']') ? 'CODE' : '';
    });
    const withoutTaskMarker = withoutCode.replace(
      /^([ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)+)\[[ xX]\](?=[ \t]|$)/,
      '$1',
    );
    if (
      /\]\([^)]*\([^)]*\)/.test(withoutTaskMarker) ||
      /\[[^\]]*\[[^\]]+\][^\]]*\]\(/.test(withoutTaskMarker) ||
      /<a\s|<img\s/i.test(withoutTaskMarker)
    )
      unsupported = true;
    visible.push(withoutTaskMarker);
  }
  return { visible: visible.join('\n'), references, unsupported };
}

export function auditLinks(files: Map<string, string>): { links: DocLink[]; issues: AuditIssue[] } {
  const links: DocLink[] = [];
  const issues: AuditIssue[] = [];
  const anchorCache = new Map<string, { found: Set<string>; uncertain: boolean }>();
  for (const [fromPath, content] of files) {
    if (!fromPath.endsWith('.md')) continue;
    const { visible, references, unsupported } = scanText(content);
    if (unsupported)
      issues.push(
        finding(
          'UNVERIFIED_LINK_SYNTAX',
          fromPath,
          'Cú pháp Markdown/HTML phức tạp cần kiểm tra thủ công',
          'warning',
        ),
      );
    const token = /!?\[([^[\]]+)\]\(([^)]+)\)|!?\[([^[\]]+)\]\[([^\]]*)\]|!?\[([^[\]]+)\](?!\(|\[|:)/g;
    let occurrence = 0;
    for (const match of visible.matchAll(token)) {
      const referenceId = match[3] === undefined ? match[5] : match[4] || match[3];
      const href = match[2] ?? references.get((referenceId ?? '').toLowerCase().trim());
      const originalHref = href ?? match[0];
      const current = occurrence++;
      if (!href) {
        links.push({
          fromPath,
          occurrence: current,
          originalHref,
          toPath: '',
          fragment: null,
          status: 'unverified',
        });
        issues.push(
          finding(
            'UNVERIFIED_LINK_SYNTAX',
            fromPath,
            `Reference không có định nghĩa: ${match[0]}`,
            'warning',
          ),
        );
        continue;
      }
      if (/^(https?:|mailto:)/i.test(href)) {
        links.push({
          fromPath,
          occurrence: current,
          originalHref,
          toPath: href,
          fragment: null,
          status: 'external',
        });
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        links.push({
          fromPath,
          occurrence: current,
          originalHref,
          toPath: '',
          fragment: null,
          status: 'unverified',
        });
        issues.push(finding('UNVERIFIED_LINK_SYNTAX', fromPath, `Scheme chưa hỗ trợ: ${href}`, 'warning'));
        continue;
      }
      const split = href.indexOf('#');
      const rawPath = split < 0 ? href : href.slice(0, split);
      const fragmentRaw = split < 0 ? null : href.slice(split + 1);
      let decoded: string;
      let fragment: string | null;
      try {
        decoded = decodeURIComponent(rawPath);
        fragment = fragmentRaw === null ? null : decodeURIComponent(fragmentRaw);
      } catch {
        decoded = '';
        fragment = null;
      }
      const toPath = decoded ? posix.normalize(posix.join(posix.dirname(fromPath), decoded)) : fromPath;
      const encodedTraversal = /%(?:2e|2f|5c)/i.test(rawPath);
      if (
        (decoded && !validPath(toPath)) ||
        encodedTraversal ||
        rawPath.startsWith('/') ||
        rawPath.includes('\\') ||
        href.includes('?')
      ) {
        links.push({ fromPath, occurrence: current, originalHref, toPath, fragment, status: 'unverified' });
        issues.push(
          finding('LINK_PATH_ESCAPE', fromPath, `Link có đường dẫn không an toàn: ${href}`, 'error'),
        );
        continue;
      }
      const destination = files.get(toPath);
      if (destination === undefined) {
        links.push({ fromPath, occurrence: current, originalHref, toPath, fragment, status: 'missing' });
        const artifact =
          toPath.startsWith('docs/superpowers/') ||
          toPath.startsWith('docs/bmad/') ||
          toPath.startsWith('_bmad-output/');
        issues.push(
          finding(
            artifact ? 'EXTERNAL_ARTIFACT_NOT_IMPORTED' : 'LINK_MISSING',
            fromPath,
            `Thiếu đích link: ${href}`,
            artifact ? 'warning' : 'error',
          ),
        );
        continue;
      }
      if (fragment !== null && fragment !== '') {
        const targetAnchors = anchorCache.get(toPath) ?? anchors(destination);
        anchorCache.set(toPath, targetAnchors);
        if (!targetAnchors.found.has(fragment)) {
          const unknown = targetAnchors.uncertain;
          links.push({
            fromPath,
            occurrence: current,
            originalHref,
            toPath,
            fragment,
            status: unknown ? 'unverified' : 'missing',
          });
          issues.push(
            finding(
              unknown ? 'UNVERIFIED_LINK_SYNTAX' : 'LINK_FRAGMENT_MISSING',
              fromPath,
              `Không xác nhận được heading #${fragment} trong ${toPath}`,
              unknown ? 'warning' : 'error',
            ),
          );
          continue;
        }
      }
      links.push({ fromPath, occurrence: current, originalHref, toPath, fragment, status: 'ok' });
    }
    const leftover = visible.replace(token, '');
    if (/\]\s*\(|\]\s*\[/.test(leftover) && !unsupported)
      issues.push(
        finding('UNVERIFIED_LINK_SYNTAX', fromPath, 'Cú pháp link chưa được parser hỗ trợ', 'warning'),
      );
  }
  return { links, issues };
}
