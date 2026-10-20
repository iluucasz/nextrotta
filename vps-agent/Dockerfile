# NextRotta VPS agent (see server.mjs). No dependencies: plain Node.
FROM node:22-alpine
LABEL com.nextrotta.owner=nextrotta
WORKDIR /app
COPY server.mjs ./
ENV NODE_ENV=production TZ=America/Sao_Paulo
USER root
CMD ["node", "server.mjs"]
