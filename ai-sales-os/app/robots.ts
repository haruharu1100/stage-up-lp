import type { MetadataRoute } from 'next';

/**
 * 検索エンジンに「1ページも見に来るな」と書いた紙を置く。
 * これは御願いなので、これだけでは守らない相手もいる。
 * だから next.config.js 側で応答そのものに noindex を付け、入口には鍵（Basic認証）を掛けている。
 * この3枚を重ねて、管理画面が検索に出ない状態にする。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
