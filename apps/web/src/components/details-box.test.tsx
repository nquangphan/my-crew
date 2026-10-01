import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ticket } from '../test/fixtures';
import { renderWithApp } from '../test/render';
import { DetailsBox } from './details-box';

function box(overrides: Parameters<typeof ticket>[0] = {}) {
  const t = ticket(overrides);
  return renderWithApp(
    <DetailsBox
      ticket={t}
      parent={null}
      siblings={[]}
      machine={undefined}
      project={undefined}
      running={false}
      onStatus={vi.fn()}
      onPriority={vi.fn()}
    />,
  );
}

describe('DetailsBox: dòng Kiểm thử', () => {
  it('hiện đúng nhãn tiếng Việt của mỗi loại kiểm thử và lý do cho ticket qc có testKinds', async () => {
    box({
      type: 'qc',
      assigneeRole: 'qc',
      testKinds: ['api', 'integration'],
      testReason: 'Chỉ đổi service, không đổi giao diện',
    });
    expect(await screen.findByText('Kiểm thử')).toBeInTheDocument();
    expect(screen.getByText('Kiểm thử API, Integration test')).toBeInTheDocument();
    expect(screen.getByText('Lý do: Chỉ đổi service, không đổi giao diện')).toBeInTheDocument();
  });

  it('hiện nhãn kiểm thử giao diện web khi testKinds có ui_web', async () => {
    box({ type: 'qc', assigneeRole: 'qc', testKinds: ['ui_web'], testReason: 'Đổi màn hình thanh toán' });
    expect(await screen.findByText('Kiểm thử giao diện web')).toBeInTheDocument();
  });

  it('không hiện dòng Kiểm thử cho ticket qc cũ chưa có testKinds (null)', async () => {
    box({ type: 'qc', assigneeRole: 'qc', testKinds: null, testReason: null });
    expect(await screen.findByText('Độ phức tạp')).toBeInTheDocument();
    expect(screen.queryByText('Kiểm thử')).not.toBeInTheDocument();
  });

  it('không hiện dòng Kiểm thử cho ticket không phải qc', async () => {
    box({ type: 'dev', assigneeRole: 'dev' });
    expect(await screen.findByText('Độ phức tạp')).toBeInTheDocument();
    expect(screen.queryByText('Kiểm thử')).not.toBeInTheDocument();
  });
});
