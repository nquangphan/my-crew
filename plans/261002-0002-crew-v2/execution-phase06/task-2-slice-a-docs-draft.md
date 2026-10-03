# Dự thảo bổ sung flow server-assistant — Phase06/T2 Slice A

Chỉ áp dụng sau independent review và PM tích hợp source/manifest. T1 persistence đã được giữ nguyên. Factory `registerAssistantRoutes` thêm owner GET/PUT `/v2/assistant/config`; chưa được nối vào app production trong slice này.

Owner đăng nhập dùng cookie, Origin, CSRF và Idempotency-Key để chọn machine còn hiệu lực, policy strict và preferred:null. Mutation recheck credential/machine trong transaction trước cached response, kiểm expectedRevision cho mutation mới, lưu một designation hiện hành và revision config. Replay không tạo designation mới. Cập nhật policy cùng máy giữ designation identity. Đổi máy khi không có lượt sống retire designation cũ; nếu còn reserved/running/uncertain/finalizing turn thì trả409 và giữ authority cho tới producer đối chiếu dừng thực tế. Calibration đang active giữ cấu hình. Config không tạo grant, read session, lượt model hoặc quyền execution.

Internal `createPersistedAssistantActorResolver` kiểm persisted scope/fence và expiry bằng clock_timestamp; hiện vẫn trả ASSISTANT_ADMISSION_NOT_CONFIGURED khi identity current. Đây là seam mặc định từ chối cho T3, chưa phải implementation admission hoặc orchestration. Không dùng receipt UNVERIFIED của fixture làm quyền production.

Files thêm: server/src/assistant/authority.ts; server/src/assistant/routes.ts; server/test/assistant-authority.test.ts. Sáu test PostgreSQL riêng kiểm owner/CSRF/machine denial, CAS race, replay/current session và revoked target, idle reassignment, live turn hold, scope/fence/default deny. Final affected6/6; scoped strict types với skipLibCheck external declarations và Biome đạt. Full server typecheck còn lỗi dependency extractor ngoài slice; full integration/model/native chưa được nghiệm thu. G1/G2/R1–R4 và positive input/docs/turn authority tiếp tục ở gate riêng.

## FIX1 — credential và machine identity

PUT chuẩn hóa machineId sau strict validation cho lock, kiểm target và so sánh designation. Journal tiếp tục hash request body gốc: cùng máy khác casing với cùng key là payload khác và trả409. Cập nhật policy cùng máy chữ hoa không retire designation hoặc làm đổi live turn.

Sau khi lấy authority locks, route khóa đúng owner session bằng FOR SHARE rồi dùng statement riêng kiểm revoked_at và expiry qua clock_timestamp(). Khóa giữ tới transaction commit, áp dụng cả fresh mutation lẫn cached replay. Thu hồi hoàn tất trước điểm này trả401; thu hồi đến sau chờ transaction xong. Origin/CSRF/preflight và default-deny admission giữ nguyên. Conditional live-turn prelock đứng trước session lock; work dùng lại locks. Final affected19/19, scoped strict(skipLibCheck external) và Biome đạt. FIX1 chờ independent review; không mở rộng acceptance toàn T2.
