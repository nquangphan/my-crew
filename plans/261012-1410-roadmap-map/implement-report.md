# Báo cáo làm trang Roadmap (cả 4 pha + nhánh Docs)

Ngày 12/10/2026 (Asia/Ho_Chi_Minh). Worktree `~/Documents/projects/crew/.worktrees/paperclip-issues-ui`, nhánh
`crew/project-access`, từ `6e249660b`. Chưa push, chưa deploy.

## Kết quả

Đã có trang `/<prefix>/roadmap` (mục "Roadmap" trong nhóm Công việc, ngay sau Yêu cầu, mọi vai trò):

- Tầng công ty → project → yêu cầu gốc do người tạo → cây việc con (cả cháu chắt), cạnh cha-con liền, cạnh chặn nét
  đứt có mũi tên, màu trạng thái, số đếm trên nút, thanh tiến độ "x/y việc con xong".
- Nhánh Docs (yêu cầu thêm của owner): tầng project có nút **Docs** (đứng đầu vòng, icon sách, số trang; chưa có bản
  docs thì mờ "Chưa có docs" và không bấm được; đang tải thì giữ chỗ). Bấm Docs → thư mục và trang; bấm thư mục đi sâu
  cùng hiệu ứng; bấm trang mở popup đọc dùng lại `DocsReader` (link nội bộ đổi trang ngay trong popup), có nút "Mở
  trong trang Docs" tới `/docs?project=…&path=…`.
- Chuyển động: bấm nút → các nút khác mờ, camera phóng vào (450 ms) → đổi URL → tầng mới đặt camera tức thì ở tâm rồi
  thu ra (650 ms), nút con bay từ tâm ra so le, cạnh hiện dần. Lùi (nút Lùi, breadcrumb, Esc, Back) thì thu ra từ nút vừa
  rời và trả focus về đó. `prefers-reduced-motion` tắt hết. Sáng/tối theo token.
- URL: `?project=<id|none>&request=<mã>`, `?docs=1&folder=<đường>`, popup `&doc=<đường>` (đẩy một mục history, đóng thì
  lùi), `&view=list`, việc con mở popup có sẵn `?issue=`.
- Dạng danh sách (`?view=list`) cho cùng nội dung, đủ (không cắt trần). Trần 40 project / 60 yêu cầu / 150 việc / 60
  mục docs, vượt thì nút "+N khác" mở dạng danh sách. Dải cảnh báo khi danh sách đủ 1000 dòng.
- Quyền: lọc bằng `useVisibleProjects` như trang Yêu cầu; thành viên bị giới hạn chỉ thấy project được cấp, không có
  "Chưa gắn project"; deep link tới project/yêu cầu/docs không được xem ra cùng thông báo "Không tìm thấy hoặc bạn không
  được xem".

## Commit (4, chưa push)

| SHA | Nội dung |
|---|---|
| `005b98a5e` | feat(crew-web): widget bản đồ Roadmap trong design system |
| `9a717a0ce` | feat(crew-web): trang Roadmap bản đồ công ty, project, yêu cầu, việc con và docs |
| `b149d64b8` | test(crew-web): kiểm hợp đồng URL của trang Roadmap |
| `56f9c03c4` | test(crew-web): ca e2e S22 Roadmap và mục Roadmap trong Hướng dẫn |

## Design system: dùng lại và thêm mới

Dùng lại: token màu/bo góc/bóng của theme (`bg-card`, `border`, `text-muted-foreground`, `primary`, `ring`,
`--status-task-icon-*`, `--motion-ease-*`), `StatusGlyph` (cùng bảng màu với danh sách và Kanban; thêm export
`statusColorVar` dùng chung thay vì chép bảng), `PageHeader`, `Breadcrumb*`, `FilterBar`, `Button`, `EmptyState`,
`ErrorState`, `Spinner`, `Alert`, `IssuePopupFrame`/`Dialog`, `DocsReader` + `MarkdownView variant="document"` (qua trang
Docs), icon lucide qua ds. Nút thẻ theo đúng kiểu thẻ của `crew-map` (rounded-lg, border, bg-card, shadow-sm). Không có
mã màu cứng nào trong widget (màu project lấy từ dữ liệu `project.color`, fallback `var(--primary)`).

Thêm mới trong `src/ds/widgets/roadmap/` (export qua `src/ds/index.ts`): `RoadmapCanvas` (nạp lười `roadmap-flow`),
`RoadmapList`, `RoadmapLegend`, `RoadmapDocPopup`, bố cục thuần `rings`/`radialTree`/`layoutLevel`, kiểu
`RoadmapLevel/Node/Edge`; mặt nút `roadmap-node.tsx` (nội bộ). `tokens.css`: `--roadmap-zoom-in/out`, keyframe
`roadmap-node-enter`, `roadmap-fade-in`, biến nút điều khiển xyflow theo token.

## Kiểm

- Vitest cả gói: 148 file, 1332 ca đạt (mới: `roadmap-model` 16, `roadmap-layout` 10, `roadmap-canvas` 4,
  `roadmap-url` 11, `roadmap-page` 10; sửa `sidebar-groups`, `routes-util`; guard mới "@/ds không kéo @xyflow").
- `tsc -b --noEmit`, `tsc -p e2e/tsconfig.json`, `biome check src test e2e`: sạch.
- `vite build` với `CREW_UI_COMMIT=56f9c03c4275c0d3e60a9cefd3ca5c51884f08b5` ra thư mục scratch: đạt, commit có trong
  `index.html`. Chunk `index` 212.89 kB so với 212.47 kB ở `6e249660b` (+0.42 kB, gzip +0.08 kB); xyflow nằm chunk lười.
- E2E T1 (`~/crew-ga-t1`, server và plugin từ worktree này), chỉ `PW-S22|PW-S0-`: PW-S22-1, 2, 3 đạt; PW-S0-1, 2, 4, 5,
  6, 7 đạt (PW-S0-1 mở cả link Roadmap). **PW-S0-3 đỏ** vì chữ "Nguyễn Quang" (tên tài khoản ở chân sidebar) — lỗi có
  từ trước, đã ghi trong báo cáo mobile-menu, không do thay đổi này.
- Ảnh hướng dẫn: `CREW_GUIDE_SHOTS_ONLY=roadmap,shell` (vi, en) đạt: ảnh mới `img/{vi,en}/roadmap.webp`, chụp lại
  `shell.*` (thanh bên có thêm Roadmap).
- Ảnh nghiệm thu trong thư mục plan (company mẫu 2P Demo của T1):
  `shot-company.png`, `shot-project.png`, `shot-request.png`, `shot-request-popup.png` (1440×900, popup mở),
  `shot-docs.png`, `shot-docs-folder.png`, `shot-doc-popup.png`, `shot-request-dark.png`, `shot-phone.png`,
  `shot-phone-list.png` (390×844; `scrollWidth` = 390, không cuộn ngang). Đã xem cả khung giữa chuyển động (phóng vào
  project rồi thu ra) để chắc hiệu ứng chạy.

## Kiểm `createdByUserId` (pha 1)

- Đường duyệt góp ý: issue do trình duyệt owner đăng bằng route lõi khi duyệt, nên mang `createdByUserId` của owner. Truy
  vấn chỉ đọc DB T1: 3/3 issue có khóa `crew-contribution:*` đều có `created_by_user_id`.
- CLI: board key được xác thực thành actor `user` (`server/src/middleware/auth.ts`), route tạo issue gán
  `createdByUserId: actor.actorType === "user" ? actor.actorId : null` (`server/src/routes/issues.ts:10099…`), nên cũng có.
- T1: 451 issue gốc, tất cả `origin_kind=manual`, có `created_by_user_id`. Không sửa server.

## Lệch so với plan

1. `roadmap-list.tsx` nằm ở `src/ds/widgets/roadmap/` (không ở feature) vì cần class trình bày (thụt lề, viền) mà guard
   chỉ cho class bố cục ngoài ds; feature chỉ dựng dữ liệu.
2. Thêm `roadmap-node.tsx`, `roadmap-types.ts`, `roadmap-doc-popup.tsx` (ds) và `roadmap-doc-reader.tsx` (feature) cho
   nhánh Docs; nút Lùi và công tắc Bản đồ/Danh sách đặt trên một hàng `FilterBar` dưới tiêu đề (để không vỡ trên 390px).
3. Danh sách compact chỉ trả `blockedBy` khi có `includeBlockedBy=true`, nên query cây việc con gửi thêm tham số này
   (không đổi server).
4. PW-S22-1 không dựng được "việc gốc do agent tạo": policy Crew chặn agent tạo issue gốc (`crew_agent_root_issue`).
   Bộ lọc đó có unit test (`roadmap-model.test.ts`, `roadmap-page.test.tsx`).
5. PW-S22-3 cần một project có bản docs; company e2e trên T1 chưa có nên ca dùng project có docs của company khác board
   xem được (2P Demo). Ca chỉ đọc; không có bản docs nào thì tự bỏ qua.
6. Nút ở tâm (trừ yêu cầu) bấm thì lùi một tầng, như mockup.

## Tiến trình

Đã khởi động và dừng: server T1 (`cli/node_modules/.bin/tsx cli/src/index.ts run`, `FORK`=worktree này, PID 71758 +
Postgres nhúng 54329) và vite 5183 (PID 65473), SIGTERM. Cổng 3199, 5183, 54329 trống. Worktree tạm build gốc ở scratch
đã gỡ (`git worktree remove`).

## Ghi chú

- Có file chưa theo dõi `crew/ops/auto-deploy-vps.sh` xuất hiện trong worktree trong lúc làm; không phải của em, em không
  đụng tới.
- Dữ liệu T1 thêm: project thử `PW-S22 …` (đã lưu trữ) và issue của ca (fixture tự hủy); company mẫu 2P Demo được làm
  mới khi chụp ảnh hướng dẫn.

## Vòng sửa theo review của foreman (12/10, chiều)

Commit `4f7aad4ea` và `41be9bc8b` (chưa push). Không đụng `server/src` (agent khác đang sửa).

1. **Chữ đọc được**: camera sau khi vào/lùi tầng không còn `fitView` tự thu nhỏ. Hàm thuần `readableView` (ds) tính đích:
   tầng vừa khung ở độ phóng ≥ 1 thì canh giữa cả tầng (tối đa 1.2), không thì giữ độ phóng 1 và đặt nút đang focus (tâm
   khi vào, nút vừa rời khi lùi) ở giữa; người xem kéo để xem phần còn lại. Áp cho mọi tầng (project, việc con, docs).
   Nút ⤢ vẫn thu nhỏ để thấy cả tầng. Tầng thẻ xếp trên vòng elip dẹt ngang (thưa hơn, vừa màn hình rộng). Đo trên 1440×900
   với dữ liệu 2P Demo: tầng project độ phóng 1.016 (tiêu đề thẻ cao 20px), tầng việc con 1.12, docs 1.2, điện thoại 1.0.
2. **Chú thích không che nút**: chuyển xuống dưới khung bản đồ, có nút "Chú thích" thu gọn/mở (mặc định thu gọn khi rộng
   < 640px). Gợi ý tầng chuyển sang góc trên trái.
3. **Docs tự vào thư mục duy nhất**: tầng chỉ có một thư mục và không có trang thì tự đi xuống (`resolveDocsFolder`), khóa
   tầng, breadcrumb và nút Lùi theo thư mục hiện ra (`docsParentFolder` bỏ qua tầng tự đi xuống, Lùi về project).
4. **Ảnh chụp lại**: `shot-company.png`, `shot-project.png`, `shot-request.png`, `shot-request-popup.png`, `shot-docs.png`
   (bấm Docs ra thẳng `docs` với 2 thư mục và 1 trang), `shot-docs-folder.png`, `shot-doc-popup.png`,
   `shot-request-dark.png`, `shot-phone.png`, `shot-phone-docs.png`, `shot-phone-list.png`. Đã tự xem: chữ trên thẻ đọc rõ
   ở 1440×900; 390px không cuộn ngang. Ảnh hướng dẫn `roadmap.webp` (vi, en) chụp lại; Hướng dẫn thêm câu về kéo để xem
   tiếp, chú thích thu gọn và docs tự vào thư mục.

Kiểm: vitest 148 file / 1337 ca đạt (thêm ca `readableView`, `resolveDocsFolder`/`docsParentFolder`, trang docs tự đi
xuống); `tsc`, `tsc -p e2e`, `biome check src test e2e` sạch; `vite build` với `CREW_UI_COMMIT=41be9bc8b764594533dd8a5f5c9ae9ed5aaad7cd`
đạt (index 212.89 kB). E2E T1 chỉ `PW-S22`: 3/3 đạt ở `4f7aad4ea` (PW-S22-3 sửa cho trường hợp tự vào thư mục);
`41be9bc8b` chỉ khai thêm phụ thuộc hook cho lint, không chạy lại e2e. Đã dừng server T1 và vite em bật; cổng 3199, 5183,
54329 trống. Còn một Postgres nhúng tạm (`paperclip-queued-comments-*`, cổng 52365) của test server do agent khác chạy,
em không đụng.
