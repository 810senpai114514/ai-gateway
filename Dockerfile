FROM denoland/deno:bin AS deno-bin

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY --from=deno-bin /deno /usr/local/bin/deno

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deno-bin /deno /usr/local/bin/deno

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY bin ./bin
COPY docs ./docs
COPY README.md README.zh-CN.md LICENSE ./

EXPOSE 3000

CMD ["npm", "start"]
