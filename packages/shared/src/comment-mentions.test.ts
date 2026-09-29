import { describe, expect, it } from 'vitest';
import { parseMentions } from './comment-mentions.js';

describe('parseMentions', () => {
  it.each([
    '@pm xem giúp ticket này',
    'Nhờ @pm đánh giá lại.',
    'Nhờ @PM đánh giá lại',
    '@Pm, chạy lại giúp',
    '(@pm)',
    'dòng một\n@pm: dòng hai',
    '`code` rồi @pm',
  ])('finds the tag in %j', (body) => {
    expect(parseMentions(body)).toEqual(['pm']);
  });

  it.each([
    'Không gắn thẻ ai',
    'gửi mail cho team@pm.example.com',
    'ai@pm',
    '@pmx không phải thẻ',
    '@pm-bot không phải thẻ',
    '@pm_bot không phải thẻ',
    'xem https://x.test/@pm',
    'viết `@pm` để gọi PM',
    'viết ``a ` @pm`` như ví dụ',
    '```\n@pm trong khối code\n```',
    '~~~md\n@pm\n~~~\nhết',
    '```\n@pm khối chưa đóng',
  ])('ignores %j', (body) => {
    expect(parseMentions(body)).toEqual([]);
  });

  it('counts a tag after a closed code block', () => {
    expect(parseMentions('```\nví dụ\n```\n@pm làm tiếp')).toEqual(['pm']);
  });
});
