import { serverApi } from './data/server-api.ts';
import { staticApi } from './data/static-api.ts';

export { ApiError, type SearchParams } from './data/server-api.ts';

/**
 * static: GitHub Pages 처럼 서버 없이 미리 만든 파일(data/)만 쓰는 빌드 (`npm run build:static`)
 * 그 밖: API 서버(`npm start`, `npm run dev`)를 쓴다
 */
export const STATIC_MODE = import.meta.env.MODE === 'static';

export const api: typeof serverApi = STATIC_MODE ? staticApi : serverApi;
