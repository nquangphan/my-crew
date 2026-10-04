# Evidence protocol FIX1 — 2026-10-02

Đã đọc primary references trước triển khai R4/R5, đối chiếu lại function-call variant trước final freeze.

- [WHATWG SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation): UTF-8/BOM, LF/CRLF/bare CR, blank-line dispatch; data bỏ một space ban đầu. Parser giữ raw byte bound trước normalization, không chấp nhận EOF thiếu terminator.
- [Responses events](https://developers.openai.com/api/reference/resources/responses/streaming-events): lifecycle, output item/index, function argument delta/done, text/content part delta/done, annotation nullable, sequence; failed/incomplete/error không phải success. Implementation chỉ hỗ trợ subset text/function dùng trong probe, kiểm fragments với output cuối và từ chối modality chưa hỗ trợ.
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling#streaming): ví dụ response_id liên kết function item và argument fragments; function item có thể thiếu status. Regression compat RED rồi GREEN chứng minh biến thể này mà vẫn reject foreign response_id.
- [Chat streaming](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events): choices/delta/index/finish_reason. Không mở rộng Chat semantics trong batch; chỉ sửa framing chung, giữ correlated tools/terminal hiện có.

Đây là fixture/protocol evidence, không là live-provider interoperability PASS, paid call, tools execution certification hay dispatch authority.
