// Chép từ fork Paperclip v2026.1005.0 (nhánh crew/r2-5 @ eef987b01):
//   packages/adapters/claude-local/src/server/parse.ts — parseClaudeStreamJson (bỏ phần đếm token theo modelUsage)
//   packages/adapters/claude-local/src/server/execute.ts:1127-1130 — điều kiện run thành công
//   packages/adapter-utils/src/server-utils.ts — asString, asNumber, asBoolean, parseObject, parseJson
// Chỉ dùng trong test để kiểm dòng của stub được adapter claude_local đọc như một run thành công.

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
function parseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseClaudeStreamJson(stdout: string) {
  let sessionId: string | null = null;
  let finalResult: Record<string, unknown> | null = null;
  const assistantTexts: string[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = parseJson(line);
    if (!event) continue;
    const type = asString(event.type, '');
    if (type === 'system' && asString(event.subtype, '') === 'init') {
      sessionId = asString(event.session_id, sessionId ?? '') || sessionId;
      continue;
    }
    if (type === 'assistant') {
      sessionId = asString(event.session_id, sessionId ?? '') || sessionId;
      const message = parseObject(event.message);
      for (const entry of Array.isArray(message.content) ? message.content : []) {
        const block = parseObject(entry);
        if (asString(block.type, '') === 'text' && asString(block.text, ''))
          assistantTexts.push(String(block.text));
      }
      continue;
    }
    if (type === 'result') {
      finalResult = event;
      sessionId = asString(event.session_id, sessionId ?? '') || sessionId;
    }
  }
  if (!finalResult)
    return { sessionId, costUsd: null, summary: assistantTexts.join('\n\n').trim(), resultJson: null };
  const costRaw = finalResult.total_cost_usd;
  return {
    sessionId,
    costUsd: typeof costRaw === 'number' && Number.isFinite(costRaw) ? costRaw : null,
    summary: asString(finalResult.result, assistantTexts.join('\n\n')).trim(),
    resultJson: finalResult,
  };
}

/** execute.ts: `parsedSucceeded = subtype === "success" && !is_error`; thất bại khi không thành công và (mã thoát ≠ 0 hoặc is_error). */
export function claudeRunSucceeded(resultJson: Record<string, unknown>, exitCode: number): boolean {
  const succeeded =
    asString(resultJson.subtype, '').trim().toLowerCase() === 'success' &&
    !asBoolean(resultJson.is_error, false);
  return succeeded || !(exitCode !== 0 || asBoolean(resultJson.is_error, false));
}
