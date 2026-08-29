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

export type SourceStatus = {
  code: 'HOUJIN_BANGOU' | 'GBIZINFO' | 'GOOGLE_PLACES' | 'CSV' | 'EXISTING_LIST';
  label: string;
  configured: boolean;
  readOnly: true;
  note: string;
};

export function sourceStatuses(): SourceStatus[] {
  return [
    {
      code: 'HOUJIN_BANGOU',
      label: '国税庁 法人番号システム Web-API',
      configured: hasSecret('HOUJIN_BANGOU_APP_ID'),
      readOnly: true,
      note: '法人番号・商号・所在地が取れる。電話やメールは取れない。無料。アプリケーションIDの申請が必要。',
    },
    {
      code: 'GBIZINFO',
      label: 'gBizINFO（経済産業省）',
      configured: hasSecret('GBIZINFO_API_TOKEN'),
      readOnly: true,
      note: '法人番号に紐づく従業員数・資本金・企業HPなどが取れる。無料。APIトークンの申請が必要。',
    },
    {
      code: 'GOOGLE_PLACES',
      label: 'Google Places API',
      configured: hasSecret('GOOGLE_PLACES_API_KEY'),
      readOnly: true,
      note: '店舗系の電話番号・HPが取れる。従量課金。取得したデータの扱いは利用規約の範囲に限る。',
    },
    { code: 'CSV', label: 'CSV取込', configured: true, readOnly: true, note: '手元のリストをそのまま入れる。鍵は不要。' },
    {
      code: 'EXISTING_LIST',
      label: '既存の営業リスト（data/sales_list.json）',
      configured: true,
      readOnly: true,
      note: 'このワークスペースの scripts/build_data_json.py が作った既存リストを読み込む。',
    },
  ];
}

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
