import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api-client';
import { errorMessage, formatDateTime, formatRelative } from './format';

describe('format', () => {
  it('shows times in Asia/Saigon', () => {
    expect(formatDateTime('2026-09-28T02:14:00.000Z')).toBe('28/09 09:14');
    expect(formatDateTime('2026-09-28T17:30:00.000Z')).toBe('29/09 00:30');
  });

  it('describes recent times in Vietnamese', () => {
    const now = Date.parse('2026-09-28T10:00:00.000Z');
    expect(formatRelative('2026-09-28T09:57:00.000Z', now)).toBe('3 phút trước');
    expect(formatRelative('2026-09-28T08:00:00.000Z', now)).toBe('2 giờ trước');
    expect(formatRelative('2026-09-27T09:00:00.000Z', now)).toBe('hôm qua');
  });

  it('maps API errors to Vietnamese messages', () => {
    expect(errorMessage(new ApiRequestError(409, 'REPORT_REQUIRED', 'x'))).toBe(
      'Ticket cần có report trước khi chuyển sang Xong.',
    );
    expect(errorMessage(new ApiRequestError(500, 'INTERNAL', 'x'))).toBe('Lỗi máy chủ (500).');
    expect(errorMessage(new Error('boom'))).toBe('Đã có lỗi xảy ra.');
  });

  it('shows a clear size message for an over-limit attachment, regardless of the raw backend message', () => {
    expect(errorMessage(new ApiRequestError(413, 'ATTACHMENT_TOO_LARGE', 'ảnh vượt quá 10MB'))).toBe(
      'Ảnh vượt quá giới hạn 10MB, hãy chọn ảnh nhỏ hơn.',
    );
  });
});
