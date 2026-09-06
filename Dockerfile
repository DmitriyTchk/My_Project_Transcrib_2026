# ---------- Stage 1: сборка приложения ----------
FROM node:20-bookworm AS build
WORKDIR /app

# Сначала только манифесты — для эффективного кэширования слоёв.
# package-lock.json может отсутствовать в репозитории — тогда ставим по package.json.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Копируем исходники и собираем (vite build + esbuild server.ts -> server.js)
COPY . .
RUN npm run build

# ---------- Stage 2: production-образ ----------
FROM node:20-bookworm-slim

# ffmpeg нужен server.ts для нормализации аудио (/usr/bin/ffmpeg)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Только production-зависимости
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Собранный фронтенд и серверный бандл из stage 1
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js

EXPOSE 3000
CMD ["node", "server.js"]
