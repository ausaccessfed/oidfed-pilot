FROM caddy:2-alpine AS caddy

FROM node:22-alpine

WORKDIR /app

COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .
RUN mkdir -p /app/.keys /data && chown -R node:node /app/.keys /data

ENV NODE_ENV=production
ENV XDG_DATA_HOME=/data

USER node
EXPOSE 8443

CMD ["node", "scripts/container.js"]
