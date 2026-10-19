# Cleanup raw source checkpoint

Ngày05/10/2026, sau khi v3_core xác nhận prototype planning dùng actual fork và không cần scratch nữa. PM đã xóa đúng hai artifact của phiên: scratch-paperclip-source/source.tar.gz và scratch-paperclip-source/v2026.1001.0. Archive SHA256 trước xóa được xác minh: 469619fe6f4452fee0ffac721de68d1a397fde8571a32cbabac19f25487ca58c.

Giữ metadata release/tag/tree/package, baseline/source reviews và actual fork checkout ở .worktrees/paperclip-v3 pinned8f8a0ab7effbd6a0584107d8038736c134ee5047. Raw copies không còn, đường dẫn historical trong baseline là provenance của lần khảo sát. Reproduce source từ actual fork hoặc official codeload đúng SHA khi cần; không fetch mutable master.

Không xóa dependencies/setup logs, worktree v2, actual fork, plans/docs/skill hoặc file/process khác. Không dọn global cache. Independent source/setup reviews đã lưu trước cleanup.
