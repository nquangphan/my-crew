import type { FlowsManifest } from '@crew/shared';
import { blobUrl, FLOW_ROLE_LABEL, flowFiles } from '../lib/docs-space';

/**
 * A flow's files as `docs/flows.yaml` lists them (entry points, files, tests, shared files). Each path links
 * to the file at the snapshot's commit when the repo URL is https.
 */
export function FlowFiles({
  manifest,
  flowId,
  repoUrl,
  commit,
}: {
  manifest: FlowsManifest;
  flowId: string;
  repoUrl: string;
  commit: string;
}) {
  const files = flowFiles(manifest, flowId);
  return (
    <section aria-labelledby="flow-files" className="prose-crew docs-prose">
      <h2 id="flow-files">File của flow</h2>
      <p className="text-[13px] text-muted">
        Theo <code>docs/flows.yaml</code> ở cùng commit.
      </p>
      {files.length === 0 ? (
        <p className="text-muted">Manifest chưa liệt kê file nào cho flow này.</p>
      ) : (
        <div className="docs-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Đường dẫn</th>
                <th scope="col">Vai trò</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => {
                const href = blobUrl(repoUrl, commit, file.path);
                return (
                  <tr key={`${file.role}:${file.path}`}>
                    <td className="font-mono text-[12.5px]">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                          {file.path}
                        </a>
                      ) : (
                        file.path
                      )}
                    </td>
                    <td className="whitespace-nowrap">{FLOW_ROLE_LABEL[file.role]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
