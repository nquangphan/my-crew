import {
  lineDiff,
  PROMPT_CATALOG,
  type SettingsKeyInput,
  type SettingsOverviewResponse,
  settingsText,
  validatePromptTemplate,
} from '@crew/shared';
import { useState } from 'react';
import { MarkdownEditor } from '../components/markdown-editor';
import { activeOf, DiffView, SettingEditor } from '../components/setting-editor';
import { SettingsLayout, WithOverview } from './system-settings';

type Compare = 'none' | 'current' | 'default';

function PromptEditor({ overview, name }: { overview: SettingsOverviewResponse; name: string }) {
  const entry = overview.prompts.find((prompt) => prompt.name === name);
  const key: SettingsKeyInput = { kind: 'prompt', scope: 'global', name };
  const active = activeOf(overview.active, key);
  const defaultText = entry?.defaultText ?? '';
  const currentText = active?.content ? settingsText('prompt', active.content) : defaultText;
  const [text, setText] = useState(currentText);
  const [compare, setCompare] = useState<Compare>('none');
  const partials = overview.prompts.filter((prompt) => prompt.partial);
  const against = compare === 'current' ? currentText : defaultText;
  return (
    <SettingEditor
      settingKey={key}
      active={active}
      draft={{ text }}
      errors={validatePromptTemplate(name, text)}
      dirty={text !== currentText}
      resetLabel="Dùng lại bản mặc định"
      fallbackLabel="bản mặc định đi kèm app"
    >
      <MarkdownEditor label={`Nội dung ${name}.md`} value={text} onChange={setText} rows={22} />
      <details className="rounded border border-line2 p-2.5 text-[13px]">
        <summary className="cursor-pointer font-semibold">Biến và phần chung dùng được</summary>
        <p className="m-0 mt-2 text-muted">
          Daemon điền mọi biến cho mọi bước; biến không áp dụng cho lượt chạy thì rỗng. Biến hoặc phần chung
          không có trong danh sách bị từ chối khi lưu.
        </p>
        <dl
          aria-label="Biến của prompt"
          className="m-0 mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1"
        >
          {overview.variables.map((variable) => (
            <div key={variable.name} className="contents">
              <dt>
                <code>{`{{${variable.name}}}`}</code>
              </dt>
              <dd className="m-0">{variable.description}</dd>
            </div>
          ))}
          {!entry?.partial &&
            partials.map((partial) => (
              <div key={partial.name} className="contents">
                <dt>
                  <code>{`{{> ${partial.name}}}`}</code>
                </dt>
                <dd className="m-0">{partial.label}</dd>
              </div>
            ))}
        </dl>
      </details>
      <div className="flex flex-col gap-2">
        <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0 text-[13px]">
          <legend className="float-left mr-2 font-semibold text-muted">So sánh:</legend>
          {(
            [
              ['none', 'Ẩn'],
              ['current', 'Với bản đang dùng'],
              ['default', 'Với bản mặc định'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={compare === value}
              onClick={() => setCompare(value)}
              className={
                compare === value
                  ? 'min-h-11 rounded border border-accent bg-accent-bg px-2.5 text-accent-ink xl:min-h-8'
                  : 'min-h-11 rounded border border-line px-2.5 xl:min-h-8'
              }
            >
              {label}
            </button>
          ))}
        </fieldset>
        {compare !== 'none' &&
          (compare === 'default' && entry?.defaultText === null ? (
            <p className="m-0 text-sm text-muted">Server không có bản mặc định của prompt này.</p>
          ) : (
            <DiffView
              lines={lineDiff(against, text)}
              label={compare === 'current' ? 'Khác biệt với bản đang dùng' : 'Khác biệt với bản mặc định'}
            />
          ))}
      </div>
    </SettingEditor>
  );
}

/** One role prompt: Markdown editor with preview, variables help, diffs, save with a note, history. */
export function SettingsPromptPage({ name }: { name: string }) {
  const label = PROMPT_CATALOG.find((prompt) => prompt.name === name)?.label;
  return (
    <SettingsLayout
      title={label ? `Prompt: ${label}` : 'Prompt'}
      crumbs={[
        { label: 'Prompts', link: { to: '/settings/prompts' } },
        { label: name, mono: true },
      ]}
    >
      {label ? (
        <WithOverview>
          {(overview) => {
            const active = activeOf(overview.active, { kind: 'prompt', scope: 'global', name });
            return <PromptEditor key={active?.id ?? 'default'} overview={overview} name={name} />;
          }}
        </WithOverview>
      ) : (
        <p role="alert" className="m-0 text-sm text-bad">
          Không có prompt {name}.
        </p>
      )}
    </SettingsLayout>
  );
}
