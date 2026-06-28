FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY public ./public
COPY server ./server

CMD ["node", "server/grafana-dashboard-builder.js"]
