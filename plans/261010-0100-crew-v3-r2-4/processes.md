# Process, thư mục tạm và bản ghi tạm của R2-4

Mỗi dòng gồm:
- thời điểm (`date`);
- ticket;
- thứ đã tạo (lệnh/PID/cổng/worktree/thư mục/id bản ghi prod);
- cách dừng hoặc gỡ;
- trạng thái: `đang chạy` | `đã gỡ` | `giữ: <lý do>`.

Không để dòng `đang chạy` khi ticket đã xong.

| Thời điểm | Ticket | Thứ đã tạo | Cách dừng/gỡ | Trạng thái |
|---|---|---|---|---|
| 2026-10-10 12:43 | SP-C | thư mục `~/crew-r24-probe/` (HOME/CODEX_HOME tạm, symlink `auth.json`, fixture ps) | `trash ~/crew-r24-probe` | đã gỡ (13:25, trash) |
