import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { decideFailure, failedJobText } from '../src/roles/failure-policy.js';
import {
  buildRunTrace,
  emptyCapture,
  type RunCapture,
  recordTool,
  TRACE_MESSAGE_CHARS,
  traceMarkdown,
} from '../src/runner/run-trace.js';
import { StateDb } from '../src/state-db.js';
import { tempDir } from './helpers/git.js';

const FAKE_KEY = ['AKIA', 'Z7QX4M2P', 'WL3KRB6D'].join('');
const GITHUB_TOKEN = `ghp_${'a1B2'.repeat(9)}`;

function capture(over: Partial<RunCapture> = {}): RunCapture {
  return { ...emptyCapture(), numTurns: 12, durationMs: 3_725_000, ...over };
}

describe('run trace', () => {
  it('scrubs credentials from the last message and tool targets, keeping its line breaks', () => {
    const trace = buildRunTrace({
      capture: capture({
        lastMessage: `Dòng một có ${FAKE_KEY}.\n\nDòng hai có token ${GITHUB_TOKEN}.`,
        lastTools: [{ tool: 'Read', target: `notes/${GITHUB_TOKEN}.md` }],
      }),
      subtype: 'error_max_turns',
      costUsd: 10.0291,
    });
    expect(trace.lastMessage).toBe(
      'Dòng một có [đã ẩn: aws-access-key-id].\n\nDòng hai có token [đã ẩn: github-token].',
    );
    expect(trace.lastTools).toEqual([{ tool: 'Read', target: 'notes/[đã ẩn: github-token].md' }]);
    const block = traceMarkdown(trace, 'docs_init');
    expect(block).not.toContain(FAKE_KEY);
    expect(block).not.toContain(GITHUB_TOKEN);
    expect(block).toContain('**Số lượt / thời gian / chi phí:** 12 lượt · 1 giờ 2 phút · 10.0291 USD');
    expect(block).toContain('kết quả SDK `error_max_turns` · giai đoạn `docs_init` · context không bị nén');
    expect(block).toContain(
      '> Dòng một có [đã ẩn: aws-access-key-id].\n>\n> Dòng hai có token [đã ẩn: github-token].',
    );
    expect(block).toContain('1. `Read` `notes/[đã ẩn: github-token].md`');
  });

  it('trims a long message after scrubbing and says so', () => {
    const long = `${FAKE_KEY} ${'x'.repeat(TRACE_MESSAGE_CHARS * 2)}`;
    const trace = buildRunTrace({ capture: capture({ lastMessage: long }), subtype: 'success', costUsd: 1 });
    expect(trace.lastMessageTrimmed).toBe(true);
    expect(trace.lastMessage?.startsWith('[đã ẩn: aws-access-key-id] x')).toBe(true);
    expect(trace.lastMessage?.length).toBe(TRACE_MESSAGE_CHARS + 1);
    expect(trace.lastMessage?.endsWith('…')).toBe(true);
    expect(traceMarkdown(trace, null)).toContain(`(cắt còn ${TRACE_MESSAGE_CHARS} ký tự đầu)`);
  });

  it('keeps the last five tool calls with repo-relative paths and no command lines', () => {
    const c = emptyCapture();
    for (const name of ['a', 'b', 'c', 'd']) recordTool(c, 'Edit', { file_path: `/w/src/${name}.ts` }, '/w');
    recordTool(c, 'Bash', { command: `curl -H "Authorization: ${GITHUB_TOKEN}"` }, '/w');
    recordTool(c, 'Read', { file_path: '/etc/hosts' }, '/w');
    recordTool(c, 'Skill', { skill: 'ak:scout' }, '/w');
    expect(c.lastTools).toEqual([
      { tool: 'Edit', target: 'src/c.ts' },
      { tool: 'Edit', target: 'src/d.ts' },
      { tool: 'Bash', target: null },
      { tool: 'Read', target: '/etc/hosts' },
      { tool: 'Skill', target: 'ak:scout' },
    ]);
  });

  it('shows a run without a result, message or tools plainly', () => {
    const trace = buildRunTrace({ capture: emptyCapture(), subtype: null, costUsd: 0 });
    const block = traceMarkdown(trace, 'qc');
    expect(block).toContain('không rõ số lượt · không rõ thời gian · 0.0000 USD');
    expect(block).toContain('kết quả SDK không có (lượt chạy không trả kết quả)');
    expect(block).toContain('_(agent không để lại tin nhắn văn bản nào)_');
    expect(block).toContain('_(không có lệnh gọi tool nào)_');
  });
});

describe('failure comments and the heartbeat line', () => {
  const trace = buildRunTrace({
    capture: capture({
      compactions: 2,
      lastMessage: 'Hết lượt trước khi viết xong docs/flows.yaml.',
      lastTools: [{ tool: 'Write', target: 'docs/flows.yaml' }],
    }),
    subtype: 'success',
    costUsd: 10.0291,
  });
  const job = {
    kind: 'docs_init' as const,
    failedAttempts: 0,
    sessionId: 's-1',
    stage: 'docs_init' as const,
    runTrace: trace,
  };

  it('adds the diagnosis to the retry and the block comment', () => {
    const retry = decideFailure({ job, reason: 'not_finished', costUsd: 10.0291 });
    expect(retry.comment).toMatch(/^Lần thử 1\/2 không thành: lượt chạy kết thúc mà ticket chưa xong/);
    expect(retry.comment).toContain('context đã bị nén 2 lần');
    expect(retry.comment).toContain('> Hết lượt trước khi viết xong docs/flows.yaml.');
    expect(retry.comment).toContain('1. `Write` `docs/flows.yaml`');
    const block = decideFailure({
      job: { ...job, failedAttempts: 1 },
      reason: 'not_finished',
      costUsd: 10.0291,
    });
    expect(block.action).toBe('block');
    expect(block.comment).toContain('(lần 2/2, lỗi `not_finished`, chi phí lượt này 10.0291 USD)');
    expect(block.comment).toContain('**Tin nhắn cuối của agent**');
    const budget = decideFailure({ job, reason: 'budget', costUsd: 5 });
    expect(budget.comment).toContain('**Các bước cuối**');
    // A job without a trace (an older row) keeps the one-line comment.
    expect(
      decideFailure({ job: { ...job, runTrace: null }, reason: 'runner_error', costUsd: 0 }).comment,
    ).not.toContain('**');
  });

  it('gives the heartbeat the reason in words and a short diagnosis, at most 500 characters', () => {
    const text = failedJobText({ error: 'not_finished', runTrace: trace });
    expect(text).toBe(
      'not_finished: lượt chạy kết thúc mà ticket chưa xong · 12 lượt · 1 giờ 2 phút · 10.0291 USD · bước cuối: Write docs/flows.yaml · tin nhắn cuối: Hết lượt trước khi viết xong docs/flows.yaml.',
    );
    const long = failedJobText({
      error: 'error_during_execution',
      runTrace: { ...trace, lastMessage: 'y'.repeat(2_000) },
    });
    expect(long.length).toBe(500);
    expect(long.startsWith('error_during_execution · 12 lượt')).toBe(true);
    expect(failedJobText({ error: null, runTrace: null })).toBe('không rõ lỗi');
  });
});

describe('state db', () => {
  it('stores the run trace on the job row and adds the column to an older database', () => {
    const path = `${tempDir('crewd-state-')}/state.db`;
    const first = new StateDb(path);
    first.close();
    const raw = new Database(path);
    raw.exec('alter table jobs drop column run_trace');
    raw.close();

    const state = new StateDb(path);
    const job = state.insertJob({ ticketId: 't-1', projectId: null, role: 'dev', trigger: 'manual' });
    expect(job.runTrace).toBeNull();
    const trace = buildRunTrace({
      capture: capture({ lastMessage: 'xin chào' }),
      subtype: 'success',
      costUsd: 1,
    });
    expect(state.updateJob(job.id, { runTrace: trace }).runTrace).toEqual(trace);
    state.close();
  });
});
