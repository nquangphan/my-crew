import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownView } from './markdown-view';

describe('MarkdownView', () => {
  it('renders an <img> for a relative attachment URL (pasted image)', () => {
    render(<MarkdownView source="![ảnh](/v1/attachments/00000000-0000-4000-8000-000000000001)" />);
    const img = screen.getByRole('img', { name: 'ảnh' });
    expect(img).toHaveAttribute('src', '/v1/attachments/00000000-0000-4000-8000-000000000001');
  });
});
