import { z } from 'zod';

/**
 * A project's BMAD setup as the machine that holds it installed it (`_bmad/_config/manifest.yaml` plus the
 * team-scope answers in `_bmad/config.toml`), so another machine can run the same installer non-interactively.
 * It never carries personal answers: no user name, no skill level, nothing from `_bmad/custom` or
 * `_bmad/memory`, no absolute paths, and no key that looks like a credential.
 */

/** An installer version as the manifest records it (`6.12.0`, `6.0.0-Beta.2`). */
export const BmadVersion = z
  .string()
  .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,40})?$/, 'BMAD versions look like 6.12.0');

/** A module code (`bmm`, `bmad-loop`) or a tool/IDE id (`claude-code`). */
export const BmadId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'BMAD ids are 1-64 lower-case letters, digits, - or _');

/** User-scope installer answers (and the user name wherever it appears): never part of a profile. */
export const BMAD_PERSONAL_KEYS: readonly string[] = [
  'user_name',
  'user_skill_level',
  'communication_language',
];
const SECRET_KEY = /(token|secret|password|passwd|credential|api_?key|private)/i;

export const BmadSetting = z
  .object({
    module: BmadId,
    key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'BMAD config keys are snake_case'),
    /** The value as `--set` passes it: TOML booleans and numbers as their text. */
    value: z
      .string()
      .max(500)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'no control characters')
      .refine((value) => !value.startsWith('/') && !value.startsWith('~'), 'no absolute paths'),
  })
  .refine((setting) => !BMAD_PERSONAL_KEYS.includes(setting.key), 'personal answers are not shared')
  .refine((setting) => !SECRET_KEY.test(setting.key), 'credential-like keys are not shared');
export type BmadSetting = z.infer<typeof BmadSetting>;

const Language = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[\p{L}][\p{L} ()'-]*$/u, 'a language name');

/** Relative to the project root, as `--output-folder` takes it. */
const OutputFolder = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (path) => !path.startsWith('/') && !path.startsWith('~') && !path.split(/[\\/]/).includes('..'),
    'must stay inside the repo',
  )
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
  .refine((path) => !/[\u0000-\u001f\u007f]/.test(path), 'no control characters');

export const BmadProfile = z.object({
  /** `installation.version`: the `bmad-method` installer version to run. */
  version: BmadVersion,
  /** `installation.lastUpdated`: the newest install wins when two machines report one. */
  lastUpdated: z.iso.datetime(),
  /** Installed module codes, `core` included. */
  modules: z.array(BmadId).min(1).max(50),
  /** Configured tools/IDEs (`ides` in the manifest). */
  tools: z.array(BmadId).max(60),
  communicationLanguage: Language.nullable(),
  documentOutputLanguage: Language.nullable(),
  outputFolder: OutputFolder.nullable(),
  /** Every other team-scope answer, replayed with `--set <module>.<key>=<value>`. */
  settings: z.array(BmadSetting).max(200),
});
export type BmadProfile = z.infer<typeof BmadProfile>;

/** `PUT /v1/daemon/projects/:projectKey/bmad-profile`: `stored` is false when the server has a newer install. */
export const PutBmadProfileResponse = z.object({ stored: z.boolean(), profile: BmadProfile });
export type PutBmadProfileResponse = z.infer<typeof PutBmadProfileResponse>;
