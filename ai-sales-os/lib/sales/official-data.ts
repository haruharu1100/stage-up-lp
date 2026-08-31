import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * 国が誰でもダウンロードできる形で配っている法人データを取り込む。
 *
 * ★これはスクレイピングではない。
 *   国税庁「法人番号公表サイト」が、全件データを ZIP で配布している。
 *   その配布ファイルをそのまま受け取り、そのまま読む。
 *   HTMLを解析して一覧を作るようなことはしていない。
 *
 * ★APIキーは要らない。だから「鍵待ち」を理由に本番検証を止めなくてよい。
 *
 * ★ダウンロードは1回だけ。取ったZIPは data/official/ に置いて使い回す。
 *   同じファイルを何度も国のサーバーから取らない。
 */

export const NTA_BASE = 'https://www.houjin-bangou.nta.go.jp';
export const NTA_ZENKEN = `${NTA_BASE}/download/zenken/`;
export const NTA_POST = `${NTA_BASE}/download/zenken/index.html`;
/** 配布ファイルの番号。国のページに載っている「ファイル番号」をそのまま使う。 */
export const NTA_FILE_NO: Record<string, { no: string; label: string }> = {
  '01': { no: '27662', label: '北海道' },
  '02': { no: '27666', label: '青森県' },
  '03': { no: '27669', label: '岩手県' },
  '04': { no: '27672', label: '宮城県' },
  '05': { no: '27675', label: '秋田県' },
  '06': { no: '27678', label: '山形県' },
  '08': { no: '27684', label: '茨城県' },
  '09': { no: '27687', label: '栃木県' },
  '10': { no: '27690', label: '群馬県' },
  '11': { no: '27693', label: '埼玉県' },
  '12': { no: '27697', label: '千葉県' },
  '14': { no: '27714', label: '神奈川県' },
  '15': { no: '27719', label: '新潟県' },
  '16': { no: '27722', label: '富山県' },
  '17': { no: '27725', label: '石川県' },
  '18': { no: '27728', label: '福井県' },
  '19': { no: '27731', label: '山梨県' },
  '21': { no: '27737', label: '岐阜県' },
  '22': { no: '27740', label: '静岡県' },
  '23': { no: '27743', label: '愛知県' },
  '24': { no: '27747', label: '三重県' },
  '25': { no: '27750', label: '滋賀県' },
  '26': { no: '27753', label: '京都府' },
  '27': { no: '27756', label: '大阪府' },
  '28': { no: '27761', label: '兵庫県' },
  '30': { no: '27768', label: '和歌山県' },
  '31': { no: '27771', label: '鳥取県' },
  '32': { no: '27774', label: '島根県' },
  '33': { no: '27777', label: '岡山県' },
  '34': { no: '27780', label: '広島県' },
  '35': { no: '27783', label: '山口県' },
  '36': { no: '27786', label: '徳島県' },
  '37': { no: '27789', label: '香川県' },
  '38': { no: '27792', label: '愛媛県' },
  '39': { no: '27795', label: '高知県' },
  '46': { no: '27817', label: '鹿児島県' },
  '47': { no: '27820', label: '沖縄県' },
};

/** 法人の種別コード。国が付けている番号。 */
export const CORPORATE_KIND_JA: Record<string, string> = {
  '101': '国の機関',
  '201': '地方公共団体',
  '301': '株式会社',
  '302': '有限会社',
  '303': '合名会社',
  '304': '合資会社',
  '305': '合同会社',
  '399': 'その他の設立登記法人',
  '401': '外国会社等',
  '499': 'その他',
};

/**
 * 営業の相手にしてよい種別。
 * ★国の機関・地方公共団体・宗教法人などは営業候補から外す。
 *   ただしデータそのものは消さない。あとから種別を見直せるようにしておく。
 */
export const SALES_TARGET_KINDS = new Set(['301', '302', '303', '304', '305']);

export type OfficialCompanyRow = {
  corporateNumber: string;
  name: string;
  kind: string;
  kindLabel: string;
  prefecture: string;
  city: string;
  street: string;
  address: string;
  postalCode: string | null;
  /** 登記記録の閉鎖等年月日。入っていたらもう活動していない。 */
  closedAt: string | null;
  /** 最新の履歴かどうか（同じ法人番号で古い行が混ざるため） */
  latest: boolean;
  updatedOn: string | null;
  assignedOn: string | null;
};

// ───────────────────────────────────────── ダウンロード

export function officialDataDir(): string {
  const dir = join(process.cwd(), 'data', 'official');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 国税庁の全件データZIPを取ってくる。
 * ★同じファイルが既にあれば取りに行かない。
 * ★curl を使うのは、国のサイトが「1回ページを開いてから押す」形になっているため。
 *   ページを解析しているのではなく、押しボタンの合言葉（トークン）を受け取っているだけ。
 */
export function downloadNtaZip(prefCode: string): { path: string; downloaded: boolean; label: string } {
  const entry = NTA_FILE_NO[prefCode];
  if (!entry) throw new Error(`都道府県コード ${prefCode} の配布ファイル番号を知らない`);
  const dir = officialDataDir();

  const already = readdirSync(dir).find((f) => f.startsWith(`${prefCode}_`) && f.endsWith('.zip'));
  if (already) return { path: join(dir, already), downloaded: false, label: entry.label };

  const cookies = join(dir, `.cookies_${prefCode}.txt`);
  const page = join(dir, `.page_${prefCode}.html`);
  execFileSync('curl', ['-sL', '-c', cookies, NTA_ZENKEN, '-o', page], { timeout: 120_000 });
  const html = readFileSync(page, 'utf8');
  const m = html.match(/CNSFWTokenProcessor\.request\.token"\s+value="([^"]+)"/);
  if (!m) throw new Error('国税庁のダウンロードページから合言葉（トークン）を受け取れなかった');

  const tmp = join(dir, `.tmp_${prefCode}.zip`);
  const headers = join(dir, `.headers_${prefCode}.txt`);
  execFileSync(
    'curl',
    [
      '-sL', '-b', cookies, '-e', NTA_ZENKEN, '-D', headers, '-X', 'POST', NTA_POST,
      '--data-urlencode', `jp.go.nta.houjin_bangou.framework.web.common.CNSFWTokenProcessor.request.token=${m[1]}`,
      '--data-urlencode', 'event=download',
      '--data-urlencode', `selDlFileNo=${entry.no}`,
      '-o', tmp,
    ],
    { timeout: 600_000, maxBuffer: 1024 * 1024 * 16 },
  );

  const size = existsSync(tmp) ? statSync(tmp).size : 0;
  if (size < 100_000) throw new Error(`ダウンロードしたファイルが小さすぎる（${size}バイト）。中身が来ていない。`);
  const head = readFileSync(headers, 'utf8');
  const fn = head.match(/filename\*?=(?:utf-8''|")?([^\r\n";]+)/i);
  const nice = fn ? decodeURIComponent(fn[1]) : `${prefCode}_all.zip`;
  const dest = join(dir, nice.startsWith(prefCode) ? nice : `${prefCode}_${nice}`);
  writeFileSync(dest, readFileSync(tmp));
  return { path: dest, downloaded: true, label: entry.label };
}

/** ZIPの中のCSVを取り出す（Shift_JIS のまま返さず、UTF-8 の文字列にする）。 */
export function unzipCsv(zipPath: string): string {
  const dir = officialDataDir();
  const out = join(dir, 'csv');
  mkdirSync(out, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', out], { timeout: 300_000 });
  const csv = readdirSync(out).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
  if (csv.length === 0) throw new Error('ZIPの中にCSVが入っていない');
  const target = join(out, csv[csv.length - 1]);
  // 国が配るCSVは Shift_JIS。Node には Shift_JIS の読み手が無いので iconv に渡す。
  const buf = execFileSync('iconv', ['-f', 'CP932', '-t', 'UTF-8', '-c', target], {
    maxBuffer: 1024 * 1024 * 512,
    timeout: 300_000,
  });
  return buf.toString('utf8');
}

// ───────────────────────────────────────── 読み取り

/** 1行のCSVを、引用符を考えて分ける。 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * 国税庁CSVの1行を、扱いやすい形に直す。
 * 列の並びは国が決めているもの（1始まり）：
 *  2=法人番号 7=商号 9=法人種別 10=都道府県 11=市区町村 12=丁目番地
 *  16=郵便番号 19=登記記録の閉鎖等年月日 24=最新履歴 5=更新年月日 23=指定年月日
 */
export function parseNtaRow(cols: string[]): OfficialCompanyRow | null {
  if (cols.length < 24) return null;
  const corporateNumber = (cols[1] ?? '').replace(/[^0-9]/g, '');
  if (corporateNumber.length !== 13) return null;
  const name = (cols[6] ?? '').trim();
  if (!name) return null;
  const kind = (cols[8] ?? '').trim();
  const prefecture = (cols[9] ?? '').trim();
  const city = (cols[10] ?? '').trim();
  const street = (cols[11] ?? '').trim();
  const closedRaw = (cols[18] ?? '').trim();
  return {
    corporateNumber,
    name,
    kind,
    kindLabel: CORPORATE_KIND_JA[kind] ?? '不明',
    prefecture,
    city,
    street,
    address: `${prefecture}${city}${street}`.trim(),
    postalCode: (cols[15] ?? '').trim() || null,
    closedAt: closedRaw || null,
    latest: (cols[23] ?? '').trim() === '1',
    updatedOn: (cols[4] ?? '').trim() || null,
    assignedOn: (cols[22] ?? '').trim() || null,
  };
}

export type OfficialFilter = {
  /** 営業の相手にできる種別だけにするか */
  salesTargetOnly?: boolean;
  /** 市区町村での絞り込み（部分一致） */
  city?: string | null;
  limit?: number;
};

export type OfficialReadStats = {
  lines: number;
  parsed: number;
  skippedNotLatest: number;
  skippedClosed: number;
  skippedNoAddress: number;
  skippedKind: number;
  skippedCity: number;
  kept: number;
};

/**
 * CSV全体から、営業候補にできる法人を選び出す。
 *
 * ★外す条件（外した数は必ず数える。黙って減らさない）
 *   ・最新の履歴でない行（同じ法人番号の古い記録）
 *   ・登記記録の閉鎖等年月日が入っている＝もう活動していない
 *   ・住所が無い
 *   ・国の機関・地方公共団体など、営業の相手でない種別
 */
export function selectOfficialCompanies(
  csvText: string,
  filter: OfficialFilter = {},
): { rows: OfficialCompanyRow[]; stats: OfficialReadStats } {
  const stats: OfficialReadStats = {
    lines: 0, parsed: 0, skippedNotLatest: 0, skippedClosed: 0,
    skippedNoAddress: 0, skippedKind: 0, skippedCity: 0, kept: 0,
  };
  const rows: OfficialCompanyRow[] = [];
  const limit = filter.limit ?? Number.MAX_SAFE_INTEGER;
  const seen = new Set<string>();

  for (const line of csvText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    stats.lines++;
    const row = parseNtaRow(splitCsvLine(line));
    if (!row) continue;
    stats.parsed++;
    if (!row.latest) { stats.skippedNotLatest++; continue; }
    if (row.closedAt) { stats.skippedClosed++; continue; }
    if (!row.address || row.address.length < 6) { stats.skippedNoAddress++; continue; }
    if (filter.salesTargetOnly !== false && !SALES_TARGET_KINDS.has(row.kind)) { stats.skippedKind++; continue; }
    if (filter.city && !row.city.includes(filter.city)) { stats.skippedCity++; continue; }
    if (seen.has(row.corporateNumber)) continue;
    seen.add(row.corporateNumber);
    rows.push(row);
    stats.kept++;
    if (rows.length >= limit) break;
  }
  return { rows, stats };
}

/** 同じ条件で何度実行しても同じ100社が選ばれるようにするための並べ替え鍵。 */
export function stableOrderKey(corporateNumber: string): string {
  return createHash('sha1').update(corporateNumber).digest('hex');
}

// ───────────────────────────────────────── gBizINFO 公式ダウンロード

export const GBIZ_DOWNLOAD_TOP = 'https://info.gbiz.go.jp/hojin/DownloadTop';

/**
 * gBizINFO（経済産業省）が誰でもダウンロードできる形で配っている法人基本情報を取る。
 *
 * ★これもスクレイピングではない。画面に「ダウンロード」ボタンがあり、
 *   そのボタンが送っている内容と同じものを送っているだけ。
 * ★ここには「企業ホームページ」が法人番号にひも付いた形で入っている。
 *   国が法人番号にひも付けて公開しているHPなので、本人のHPとして扱える。
 *   （社名一致で拾ったURLとは信用度がまったく違う）
 * ★APIトークンは要らない。
 *
 * 取れなかったときは throw せず null を返す。
 * 取れないことを 0件 として黙って進めない（呼び出し側で理由を出す）。
 */
export function downloadGbizCsv(opts: { prefecture?: string; corporateNumber?: string }): { path: string; downloaded: boolean } | null {
  const dir = officialDataDir();
  const tag = opts.corporateNumber ? `cn_${opts.corporateNumber}` : `pref_${opts.prefecture ?? 'all'}`;
  const dest = join(dir, `gbiz_${tag}.csv`);
  if (existsSync(dest) && statSync(dest).size > 1000) return { path: dest, downloaded: false };

  const cookies = join(dir, `.gbiz_cookies.txt`);
  const page = join(dir, `.gbiz_top.html`);
  try {
    execFileSync('curl', ['-sL', '-c', cookies, GBIZ_DOWNLOAD_TOP, '-o', page], { timeout: 120_000 });
    const html = readFileSync(page, 'utf8');
    const sid = html.match(/jsessionid=([A-Za-z0-9]+)/)?.[1];
    if (!sid) return null;

    // ★画面のボタンが送っている内容と同じものを組み立てる。
    //   downfile=Kihonjoho（基本情報）／downenc=UTF-8／downtype=zip は画面の初期選択と同じ。
    const body = new URLSearchParams({
      gamen: '4',
      hojinMei: '',
      hojinBango: opts.corporateNumber ?? '',
      hojinShubetsu: '',
      shozaichiTodofuken: opts.prefecture ?? '',
      shozaichiShikuchoson: '',
      downfile: 'Kihonjoho',
      downenc: 'UTF-8',
      downtype: 'zip',
      isZip: 'on',
    }).toString();

    const zipTmp = join(dir, `.gbiz_${tag}.bin`);
    const headers = join(dir, `.gbiz_${tag}.headers`);
    execFileSync(
      'curl',
      ['-sL', '-b', cookies, '-e', GBIZ_DOWNLOAD_TOP, '-D', headers, '-X', 'POST',
       `https://info.gbiz.go.jp/hojin/Download;jsessionid=${sid}`, '--data', body, '-o', zipTmp],
      { timeout: 600_000, maxBuffer: 1024 * 1024 * 16 },
    );
    if (!existsSync(zipTmp) || statSync(zipTmp).size < 200) return null;

    const head = readFileSync(headers, 'utf8');
    if (/content-type:\s*text\/html/i.test(head)) return null; // エラー画面が返ってきた
    const buf = readFileSync(zipTmp);
    // ZIPで返ってきたら展開する。
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      const out = join(dir, `gbizzip_${tag}`);
      mkdirSync(out, { recursive: true });
      execFileSync('unzip', ['-o', '-q', zipTmp, '-d', out], { timeout: 300_000 });
      const csv = readdirSync(out).filter((f) => f.toLowerCase().endsWith('.csv'));
      if (csv.length === 0) return null;
      writeFileSync(dest, readFileSync(join(out, csv[0])));
    } else {
      writeFileSync(dest, buf);
    }
    return { path: dest, downloaded: true };
  } catch {
    return null;
  }
}

export type GbizRow = {
  corporateNumber: string;
  name: string;
  address: string | null;
  website: string | null;
  representative: string | null;
  employees: number | null;
  businessDetail: string | null;
};

/**
 * gBizINFO のCSVを読む。
 * ★列の名前を見て探す。並び順が変わっても壊れないようにする。
 * ★見つからない列は null。無理に埋めない。
 */
export function parseGbizCsv(text: string): GbizRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.replace(/^﻿/, '').trim());
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = head.findIndex((h) => h === n || h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iCn = idx('法人番号', 'corporate_number');
  const iName = idx('法人名', '商号又は名称', 'name');
  const iAddr = idx('本社所在地', '所在地', 'location');
  const iUrl = idx('企業ホームページ', 'ホームページ', 'company_url', 'URL');
  const iRep = idx('代表者名', 'representative_name');
  const iEmp = idx('従業員数', 'employee_number');
  const iBiz = idx('事業概要', '営業品目', 'business_items');
  if (iCn < 0 || iName < 0) return [];

  const out: GbizRow[] = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    const cn = (c[iCn] ?? '').replace(/[^0-9]/g, '');
    const name = (c[iName] ?? '').trim();
    if (cn.length !== 13 || !name) continue;
    const emp = iEmp >= 0 ? Number((c[iEmp] ?? '').replace(/[^0-9]/g, '')) : NaN;
    out.push({
      corporateNumber: cn,
      name,
      address: iAddr >= 0 ? (c[iAddr] ?? '').trim() || null : null,
      website: iUrl >= 0 ? (c[iUrl] ?? '').trim() || null : null,
      representative: iRep >= 0 ? (c[iRep] ?? '').trim() || null : null,
      employees: Number.isFinite(emp) && emp > 0 ? emp : null,
      businessDetail: iBiz >= 0 ? (c[iBiz] ?? '').trim() || null : null,
    });
  }
  return out;
}
