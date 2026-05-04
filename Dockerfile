FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY public ./public
COPY server.js ./

ENV NODE_ENV=production
ENV DATA_DIR=/data

EXPOSE 8080

CMD ["node", "server.js"]
