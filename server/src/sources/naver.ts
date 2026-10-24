import type { NewsItem } from '@sale-radar/shared';
import type { AppConfigEnv } from '../config.ts';
import { TtlCache } from '../lib/cache.ts';
import { fetchJson } from '../lib/http.ts';
import { safeHttpUrl } from '../lib/url.ts';

interface NaverBlogResponse {
  items: { title: string; link: string; description: string; bloggername: string; postdate: string }[];
}

const decodeEntities = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/**
 * 네이버 검색 API(블로그). 매장 이름 + "할인/이벤트" 로 최근 후기·행사 소식을 찾는다.
 * https://developers.naver.com/docs/serviceapi/search/blog/blog.md
 */
export class NaverSource {
  private cache = new TtlCache<NewsItem[]>(3 * 3_600_000, 500);

  constructor(private readonly config: AppConfigEnv) {}

  get enabled(): boolean {
    return Boolean(this.config.naverClientId && this.config.naverClientSecret);
  }

  async blog(query: string, display = 6): Promise<NewsItem[]> {
    return this.cache.getOrLoad(`${query}|${display}`, async () => {
      const qs = new URLSearchParams({ query, display: String(display), sort: 'date' });
      const res = await fetchJson<NaverBlogResponse>(`https://openapi.naver.com/v1/search/blog.json?${qs}`, {
        headers: {
          'X-Naver-Client-Id': this.config.naverClientId!,
          'X-Naver-Client-Secret': this.config.naverClientSecret!,
        },
        timeoutMs: 6000,
      });
      return res.items
        .filter((i) => safeHttpUrl(i.link))
        .map((i) => ({
          title: decodeEntities(i.title),
          link: safeHttpUrl(i.link)!,
          description: decodeEntities(i.description),
          author: i.bloggername,
          date: i.postdate
            ? `${i.postdate.slice(0, 4)}-${i.postdate.slice(4, 6)}-${i.postdate.slice(6, 8)}`
            : undefined,
        }));
    });
  }
}
