# Khung web Crew v2

## Mục đích

`v2/web` là ứng dụng React độc lập dưới `/crew-v2/`. Task 1 dựng khung điều hướng, trạng thái tải/lỗi/trống và fixture cô lập để các trang nghiệp vụ kế tiếp dùng chung. Nội dung guest hiện là **Bản minh họa**; chưa đại diện cho project hoặc ticket thật.

## Điểm vào

- `v2/web/src/main.tsx` tạo React root, QueryClient và router trong một lần mount của browser app.
- `v2/web/src/router.tsx` khai báo root outlet và trang guest/project preview.
- `v2/web/vite.config.ts` đặt base `/crew-v2/` và nhận API origin loopback qua `CREW_V2_WEB_API_ORIGIN` cho chế độ dev.
- `v2/web/e2e/support/fixture.ts` khai báo `withFixture`, resource và cleanup. Coordinator đã qua test lifecycle PostgreSQL/API, active request shutdown và SIGTERM child thật (5/5); lượt MCP cuối đã kiểm shell guest, UI không đổi trong FIX1.
- `v2/web/scripts/e2e-fixture.ts --preview` giữ cùng fixture vật lý trong process cho browser MCP và nhận lệnh `close` sau khi tab đã đóng. Origin, nonce và registry không chứa credential được in trước khi điều hướng.

## Các bước

1. Browser mở `/crew-v2/`; router mount `Shell` với sidebar, toolbar và outlet. Guest thấy nhãn “Bản minh họa”; chưa có danh sách dự án từ API.
2. Panel dùng cả biểu tượng và chữ cho loading, error, empty. Skip link, landmark, focus-visible và reduced-motion hỗ trợ bàn phím; CSS chia layout desktop/tablet/mobile.
3. Dev Vite chỉ proxy `/v2` khi caller cấp `CREW_V2_WEB_API_ORIGIN`; build production dự kiến dùng cùng origin. Khung Task1 không gọi API hay import app/schema/role runtime v1.
4. Coordinator web giữ một owner cho container PostgreSQL18.6, logical DB, Fastify và Vite trên một web listener. Nó chụp migration 001–011 một lần, bootstrap owner trong DB riêng, rồi kiểm HTTP session thực. Cleanup hủy socket thuộc run, đặt deadline từng pha và xác minh exact identity trước stop/drop; trường hợp UNKNOWN giữ registry và tài nguyên để PM đối chiếu. MCP đã kiểm shell guest trên source UI này; literal zoom 200% còn giới hạn chứng cứ nêu dưới đây.

## Files

| File | Vai trò |
|---|---|
| `v2/web/package.json`, `v2/web/pnpm-lock.yaml`, `v2/web/tsconfig.json` | Package, lock độc lập, typecheck strict; lock được pnpm sinh riêng trong `v2/web` |
| `v2/web/vite.config.ts`, `v2/web/index.html`, `v2/web/playwright.config.ts` | Base/proxy, HTML entry và browser runner một worker |
| `v2/web/src/main.tsx`, `v2/web/src/router.tsx`, `v2/web/src/shell.tsx`, `v2/web/src/styles.css` | Mount, route, shell và giao diện responsive |
| `v2/web/test/workspace.test.ts`, `v2/web/test/fixture-lifecycle.test.ts` | Ranh giới workspace và lifecycle; RED lịch sử và GREEN PostgreSQL/API/SIGTERM thật đã ghi trong báo cáo |
| `v2/web/scripts/e2e-fixture.ts`, `v2/web/e2e/support/fixture.ts` | Coordinator/handle fixture đã qua test lifecycle, typecheck và build thực |

## Dữ liệu

Task 1 chưa đọc project/ticket/Assistant thật. `QueryClient` có một instance cho mỗi lần mount browser app; dữ liệu nhạy cảm không vào module-global state. Fixture chỉ xuất origin và resource identity không bí mật; owner password, cookie và token chỉ ở memory của run, không đưa vào screenshot/report/registry.

## Flow liên quan

`v2/docs/flows/server-platform.md` định nghĩa migration và DB v2; `v2/docs/flows/server-identity.md` định nghĩa bootstrap/login owner. Các trang nghiệp vụ Phase07 Task2–8 sẽ dùng shell này sau khi producer gate tương ứng mở.

## Tests

Workspace RED đầu tiên exit 1 bằng assertion thiếu `package.json`, sau scaffold workspace 1/1 PASS. Lifecycle RED trên deny scaffold có 3 assertion thất bại đúng hành vi thiếu callback/identity/STOP. Preview SIGTERM child từng RED thực: tài nguyên cleanup nhưng process không tự exit; đã GREEN. Review FIX1 phát hiện request gửi dở có thể giữ `close()` chờ vô hạn; test HTTP thật RED với `ACTIVE_REQUEST_CLOSE_DEADLINE`, sau sửa hủy socket thuộc fixture và deadline cleanup thì GREEN. Lượt final sau format đạt lifecycle 5/5 trên PostgreSQL18.6/API/web listener thật: POST login, GET session trực tiếp và qua proxy `/v2`, close lặp, active request, SIGTERM child exit0/cleanup; hai case UNKNOWN là unit policy. Scoped Biome và strict typecheck sau FIX1 exit0; web build 150 modules và workspace 1/1 thuộc freeze UI trước FIX1, vì FIX1 chỉ đổi harness/test. Exact container ID, image digest, DB, cổng, process, scratch và STOP độc lập, cùng raw logs có hash của FIX1, được ghi trong báo cáo Phase07. Preview Playwright MCP cuối trên source UI đã xác nhận Enter skip link chuyển focus vào `MAIN#main-content`, error console 0, viewport thật 1280/390/640 px đều không tràn. Viewport 640px là kiểm tra bố cục tương đương; literal browser zoom 200% chưa đo được vì shortcut không đổi zoom metrics. Fixture preview đã đóng và exact resource biến mất. FIX2 bổ sung guard sau stat để không khởi chạy rm sau REMOVE timeout; focused unit RED/GREEN và scoped Biome đã có. Full lifecycle6 và strict typecheck trên freeze FIX2 chưa chạy do resource gate, independent scoped FIX2 review chưa hoàn tất. Đây là checkpoint source, chưa nghiệm thu đầy đủ Task1; các trang nghiệp vụ Task2–8 nằm ngoài nghiệm thu shell này.
