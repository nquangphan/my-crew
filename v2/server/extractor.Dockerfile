ARG TARGETPLATFORM
FROM --platform=$TARGETPLATFORM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
WORKDIR /extractor
COPY package.json pnpm-lock.yaml ./
RUN npm install --global --prefix /opt/pnpm --ignore-scripts --no-audit --no-fund pnpm@10.32.1
RUN /opt/pnpm/bin/pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --chown=65532:65532 src/attachments ./src/attachments
RUN node -e "const c=require('@napi-rs/canvas');const b=c.createCanvas(1,1).toBuffer('image/png');if(b.length===0)process.exit(1)"
USER 65532:65532
ENTRYPOINT ["node","--max-old-space-size=384","src/attachments/worker-entry.ts"]
