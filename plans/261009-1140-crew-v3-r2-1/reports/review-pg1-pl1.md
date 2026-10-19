# Review độc lập PG-1 + PL-1 (trước DP-1)

- Thời điểm: 09/10/2026 12:39 (Asia/Ho_Chi_Minh). Reviewer: code-reviewer (opus), chỉ đọc.
- PG-1 `14ca93292` (6 file, chỉ `packages/crew-plugin/**`). PL-1 `295e62635` (5 file, chỉ `server/src/crew/**` + 2 test `crew-project-roles*`).
- Đã đọc: plan.md (Global Constraints, Review Focus 3, I7), fork.md Task 1/3, sdd-ledger.md; diff hai commit; host `server/src/routes/plugins.ts` (dispatch route plugin, l.607–650, 1840–1935), `server/src/routes/authz.ts` (`assertBoard`, `assertCompanyAccess`), `server/src/services/issues.ts` (`create` l.9742, kế thừa project l.9295, 9905–9921).
- Kiểm chạy lại: `node crew/release/check-core-hooks.mjs` → "Hook một dòng: 5/5; lỗi: 0". `git diff --name-only 4dca97106..295e62635` chỉ gồm file trong phạm vi được phép. Không chạy lại test (log trong ledger khớp với code và test đọc được; không có lý do nghi). Không khởi Postgres nhúng.

## Kết luận

**Không blocker. Không major.** Có thể deploy (DP-1). 7 minor + 1 ghi chú ngoài phạm vi, nên xử lý ở ticket sau hoặc RV-1.

## Trả lời 6 câu hỏi

1. **H2/H4 có đường lách không.**
   - Agent tự ghi vai trò: không. Host `assertScopedApiAuth` gọi `assertBoard` (actor `agent` → 403) trước khi gọi worker; `handleRolesApi` chặn lại lần nữa (`actorType !== "user"` → 403). Agent không có quyền ghi namespace plugin. Đường duy nhất là agent cầm board API key (xem ghi chú N1, ngoài phạm vi commit này).
   - Agent giao việc cho reviewer/integrator: H2 (`issue-gate.ts:185–197`) và H4 (`issue-create-policy.ts:73–76`) dùng tập reviewer/integrator cả company, so chữ thường. Ngoại lệ `workflowHandoff` giữ nguyên như trước.
   - Issue con khác project với cha: H4 dùng `data.projectId` nếu có, nên con ghi rõ project sẽ nhận vai trò của project đó. Policy đã ghim lúc tạo; H2 chỉ dùng `roles` để kiểm `roles_unconfigured` và luật giao việc. Việc duyệt stage so với participant đã ghim trên issue, không so với `roles`, nên đổi project của con cũng không lách được bước duyệt. Có một ca lệch nhỏ với lõi (m2).
   - Issue không project: `loadCrewRoles` trả config file, đúng I7.
2. **Lỗi đọc bảng.** Mọi câu đọc chạy trong `db.transaction` (savepoint khi đang ở `tx` của H2), có `to_regclass` chặn trước, và lỗi chỉ rollback savepoint. Test "bảng hỏng" cùng thử đột biến bỏ savepoint (ledger) chứng minh điều này. Lỗi đọc thì rơi về vai trò file. Đường này không mở cửa: approval vẫn phải khớp participant đã ghim. Nó chỉ làm yếu nhánh fail closed của dòng stale, và ở H4 có thể ghim sai reviewer (m1).
3. **Route vai trò.** `auth: "board"`, host kiểm `assertCompanyAccess` theo `companyId` query/body (viewer bị chặn ghi, user không là thành viên company bị 403). Plugin kiểm lại `body.companyId === input.companyId`, project và mọi agent thuộc company. GET/DELETE lọc `WHERE company_id = $1`. SQL đều có tham số; tên bảng ghép từ namespace đã kiểm; mảng uuid đã validate trước khi tạo literal. Chưa thấy lỗi phân quyền. Các điểm còn thiếu: không kiểm `terminated` khi ghi (m4), không có audit (m5), lộ thông báo lỗi DB (m7).
4. **Hai việc ngoài plan.**
   - Con không project lấy project của cha: đúng hướng, vì lõi cũng kế thừa project từ cha (`issues.ts:9919–9921`). Nhưng lõi kế thừa theo `inheritExecutionWorkspaceFromIssueId ?? parentId` và bỏ qua khi `skipExecutionWorkspaceInheritance`, còn H4 luôn theo `parentId` (m2).
   - Tập reviewer/integrator cả company ở H4: đúng, và khớp với H2 mà fork.md đã chốt. Nếu không có tập này, executor của P1 có thể giao việc cho integrator I2 (người có quyền push repo P2). Có chặn nhầm khi một agent vừa là executor ở project này vừa là reviewer/integrator ở project khác, hoặc khi dòng của project đã xóa vẫn còn trong bảng (m3).
5. **Project chưa có dòng (repo-a).** Gate cho kết quả giống hệt trước: test so 10 ca chính trong bốn trạng thái (không project, P1 trước khi có bảng, bảng hỏng, sau migrate), và các suite cũ đều pass. Có một thay đổi có chủ ý: một khi company có bất kỳ dòng nào, agent trong repo-a không giao việc được cho R2/I2 của project khác. So sánh id cũng chuyển sang không phân biệt hoa thường, tức chặt hơn.
6. **Hook lõi.** Vẫn 5/5. Không file nào ngoài `server/src/crew/**`, `server/src/__tests__/crew-*` và `packages/crew-plugin/**` bị đổi. Migration `0001`–`0003` giữ nguyên.

## Finding

### Blocker
Không có.

### Major
Không có.

### Minor

**m1. H4 lỗi đọc bảng thì ghim vĩnh viễn reviewer/integrator của file cho issue thuộc project có dòng vai trò.**
`server/src/crew/project-roles.ts:82–89`, được gọi từ `issue-create-policy.ts:142`.
Kịch bản: P2 có dòng (R2/I2). Board tạo issue gốc trong P2 đúng lúc đọc bảng lỗi (lock timeout khi plugin đang migrate/upgrade, mất quyền schema sau restore, v.v.). `loadCrewRoles` trả vai trò file R1/I1 và `buildCrewPolicy` ghim R1/I1 vào `executionPolicy`. R1/I1 không có checkout của repo P2, nên issue kẹt cho tới khi board sửa policy. Dấu vết duy nhất là một dòng `logger.warn`, và mỗi phút mỗi company chỉ ghi một lần. Đường này không lách được duyệt, nhưng đi ngược tinh thần "không rơi về vai trò file vì đó là reviewer của project khác" mà chính PL-1 áp cho dòng stale.
Đề xuất: ở H4, nếu `to_regclass` có bảng mà câu đọc lỗi, ném `unprocessable`/503 (`crew_roles_unavailable`) để bên gọi thử lại. Chỉ rơi về file khi bảng chưa có hoặc project không có dòng. H2 có thể giữ fallback, vì H2 không ghim gì. Việc này đổi quyết định đã ghi trong I7 nên cần owner chọn.

**m2. Project mà H4 suy ra cho issue con không khớp project lõi gán khi có `inheritExecutionWorkspaceFromIssueId`.**
`server/src/crew/issue-create-policy.ts:112–120, 141` so với `server/src/services/issues.ts:9905–9921`.
Kịch bản: agent tạo con với `parentId = A` (project P1, không có dòng), không ghi `projectId`, và `inheritExecutionWorkspaceFromIssueId = X` (project P2; HEARTBEAT của lõi gợi ý cờ này). Lõi đặt `child.projectId = P2`, còn H4 lấy P1 nên ghim R1/I1. Nếu dòng P2 đang stale, đường này còn tránh được `422 crew_roles_unconfigured` lẽ ra phải có. Lúc `done` vẫn bị H2 chặn vì H2 đọc theo `locked.projectId = P2`, nên chỉ hỏng định tuyến, không lách gate. Một ca phụ: cha tạo trong cùng transaction chưa commit thì H4 (đọc bằng `db`, không phải `dbOrTx`) không thấy cha và rơi về vai trò file.
Đề xuất: suy project giống lõi, tức `data.projectId ?? (skipExecutionWorkspaceInheritance ? null : projectOf(inheritExecutionWorkspaceFromIssueId ?? parentId))`. Thêm hai field này vào `IssueCreateFields` (chỉ sửa trong `server/src/crew`). Thêm test DB cho con khác project với cha và con dùng `inheritExecutionWorkspaceFromIssueId`.

**m3. Luật giao việc theo cả company có thể chặn nhầm vì PG-1 không cấm một agent giữ vai trò ở nhiều project, và không dọn dòng của project đã xóa.**
`server/src/crew/project-roles.ts:110–137`; `packages/crew-plugin/src/roles/api.ts:32–33` (kiểm trùng chỉ trong một dòng).
Kịch bản: owner đặt agent E làm executor của P2 và reviewer của P3, điều mà route cho phép. Sau đó mọi agent (kể cả assistant P2) giao việc cho E đều bị `422 crew_role_assignee`, cả ở H2 lẫn H4. Tương tự, project P3 bị xóa nhưng dòng vẫn còn (bảng không có FK), nên reviewer cũ của P3 bị chặn nhận việc vĩnh viễn trong company.
Đề xuất: ở `roles.set`, từ chối nếu reviewer/integrator mới đang là assistant/executor ở dòng khác của company, hoặc ngược lại (400 kèm tên project). Ở `loadCompanyRoleAgentIds`, `JOIN projects` để bỏ dòng của project đã xóa hoặc archive. PJ-1 gỡ project thì gọi `DELETE …/roles`, như plan đã ghi.

**m4. `roles.set` chấp nhận agent đã `terminated`.**
`packages/crew-plugin/src/roles/data.ts:62–70`.
Kịch bản: board ghi reviewer là một agent đã terminated. Route trả 200, nhưng ngay sau đó `loadCrewRoles` trả `invalid` và cả project bị fail closed (agent không tạo con được, issue gốc mới không có policy). Owner chỉ thấy 422 ở phía agent.
Đề xuất: thêm `AND status <> 'terminated'` vào `agentsOutsideCompany` (hoặc trả lỗi riêng "agent … đã terminated"), cùng một ca test.

**m5. Đổi vai trò gate không để lại audit.**
`packages/crew-plugin/src/roles/api.ts:68`, `data.ts:41–54`.
Bảng chỉ giữ `updated_by_user_id` của lần ghi cuối, và DELETE không để lại dấu vết. Đổi reviewer/integrator là thay đổi cấu hình bảo mật của gate.
Đề xuất: ghi activity (hoặc log có cấu trúc) với giá trị cũ, giá trị mới và `userId` cho cả set lẫn delete.

**m6. Hai ca test H2 không chứng minh việc đọc theo project.**
`server/src/__tests__/crew-project-roles.db.test.ts:235–261`.
Ca "executor P2 done sớm 422" và ca "R1 duyệt issue P2 bị từ chối" vẫn pass nếu bỏ PL-1, vì H2 so participant đã ghim trên policy. Ở H2, chỉ ca stale (l.284–333) phụ thuộc thật vào `loadCrewRoles`.
Đề xuất: giữ hai ca này (chúng mô tả đúng hành vi) nhưng sửa tên hoặc chú thích cho đúng. Nếu muốn kiểm đúng việc đọc theo project ở H2, thêm ca "dòng hợp lệ ở P2, file `invalid`": theo code hiện tại `loadCrewRoles` trả `invalid` ngay, nên ca này đồng thời ghi lại hành vi đó.

**m7. Lỗi DB trong worker lộ nguyên thông báo ra client.**
Không phải dòng mới. Host `plugins.ts:1920–1935` trả `{ error: err.message }` với mã 502, mà `handleRolesApi` không bọc try/catch. Thông báo SQL (tên schema/bảng) đi tới board user. Chỉ board thấy, nên rủi ro thấp.
Đề xuất: bọc `handleRolesApi` và trả `500 { error: "Không đọc/ghi được vai trò project" }`, ghi chi tiết vào `ctx.logger`.

### Ghi chú ngoài phạm vi

**N1. Board API key trên Mac và agent cùng user macOS.** Liên quan AP-4/PJ-1, không phải hai commit này. Key board nằm trong Keychain service `crew-mac-paperclip`, và `claude` của agent chạy dưới cùng user qua sshd. Nếu item tạo bằng `security add-generic-password` mà không giới hạn `-T`, agent gọi được `security find-generic-password -w` mà không có hộp thoại. Với key đó, agent tự `POST …/roles` đặt mình làm reviewer, hoặc ép `done` bằng board override. Route vai trò không làm rủi ro này rộng thêm, vì board override vốn đã có. AP-4 cần kiểm ACL của item Keychain: chỉ app ký mới đọc được, không có `/usr/bin/security` trong danh sách tin cậy.

## Điểm đã kiểm và ổn (để hiệu chỉnh rủi ro)

- Savepoint là cần thiết và đặt đúng chỗ (ledger có thử đột biến). Lỗi kết nối thật làm hỏng cả transaction, nên lệnh ghi thất bại (fail closed), không mở cửa.
- Dòng stale (agent xóa, chuyển company, `terminated`) → `invalid`. Kết quả: board tạo gốc không có policy, H2 chặn `roles_unconfigured` + `policy_missing`, board override vẫn được và có activity. Không có đường `done` sai.
- `to_regclass(text)` cùng tên bảng hằng; `sql.raw` chỉ nhận chuỗi suy từ `derivePluginDatabaseNamespace("crew.core")`, không có input người dùng.
- H2 chỉ đọc `loadCompanyRoleAgentIds` khi agent đổi assignee, và `loadCrewRoles` chỉ chạy khi patch có khóa gate, nên số câu SQL thêm trên đường nóng có giới hạn (savepoint + 2 câu).

## Đề xuất hành động

1. Deploy DP-1 được: không có finding nào chặn.
2. Owner chọn m1 (giữ fallback file theo I7 hay fail closed ở H4 khi đọc lỗi).
3. m2, m3, m4 gom vào một ticket nhỏ của gói `policy`/`plugin` trước PJ-1, vì PJ-1 là bên tạo nhiều dòng vai trò.
4. m5, m6, m7 để RV-1.
5. N1 chuyển cho AP-4.
