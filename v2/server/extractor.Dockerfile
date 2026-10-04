ARG TARGETPLATFORM
FROM --platform=$TARGETPLATFORM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
WORKDIR /extractor
COPY package.json pnpm-lock.yaml ./
RUN npm install --global --prefix /opt/pnpm --ignore-scripts --no-audit --no-fund pnpm@10.32.1
RUN /opt/pnpm/bin/pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --chown=65532:65532 src/attachments/worker-entry.ts src/attachments/worker-diagnostic.ts src/attachments/worker-protocol.ts src/attachments/storage.ts ./src/attachments/
COPY --chown=65532:65532 src/attachments/extract/csv.ts src/attachments/extract/docx.ts src/attachments/extract/formats.ts src/attachments/extract/image.ts src/attachments/extract/index.ts src/attachments/extract/pdf.ts src/attachments/extract/text.ts src/attachments/extract/verify.ts src/attachments/extract/xlsx.ts src/attachments/extract/xml.ts src/attachments/extract/yauzl.d.ts src/attachments/extract/zip.ts ./src/attachments/extract/
RUN node -e "const c=require('@napi-rs/canvas');const b=c.createCanvas(1,1).toBuffer('image/png');if(b.length===0)process.exit(1)"
USER 65532:65532
ENTRYPOINT ["node","--max-old-space-size=384","src/attachments/worker-entry.ts"]
