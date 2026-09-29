import type { Project } from '@crew/shared';
import { parseProjectKeys, toggleCsv } from '../lib/search-params';
import { FilterMenu } from './filter-menu';
import { ProjectBadge } from './project-badge';

/**
 * The projects a `?project=KEY,KEY` filter selects. Unknown keys are ignored; an empty result means "every
 * project", like the all-projects board.
 */
export function selectedProjects(
  projects: readonly Project[] | undefined,
  value: string | undefined,
): Project[] {
  const keys = parseProjectKeys(value);
  return (projects ?? []).filter((p) => keys.includes(p.key));
}

/**
 * The "Dự án" multi-select used by every cross-project screen (boards, lists, inbox, machines, docs). The
 * selection lives in the URL as `project=KEY,KEY`.
 */
export function ProjectFilterMenu({
  projects,
  value,
  onChange,
}: {
  projects: readonly Project[];
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  return (
    <FilterMenu
      label="Dự án"
      options={projects.map((p) => p.key)}
      selected={parseProjectKeys(value)}
      render={(key) => (
        <>
          <ProjectBadge projectKey={key} /> {projects.find((p) => p.key === key)?.name}
        </>
      )}
      onToggle={(key) => onChange(toggleCsv(value, key))}
    />
  );
}
