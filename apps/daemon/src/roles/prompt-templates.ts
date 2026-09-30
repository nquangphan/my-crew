import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPT_PARTIAL_PATTERN, PROMPT_VARIABLE_PATTERN } from '@crew/shared';

/**
 * Prompt templates are versioned Markdown files next to this module (`prompts/<name>.md`). The build copies
 * them beside the compiled code; an app that bundles the daemon points `setPromptsDir` at its copy. They are
 * the defaults: a prompt the owner edited on the web (a server setting) replaces its file for new jobs.
 */
let promptsDir = fileURLToPath(new URL('./prompts/', import.meta.url));
const cache = new Map<string, string>();

/** Prompt overrides by name, from the server settings a job started with. */
export type PromptOverrides = Readonly<Partial<Record<string, string>>>;

export function setPromptsDir(dir: string): void {
  promptsDir = dir;
  cache.clear();
}

/** The prompt's text: the override when there is one, else the bundled file. */
export function loadPrompt(name: string, overrides: PromptOverrides = {}): string {
  if (!/^_?[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(`invalid prompt name "${name}"`);
  const override = overrides[name];
  if (override !== undefined) return override;
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const text = readFileSync(join(promptsDir, `${name}.md`), 'utf8');
  cache.set(name, text);
  return text;
}

/**
 * Renders a prompt: `{{> partial}}` includes `prompts/partial.md` (one level), then `{{name}}` takes the
 * value of `vars.name`. A variable without a value is an error, so a typo never reaches an agent as `{{…}}`.
 * Values are inserted as-is and never re-scanned, so text inside them cannot expand into more template.
 * `overrides` replace bundled prompts and partials by name (the server's prompt settings).
 */
export function renderPrompt(
  name: string,
  vars: Readonly<Record<string, string>>,
  overrides: PromptOverrides = {},
): string {
  const withPartials = loadPrompt(name, overrides).replace(
    PROMPT_PARTIAL_PATTERN,
    (_match, partial: string) => loadPrompt(partial, overrides),
  );
  const rendered = withPartials.replace(PROMPT_VARIABLE_PATTERN, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`prompt ${name}: no value for {{${key}}}`);
    return value;
  });
  return rendered.replace(/\n{3,}/g, '\n\n').trim();
}
