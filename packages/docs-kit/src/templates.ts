import agents from '../templates/AGENTS.md?raw';
import architecture from '../templates/architecture.md?raw';
import ciWorkflow from '../templates/crew-docs.yml?raw';
import flow from '../templates/flow.md?raw';
import flowsYaml from '../templates/flows.yaml?raw';
import index from '../templates/index.md?raw';

/** Templates of the docs standard, inlined into the single-file bundle. */
export const TEMPLATES = {
  agents,
  architecture,
  ciWorkflow,
  flow,
  flowsYaml,
  index,
  claude: '@AGENTS.md\n',
} as const;

/** A flow doc from the template, with its id and title filled in. */
export function renderFlowTemplate(id: string, title: string): string {
  return TEMPLATES.flow.replaceAll('{{id}}', id).replaceAll('{{title}}', title);
}
