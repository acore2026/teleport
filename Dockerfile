FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine AS prod-deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache nginx

ENV NODE_ENV=production \
    HOST=127.0.0.1 \
    NODE_PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY package*.json ./
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
    && mkdir -p /run/nginx /app/data/uploads /app/data/tmp

VOLUME ["/app/data"]
EXPOSE 7777

ENTRYPOINT ["/entrypoint.sh"]
