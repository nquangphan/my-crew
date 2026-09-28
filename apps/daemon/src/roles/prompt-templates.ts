import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Prompt templates are versioned Markdown files next to this module (`prompts/<name>.md`). The build copies
 * them beside the compiled code; an app that bundles the daemon points `setPromptsDir` at its copy.
 */
let promptsDir = fileURLToPath(new URL('./prompts/', import.meta.url));
const cache = new Map<string, string>();

export function setPromptsDir(dir: string): void {
  promptsDir = dir;
  cache.clear();
}

export function loadPrompt(name: string): string {
  if (!/^_?[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(`invalid prompt name "${name}"`);
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const text = readFileSync(join(promptsDir, `${name}.md`), 'utf8');
  cache.set(name, text);
  return text;
}

const PARTIAL = /\{\{>\s*([_a-z0-9-]+)\s*\}\}/g;
const VARIABLE = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g;

/**
 * Renders a prompt: `{{> partial}}` includes `prompts/partial.md` (one level), then `{{name}}` takes the
 * value of `vars.name`. A variable without a value is an error, so a typo never reaches an agent as `{{…}}`.
 * Values are inserted as-is and never re-scanned, so text inside them cannot expand into more template.
 */
export function renderPrompt(name: string, vars: Readonly<Record<string, string>>): string {
  const withPartials = loadPrompt(name).replace(PARTIAL, (_match, partial: string) => loadPrompt(partial));
  const rendered = withPartials.replace(VARIABLE, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`prompt ${name}: no value for {{${key}}}`);
    return value;
  });
  return rendered.replace(/\n{3,}/g, '\n\n').trim();
}
