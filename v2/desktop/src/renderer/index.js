async function refresh() {
  try {
    const status = await window.crew.getStatus();
    document.querySelector('#connection').textContent = 'Đã kết nối với host cục bộ';
    document.querySelector('#service').textContent = status.backgroundService.enabled
      ? 'Đang bật'
      : 'Chưa bật';
    document.querySelector('#server').textContent =
      status.serverConnection === 'online'
        ? 'Đã kết nối'
        : status.serverConnection === 'offline'
          ? 'Mất kết nối'
          : 'Chưa cấu hình';
    document.querySelector('#workflows').textContent = Object.values(status.workflows).every(
      (w) => w.source.state === 'current',
    )
      ? 'Đã cài nguồn'
      : 'Chưa cài đặt';
    document.querySelector('#dashboard').disabled = status.serverConnection === 'unconfigured';
  } catch {
    document.querySelector('#connection').textContent = 'Host cục bộ chưa chạy';
    document.querySelector('#server').textContent = 'Chưa cấu hình';
  }
}
document.querySelector('#dashboard').addEventListener('click', () =>
  window.crew.openDashboard().catch(() => {
    document.querySelector('#error').textContent = 'Chưa mở được bảng điều khiển.';
  }),
);
void refresh();
setInterval(refresh, 5000);
