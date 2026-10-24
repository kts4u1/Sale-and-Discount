# 세일레이더 - 화면 빌드 후 서버 하나로 실행
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
RUN npm prune --omit=dev
EXPOSE 8787
VOLUME ["/app/server/data"]
CMD ["npm", "start"]
