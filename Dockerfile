FROM denoland/deno:bin AS deno-bin

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=deno-bin /deno /usr/local/bin/deno

COPY package.json package-lock.json ./
RUN npm ci
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
