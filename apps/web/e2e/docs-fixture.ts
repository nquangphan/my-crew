/**
 * The docs snapshot the E2E runs sync for project SHOP through the real daemon endpoint. It follows the
 * docs standard (index, architecture, one page per flow, files lookup, AGENTS.md, flows.yaml) and has a wide
 * table and a long code block, to prove they scroll inside their own box.
 */
export const DOCS_COMMIT = '7b02d1f4c9e8a7b6c5d4e3f2a1b0c9d8e7f6a5b4';

const FLOWS: { id: string; title: string; entry: string; files: string[]; test: string }[] = [
  {
    id: 'auth',
    title: 'Auth & session',
    entry: 'services/auth/src/auth-routes.ts',
    files: ['services/auth/src/session-service.ts'],
    test: 'services/auth/test/session.test.ts',
  },
  {
    id: 'order-checkout',
    title: 'Đặt hàng',
    entry: 'services/order/src/order-routes.ts',
    files: ['services/order/src/checkout-service.ts'],
    test: 'services/order/test/checkout.test.ts',
  },
  {
    id: 'payments',
    title: 'Thanh toán',
    entry: 'services/payment/src/payment-routes.ts',
    files: ['services/payment/src/payment-service.ts', 'services/payment/src/webhook-handler.ts'],
    test: 'services/payment/test/webhook.test.ts',
  },
  {
    id: 'refunds',
    title: 'Hoàn tiền',
    entry: 'services/payment/src/refund-routes.ts',
    files: ['services/payment/src/refund-service.ts'],
    test: 'services/payment/test/refund.test.ts',
  },
  {
    id: 'webhook',
    title: 'Webhook',
    entry: 'services/webhook/src/webhook-routes.ts',
    files: ['services/webhook/src/dispatcher.ts'],
    test: 'services/webhook/test/dispatcher.test.ts',
  },
  {
    id: 'health-check',
    title: 'Health check',
    entry: 'services/api/src/health-routes.ts',
    files: ['services/api/src/db-probe.ts'],
    test: 'services/api/test/health.test.ts',
  },
];

const flowsYaml = [
  'version: 1',
  'source:',
  '  include: ["services/**"]',
  '  exclude: []',
  'flows:',
  ...FLOWS.flatMap((flow) => [
    `  ${flow.id}:`,
    `    title: "${flow.title}"`,
    `    doc: docs/flows/${flow.id}.md`,
    `    entrypoints: [${flow.entry}]`,
    `    files: [${flow.files.join(', ')}]`,
    `    tests: [${flow.test}]`,
  ]),
  'shared:',
  '  services/shared/src/db.ts: [payments, refunds, health-check]',
  'unassigned:',
  '  - path: services/legacy/src/old-cart.ts',
  '    reason: Giỏ hàng cũ, sẽ xóa sau khi chuyển xong',
  '',
].join('\n');

const payments = `# Thanh toán

## Mục đích

Tạo payment intent cho đơn hàng, nhận webhook từ cổng thanh toán, cập nhật trạng thái đơn và phát sự kiện cho order-service.

## Điểm vào

\`POST /payments/intents\`, \`POST /payments/webhook\`

## Các bước

1. \`payment-routes.ts\` nhận request, kiểm tra quyền.
2. \`payment-service.ts#createIntent\` gọi cổng thanh toán, lưu bản ghi.
3. \`webhook-handler.ts#verify\` xác thực chữ ký, cập nhật trạng thái.
4. Xem thêm [Hoàn tiền](refunds.md) và [Kiến trúc](../architecture.md).

### Lỗi thường gặp

Chữ ký webhook sai trả về 401.

## Tests

\`services/payment/test/webhook.test.ts\`
`;

const flowDoc = (flow: (typeof FLOWS)[number]) =>
  flow.id === 'payments'
    ? payments
    : `# ${flow.title}\n\n## Mục đích\n\nFlow ${flow.title}.\n\n## Các bước\n\n1. \`${flow.entry}\` nhận request.\n`;

const longLine = `curl -sS -X POST https://api.shop.example/payments/intents -H 'content-type: application/json' -d '{"orderId":"ord_01J8ZQ3W6M4V2T9K7XH5RB0CDE","amount":1250000,"currency":"VND","returnUrl":"https://shop.example/checkout/return?session=very-long-session-identifier-for-testing"}'`;

const wideRow = (flow: (typeof FLOWS)[number]) =>
  `| \`${flow.entry}\` | ${flow.title} | \`${flow.id}\` | ${flow.files.map((f) => `\`${f}\``).join(', ')} | \`${flow.test}\` |`;

export const DOCS_FILES: { path: string; content: string }[] = [
  {
    path: 'docs/index.md',
    content: `# Shop API

API bán hàng: đơn hàng, thanh toán, hoàn tiền.

## Bắt đầu

Đọc [Kiến trúc](architecture.md) trước, rồi tới flow [Thanh toán](flows/payments.md). Tài liệu cổng thanh toán: [VNPay](https://sandbox.vnpayment.vn/apis/).

## Flow chính

- [Đặt hàng](flows/order-checkout.md)
- [Hoàn tiền](flows/refunds.md)
`,
  },
  {
    path: 'docs/architecture.md',
    content: `# Kiến trúc

## Tổng thể

Các service nói chuyện qua HTTP nội bộ; Postgres là nguồn dữ liệu chính.

## Gọi thử

\`\`\`sh
${longLine}
\`\`\`

## Triển khai

Mỗi service là một container.
`,
  },
  {
    path: 'docs/files.md',
    content: `# Tra cứu file

## Bảng file

| Đường dẫn | Flow | Flow id | File liên quan | Test |
| --- | --- | --- | --- | --- |
${FLOWS.map(wideRow).join('\n')}
`,
  },
  ...FLOWS.map((flow) => ({ path: `docs/flows/${flow.id}.md`, content: flowDoc(flow) })),
  { path: 'docs/flows.yaml', content: flowsYaml },
  {
    path: 'AGENTS.md',
    content: '# Hướng dẫn agent\n\nĐọc docs/index.md trước khi sửa code.\n',
  },
];
