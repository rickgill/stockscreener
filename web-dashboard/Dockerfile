FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY public ./public
COPY server.js ./

RUN node -e "require('node:sqlite')"

ENV NODE_ENV=production
ENV DATA_DIR=/data

EXPOSE 8080

CMD ["node", "server.js"]
