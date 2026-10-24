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
# 참가격 스냅샷·원자료도 데이터 볼륨에 보관 (컨테이너를 다시 만들어도 유지)
ENV KCA_DATA_DIR=/app/server/data/kca KCA_RAW_DIR=/app/server/data/.kca-raw
COPY --from=build /app /app
RUN npm prune --omit=dev
EXPOSE 8787
VOLUME ["/app/server/data"]
CMD ["npm", "start"]
