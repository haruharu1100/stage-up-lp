import { hasSecret, secret } from '../env';
import type { CompanyInput } from './ingest';

/**
 * 法人データの取り出し口。
 *
 * ★どれも「読むだけ」。会社側に何かを送る処理はここに無い。
 * ★スクレイピングはしない。公式が出しているAPIだけを使う。
 * ★1つのサービスに依存しない。鍵が無いものは「未設定」として静かに飛ばし、
 *   使えるものだけで動かす（片方が止まっても営業が止まらないようにするため）。
 */

export type SourceCode = 'GBIZINFO' | 'HOUJIN_BANGOU' | 'OFFICIAL_SITE' | 'GOOGLE_PLACES' | 'CSV' | 'EXISTING_LIST';

export type SourceStatus = {
  code: SourceCode;
  /** 使う順番。小さいほど先。 */
  order: number;
  label: string;
  configured: boolean;
  readOnly: true;
  /** 何を設定すれば使えるようになるか。設定済みなら null。 */
  needs: string | null;
  note: string;
};

/**
 * 取得元の順番は「登記に近いものから」。
 *   ① gBizINFO … 国が法人番号にひも付けて公開している。会社HPも一緒に取れる。一番信用できる。
 *   ② 法人番号Web-API … 国税庁。商号と所在地だけだが、法人番号が確実に取れる。
 *   ③ 公式HP … その会社自身が書いた文章。①②で分かった法人番号・住所・電話と照合してから読む。
 *   ④ Google Places … 店舗系の電話・HP。法人番号にひも付いていないので、必ず③で確かめてから使う。
 */
export function sourceStatuses(): SourceStatus[] {
  return [
    {
      code: 'GBIZINFO',
      order: 1,
      label: 'gBizINFO（経済産業省）',
      configured: hasSecret('GBIZINFO_API_TOKEN'),
      readOnly: true,
      needs: hasSecret('GBIZINFO_API_TOKEN') ? null
        : 'gBizINFO でAPIトークンを申請し、.env に GBIZINFO_API_TOKEN を入れる（無料・申請から発行まで数日）',
      note: '法人番号にひも付いた従業員数・資本金・企業HPが取れる。国が公開しているHPなので、会社との結び付きを確認済みとして扱える。',
    },
    {
      code: 'HOUJIN_BANGOU',
      order: 2,
      label: '国税庁 法人番号システム Web-API',
      configured: hasSecret('HOUJIN_BANGOU_APP_ID'),
      readOnly: true,
      needs: hasSecret('HOUJIN_BANGOU_APP_ID') ? null
        : '国税庁のサイトでアプリケーションIDを申請し、.env に HOUJIN_BANGOU_APP_ID を入れる（無料）',
      note: '法人番号・商号・所在地が取れる。電話やメールは取れない。',
    },
    {
      code: 'OFFICIAL_SITE',
      order: 3,
      label: '会社の公式ホームページ（読むだけ）',
      configured: true,
      readOnly: true,
      needs: null,
      note: 'robots.txt を守り、トップと会社概要・お問い合わせの最大3ページだけを読む。フォーム送信はしない。読む前に「本当にその会社のHPか」を法人番号・社名・電話・住所で照合する。',
    },
    {
      code: 'GOOGLE_PLACES',
      order: 4,
      label: 'Google Places API',
      configured: hasSecret('GOOGLE_PLACES_API_KEY'),
      readOnly: true,
      needs: hasSecret('GOOGLE_PLACES_API_KEY') ? null
        : 'Google Cloud で Places API (New) を有効にし、.env に GOOGLE_PLACES_API_KEY を入れる（従量課金）',
      note: '店舗系の電話番号・HPが取れる。法人番号にひも付いていないので、HPは必ず中身を読んで照合してから採用する。取得データの保存は規約上30日まで。',
    },
    { code: 'CSV', order: 5, label: 'CSV取込', configured: true, readOnly: true, needs: null, note: '手元のリストをそのまま入れる。鍵は不要。' },
    {
      code: 'EXISTING_LIST',
      order: 6,
      label: '既存の営業リスト（data/sales_list.json）',
      configured: true,
      readOnly: true,
      needs: null,
      note: 'このワークスペースの scripts/build_data_json.py が作った既存リストを読み込む。',
    },
  ];
}

/** Google から取ったデータを持っておいてよい日数（規約上の上限）。これを過ぎたら取り直す。 */
export const GOOGLE_PLACES_CACHE_DAYS = 30;

export type FetchOutcome = {
  source: string;
  ok: boolean;
  reason: string;
  companies: CompanyInput[];
};

const UNSET: (source: string, label: string) => FetchOutcome = (source, label) => ({
  source,
  ok: false,
  reason: `${label}の鍵が未設定。設定するまでこの取得元は使わない。`,
  companies: [],
});

/**
 * 国税庁 法人番号システム Web-API から、商号での検索結果を取る（読み取りのみ）。
 * 返ってくるのは法人番号・商号・所在地まで。電話・メールは含まれない。
 */
export async function fetchFromHoujinBangou(opts: { name?: string; prefectureCode?: string; limit?: number }): Promise<FetchOutcome> {
  const appId = secret('HOUJIN_BANGOU_APP_ID');
  if (!appId) return UNSET('HOUJIN_BANGOU', '国税庁 法人番号Web-API');
  if (!opts.name && !opts.prefectureCode) {
    return { source: 'HOUJIN_BANGOU', ok: false, reason: '検索条件（商号か都道府県）が必要。', companies: [] };
  }

  const url = new URL('https://api.houjin-bangou.nta.go.jp/4/name');
  url.searchParams.set('id', appId);
  url.searchParams.set('type', '12'); // CSV / Unicode
  url.searchParams.set('mode', '2'); // 部分一致
  if (opts.name) url.searchParams.set('name', opts.name);
  if (opts.prefectureCode) url.searchParams.set('address', opts.prefectureCode);

  let text: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { source: 'HOUJIN_BANGOU', ok: false, reason: `APIが${res.status}を返した`, companies: [] };
    text = await res.text();
  } catch (e) {
    return { source: 'HOUJIN_BANGOU', ok: false, reason: `通信できなかった: ${(e as Error).message}`, companies: [] };
  }

  const companies: CompanyInput[] = [];
  const limit = opts.limit ?? 100;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    // 仕様上、1列目=通番、2列目=法人番号、7列目=商号、10〜13列目=所在地の各要素
    const corporateNumber = cols[1];
    const name = cols[6];
    if (!corporateNumber || !name) continue;
    const address = [cols[9], cols[10], cols[11], cols[12]].filter(Boolean).join('');
    companies.push({
      name,
      corporateNumber,
      address: address || null,
      source: 'HOUJIN_BANGOU',
      sourceUrl: 'https://www.houjin-bangou.nta.go.jp/webapi/',
    });
    if (companies.length >= limit) break;
  }
  return { source: 'HOUJIN_BANGOU', ok: true, reason: `${companies.length}件`, companies };
}

/** gBizINFO から法人情報を取る（読み取りのみ）。従業員数・資本金・企業HPが取れることがある。 */
export async function fetchFromGbizInfo(opts: { name?: string; corporateNumber?: string; limit?: number }): Promise<FetchOutcome> {
  const token = secret('GBIZINFO_API_TOKEN');
  if (!token) return UNSET('GBIZINFO', 'gBizINFO');

  const url = new URL('https://info.gbiz.go.jp/hojin/v1/hojin');
  if (opts.corporateNumber) url.pathname = `/hojin/v1/hojin/${opts.corporateNumber}`;
  else if (opts.name) url.searchParams.set('name', opts.name);
  else return { source: 'GBIZINFO', ok: false, reason: '検索条件（商号か法人番号）が必要。', companies: [] };
  url.searchParams.set('limit', String(opts.limit ?? 100));

  let json: any;
  try {
    const res = await fetch(url, {
      headers: { 'X-hojinInfo-api-token': token, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { source: 'GBIZINFO', ok: false, reason: `APIが${res.status}を返した`, companies: [] };
    json = await res.json();
  } catch (e) {
    return { source: 'GBIZINFO', ok: false, reason: `通信できなかった: ${(e as Error).message}`, companies: [] };
  }

  const items: any[] = Array.isArray(json?.['hojin-infos']) ? json['hojin-infos'] : [];
  const companies: CompanyInput[] = items
    .filter((it) => it?.name)
    .map((it) => ({
      name: String(it.name),
      corporateNumber: it.corporate_number ? String(it.corporate_number) : null,
      address: it.location ? String(it.location) : null,
      website: it.company_url ? String(it.company_url) : null,
      representative: it.representative_name ? String(it.representative_name) : null,
      establishedOn: it.date_of_establishment ? String(it.date_of_establishment) : null,
      employeesEstimate: Number.isFinite(Number(it.employee_number)) ? Number(it.employee_number) : null,
      businessDetail: it.business_items ? String(it.business_items) : null,
      source: 'GBIZINFO' as const,
      sourceUrl: 'https://info.gbiz.go.jp/',
    }));
  return { source: 'GBIZINFO', ok: true, reason: `${companies.length}件`, companies };
}

/**
 * Google Places API (New) の文字検索で店舗・事業所を取る（読み取りのみ）。
 *
 * ★ここで取れるHPは、法人番号にひも付いていない。
 *   同名の別会社・同じビルの別テナントのHPが返ってくることがある。
 *   そのままHP欄に入れると、別会社の話を根拠に営業してしまう。
 *   なので website は「候補」としてだけ返し、採用の可否は identity.ts の照合で決める。
 */
export async function fetchFromGooglePlaces(opts: { name?: string; area?: string; limit?: number }): Promise<FetchOutcome> {
  const key = secret('GOOGLE_PLACES_API_KEY');
  if (!key) return UNSET('GOOGLE_PLACES', 'Google Places API');
  const q = [opts.area, opts.name].filter(Boolean).join(' ').trim();
  if (!q) return { source: 'GOOGLE_PLACES', ok: false, reason: '検索条件（業種・地域）が必要。', companies: [] };

  let json: any;
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        // 要る項目だけを頼む。余計な項目を取ると料金が上がるうえ、使わないデータを持つことになる。
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.primaryTypeDisplayName',
      },
      body: JSON.stringify({ textQuery: q, languageCode: 'ja', regionCode: 'JP', maxResultCount: Math.min(20, opts.limit ?? 20) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { source: 'GOOGLE_PLACES', ok: false, reason: `APIが${res.status}を返した`, companies: [] };
    json = await res.json();
  } catch (e) {
    return { source: 'GOOGLE_PLACES', ok: false, reason: `通信できなかった: ${(e as Error).message}`, companies: [] };
  }

  const places: any[] = Array.isArray(json?.places) ? json.places : [];
  const companies: CompanyInput[] = places
    .map((p) => ({
      name: String(p?.displayName?.text ?? '').trim(),
      address: p?.formattedAddress ? String(p.formattedAddress) : null,
      phone: p?.nationalPhoneNumber ? String(p.nationalPhoneNumber) : null,
      // ★HPは入れない。ここで入れると照合前に確定してしまう。候補として websiteCandidate に置く。
      websiteCandidate: p?.websiteUri ? String(p.websiteUri) : null,
      businessDetail: p?.primaryTypeDisplayName?.text ? String(p.primaryTypeDisplayName.text) : null,
      source: 'GOOGLE_PLACES' as const,
      sourceUrl: p?.id ? `https://www.google.com/maps/place/?q=place_id:${p.id}` : 'https://developers.google.com/maps/documentation/places/web-service',
    }))
    .filter((c) => c.name.length > 0);
  return { source: 'GOOGLE_PLACES', ok: true, reason: `${companies.length}件`, companies };
}

/** ダブルクォート付きCSVの1行を分解する。 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuote = false;
      } else cur += ch;
    } else if (ch === '"') inQuote = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
