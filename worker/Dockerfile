FROM node:22-bookworm-slim

# The VPS is shared with the original client's system: every container and image the NextRotta
# creates carries this label, and the VPS agent only lets the owner act on what has it.
LABEL com.nextrotta.owner=nextrotta

WORKDIR /app

# The jobs compute "today" / "start of month" with local Date getters, so the process must run on
# Brasília time — on UTC the 23:00 BRT hours run already sees tomorrow (confirmed live: on
# 2026-10-05 it swept through "2026-10-06", and the last day of each month was never imported).
# Node's bundled ICU resolves this without the tzdata package.
ENV TZ=America/Sao_Paulo

# node_modules lives at /app so both /app/lib (shared with the Next.js app) and /app/worker can
# resolve dependencies via Node's normal upward node_modules lookup.
COPY worker/package.json ./package.json
RUN npm install

COPY lib ./lib
COPY worker ./worker

# Real Chromium binary for playwright-core's local-dev path (see lib/porto-integration/browser.ts)
# — the VPS isn't a serverless runtime, so @sparticuz/chromium's binary is never used here.
RUN npx playwright install --with-deps chromium

# Compiled with the real TypeScript compiler, not run live through tsx/esbuild — confirmed live
# that esbuild's transform injects a `__name(...)` helper call into functions that
# frame.evaluate()/page.evaluate() then ship into the browser as raw source text via .toString(),
# where that helper doesn't exist ("ReferenceError: __name is not defined"). tsc doesn't do this.
RUN npx tsc -p worker/tsconfig.json

CMD ["node", "dist/worker/index.js"]
