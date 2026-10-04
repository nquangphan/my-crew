import { Link, Outlet } from '@tanstack/react-router';
import { type ReactNode, useSyncExternalStore } from 'react';
import { useRuntime } from './app-runtime.ts';

type PanelProps = { title: string; children: ReactNode; symbol: string; tone: 'loading' | 'error' | 'empty' };

function StatePanel({ title, children, symbol, tone }: PanelProps) {
  return (
    <section className={`state-panel state-panel--${tone}`} aria-label={title}>
      <span className="state-panel__symbol" aria-hidden="true">
        {symbol}
      </span>
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </section>
  );
}

export function LoadingPanel() {
  return (
    <StatePanel title="Đang tải" symbol="◌" tone="loading">
      Đang lấy dữ liệu mới nhất.
    </StatePanel>
  );
}

export function ErrorPanel() {
  return (
    <StatePanel title="Không tải được" symbol="!" tone="error">
      Vui lòng thử lại sau.
    </StatePanel>
  );
}

export function EmptyPanel() {
  return (
    <StatePanel title="Chưa có dữ liệu" symbol="◇" tone="empty">
      Nội dung sẽ xuất hiện tại đây.
    </StatePanel>
  );
}

function LogoutButton() {
  const { session } = useRuntime();
  const snapshot = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.snapshot(),
  );
  if (snapshot.state !== 'authenticated') return null;
  return (
    <button type="button" className="toolbar__action" onClick={() => void session.logout()}>
      Đăng xuất
    </button>
  );
}

export function Shell() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Bỏ qua điều hướng
      </a>
      <aside className="sidebar" aria-label="Thanh bên">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            C
          </span>
          <div>
            <strong>Crew</strong>
            <span>Không gian v2</span>
          </div>
        </div>
        <nav aria-label="Điều hướng chính">
          <p className="nav-heading">Làm việc</p>
          <Link className="nav-link" activeProps={{ className: 'nav-link nav-link--active' }} to="/">
            <span aria-hidden="true">▦</span>
            Tổng quan
          </Link>
        </nav>
        <nav aria-label="Điều hướng dự án">
          <p className="nav-heading">Dự án</p>
          <p className="nav-empty">Chưa có dự án để hiển thị.</p>
        </nav>
      </aside>
      <div className="workspace">
        <header className="toolbar">
          <div className="toolbar__title">Không gian làm việc</div>
          <span className="preview-label">Bản minh họa</span>
          <LogoutButton />
        </header>
        <main id="main-content" className="workspace__main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
