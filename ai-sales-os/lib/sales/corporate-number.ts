import type { OfficialCompanyRow } from './official-data';

/**
 * 会社に「法人番号」を、国が配っているデータだけで突き合わせる。
 *
 * ★APIキーは要らない。
 *   国税庁が全件データを誰でもダウンロードできる形で配っている。そのファイルだけを使う。
 *   だから「鍵が来るまで法人営業側が何も動かない」という状態には戻さない。
 *   gBizINFO の鍵が要る機能は KEY_WAITING（鍵待ち）のままでよく、ここには関係しない。
 *
 * ★いちばん大事な決まり：迷ったら番号を入れない。
 *   同じ商号の会社は日本中にいくらでもある（「株式会社山田工業」は何十社もある）。
 *   候補が2件以上あるときに1つ選ぶと、まったく別の会社に営業をかけることになる。
 *   だから候補が1件に絞れないときは AMBIGUOUS（絞れない）として、番号を空のままにする。
 *
 * ★UNKNOWN を 0 や空文字で埋めない。理由まで残す。
 *   「まだ調べていない」「国のデータに無かった」「同名が多すぎて選べない」は、
 *   人にとってまったく意味が違う。1つの空欄にまとめると、人は調べ忘れだと思って手で埋めてしまう。
 *
 * ★CONFLICT（もう入っている番号と、国のデータの商号が食い違う）は、その場で営業対象から外す。
 *   別会社の可能性がある以上、送る先として使ってはいけない。
 */

export type CorporateNumberStatus =
  /** 国の全件データに、同じ商号＋同じ住所の法人がちょうど1件だけあった。 */
  | 'VERIFIED'
  /** まだ照合していない。 */
  | 'UNKNOWN'
  /** 同じ商号の候補が2件以上あり、1件に絞れなかった。 */
  | 'AMBIGUOUS'
  /** 国の全件データに、その商号が見つからなかった。 */
  | 'NOT_FOUND'
  /** すでに入っている番号と、国のデータの商号が食い違う。＝別会社の疑い。 */
  | 'CONFLICT';

export const CORPORATE_NUMBER_STATUS_JA: Record<CorporateNumberStatus, string> = {
  VERIFIED: '照合済み',
  UNKNOWN: '未照合',
  AMBIGUOUS: '同名が複数（絞れない）',
  NOT_FOUND: '国のデータに無い',
  CONFLICT: '別会社の疑い',
};

export type CorporateNumberMatch = {
  status: CorporateNumberStatus;
  /** VERIFIED のときだけ入る。それ以外は必ず null（推測で埋めない）。 */
  corporateNumber: string | null;
  /** なぜその判定になったかを日本語で。空にしない。 */
  reasonJa: string;
  /** 商号で当たった候補の数（住所で絞る前）。 */
  nameCandidates: number;
  /** 商号＋住所で当たった候補の数。 */
  addressCandidates: number;
  /** VERIFIED のときの相手の住所（人が目で確かめられるように）。 */
  matchedAddress: string | null;
  /** 営業候補から外すべきか（CONFLICT のときだけ true）。 */
  block: boolean;
};

// ───────────────────────────────────────── 文字をそろえる

/** 全角の英数字と記号を半角に直す。国のデータと手元のCSVで書き方が違うため。 */
function toHalfWidth(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/－|ー|―|‐|−/g, '-');
}

/**
 * 商号をそろえる。
 * ★「株式会社」の位置（前株・後株）は消さない。
 *   前株と後株は別の会社になりうるので、消すと違う会社を同じ会社として扱ってしまう。
 *   ここでそろえるのは「(株)→株式会社」のような書き方の揺れだけ。
 */
export function normalizeCompanyName(raw: string): string {
  let s = toHalfWidth(String(raw ?? '')).trim();
  s = s
    .replace(/\(株\)|㈱/g, '株式会社')
    .replace(/\(有\)|㈲/g, '有限会社')
    .replace(/\(同\)/g, '合同会社')
    .replace(/\(合\)/g, '合資会社');
  // 空白・中黒・記号を落とす（国のデータは空白を入れない書き方が多い）。
  s = s.replace(/[\s・･,，.．'"”“’`]/g, '');
  return s;
}

/**
 * 商号から「支店・工場・営業所」などの後ろ足しを外した本体を返す。
 * ★本体が一致しても住所は本社と違うので、これだけでは VERIFIED にしない。
 *   あくまで「同じ会社の枝かもしれない」という手がかりに留める。
 */
export function stripBranch(name: string): { base: string; branch: string | null } {
  const s = normalizeCompanyName(name);
  const m = s.match(/^(.*?)((?:本社|本店|支社|支店|営業所|事業所|工場|センター|出張所)[^]*)$/);
  if (!m || m[1].length < 4) return { base: s, branch: null };
  return { base: m[1], branch: m[2] };
}

/**
 * 住所をそろえる。
 * 「1丁目2番3号」「1-2-3」「一丁目2番地の3」を同じ形にする。
 * ★ここで数字を落とさない。番地が違えば別の会社である可能性が高い。
 */
export function normalizeAddress(raw: string): string {
  let s = toHalfWidth(String(raw ?? '')).trim();
  s = s.replace(/[\s]/g, '');
  // 漢数字の丁目（一丁目〜十丁目）を数字にする。
  const kanji: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };
  s = s.replace(/([一二三四五六七八九十])丁目/g, (_, k: string) => `${kanji[k] ?? k}丁目`);
  s = s.replace(/丁目|番地の|番地|番|号/g, '-');
  s = s.replace(/-+/g, '-').replace(/-$/, '');
  return s;
}

// ───────────────────────────────────────── 索引

export type OfficialIndex = {
  byName: Map<string, OfficialCompanyRow[]>;
  byNumber: Map<string, OfficialCompanyRow>;
  size: number;
};

/** 国の全件データを、商号で引ける形にする。 */
export function buildOfficialIndex(rows: OfficialCompanyRow[]): OfficialIndex {
  const byName = new Map<string, OfficialCompanyRow[]>();
  const byNumber = new Map<string, OfficialCompanyRow>();
  for (const r of rows) {
    const key = normalizeCompanyName(r.name);
    if (key.length >= 2) {
      const list = byName.get(key);
      if (list) list.push(r);
      else byName.set(key, [r]);
    }
    byNumber.set(r.corporateNumber, r);
  }
  return { byName, byNumber, size: rows.length };
}

// ───────────────────────────────────────── 照合

export type CompanyForMatch = {
  name: string;
  address: string | null;
  city: string | null;
  prefecture: string | null;
  corporateNumber: string | null;
};

/** 住所がどれくらい一致しているか。3=番地まで一致 2=町名まで一致 1=市区町村だけ一致 0=違う */
export function addressAgreement(mine: string, theirs: string): number {
  const a = normalizeAddress(mine);
  const b = normalizeAddress(theirs);
  if (!a || !b) return 0;
  if (a === b) return 3;
  // 片方がもう片方の頭から続いている（ビル名の有無だけの違い）
  if (a.startsWith(b) || b.startsWith(a)) return 3;
  // 番地を落として町名まででそろえる
  const town = (s: string) => s.replace(/[0-9-]+$/, '');
  if (town(a) && town(a) === town(b)) return 2;
  return 0;
}

/**
 * 1社を国のデータに突き合わせる。
 *
 * 判定の順番（上から順に、当てはまった時点で決める）
 *  ① すでに番号が入っている
 *      → その番号が国のデータにあり、商号も一致 → VERIFIED
 *      → 国のデータにあるが商号が違う         → CONFLICT（営業対象から外す）
 *      → 国のデータに無い                     → そのまま UNKNOWN（消さない・確認済みにもしない）
 *  ② 商号が国のデータに無い                   → NOT_FOUND
 *  ③ 商号は当たるが、住所が一致する候補が0件   → NOT_FOUND（同名の別会社しか無い）
 *  ④ 住所が一致する候補が2件以上               → AMBIGUOUS（絶対に1つ選ばない）
 *  ⑤ 住所が一致する候補がちょうど1件           → VERIFIED
 */
export function matchCorporateNumber(company: CompanyForMatch, index: OfficialIndex): CorporateNumberMatch {
  const base = {
    corporateNumber: null as string | null,
    nameCandidates: 0,
    addressCandidates: 0,
    matchedAddress: null as string | null,
    block: false,
  };

  // ── ① すでに番号がある場合
  const existing = (company.corporateNumber ?? '').replace(/[^0-9]/g, '');
  if (existing.length === 13) {
    const row = index.byNumber.get(existing);
    if (!row) {
      return {
        ...base,
        corporateNumber: existing,
        status: 'UNKNOWN',
        reasonJa: '入っている法人番号が、いま手元にある国の全件データ（都道府県が限られる）に含まれていない。他県の法人の可能性があるため、番号は消さず、確認済みにもしない。',
      };
    }
    const same = normalizeCompanyName(row.name) === normalizeCompanyName(company.name);
    if (same) {
      return {
        ...base,
        corporateNumber: existing,
        status: 'VERIFIED',
        matchedAddress: row.address,
        nameCandidates: 1,
        addressCandidates: 1,
        reasonJa: `国税庁の全件データで法人番号 ${existing} を引くと商号が一致した（${row.name}／${row.address}）。`,
      };
    }
    return {
      ...base,
      corporateNumber: existing,
      status: 'CONFLICT',
      matchedAddress: row.address,
      block: true,
      reasonJa: `入っている法人番号 ${existing} を国税庁の全件データで引くと「${row.name}」という別の商号だった（こちらの記録は「${company.name}」）。別会社の可能性があるので営業候補から外す。`,
    };
  }

  // ── ② 商号で引く
  const key = normalizeCompanyName(company.name);
  const byName = index.byName.get(key) ?? [];
  if (byName.length === 0) {
    const { base: stem, branch } = stripBranch(company.name);
    const stemHits = branch ? (index.byName.get(stem) ?? []) : [];
    if (stemHits.length > 0) {
      return {
        ...base,
        status: 'NOT_FOUND',
        nameCandidates: stemHits.length,
        reasonJa: `「${company.name}」は支店・工場などの名前で、国の登記データには法人本体（${stem}）しか無い。住所も本社とは違うため、法人番号は付けない。`,
      };
    }
    return {
      ...base,
      status: 'NOT_FOUND',
      reasonJa: '国税庁の全件データ（いま手元にある都道府県ぶん）に、同じ商号の法人が見つからない。個人事業か、他県の法人か、商号の書き方が違う可能性がある。',
    };
  }

  // ── ③④⑤ 住所で絞る
  const mine = company.address ?? '';
  const scored = byName.map((r) => ({ r, agree: mine ? addressAgreement(mine, r.address) : 0 }));
  const strong = scored.filter((s) => s.agree >= 3);
  const town = scored.filter((s) => s.agree === 2);
  const hits = strong.length > 0 ? strong : town;

  if (!mine) {
    return {
      ...base,
      status: 'AMBIGUOUS',
      nameCandidates: byName.length,
      reasonJa: `同じ商号の法人が ${byName.length}件あるが、こちらに住所が入っていないので1件に絞れない。住所を入れれば照合できる。`,
    };
  }
  if (hits.length === 0) {
    return {
      ...base,
      status: 'NOT_FOUND',
      nameCandidates: byName.length,
      reasonJa: `同じ商号の法人は ${byName.length}件あったが、住所が1件も一致しない（こちらの住所：${mine}）。同名の別会社しかいないため、番号は付けない。`,
    };
  }
  if (hits.length > 1) {
    return {
      ...base,
      status: 'AMBIGUOUS',
      nameCandidates: byName.length,
      addressCandidates: hits.length,
      reasonJa: `同じ商号・近い住所の法人が ${hits.length}件ある。1つ選ぶと別会社へ営業する恐れがあるため選ばない（候補：${hits
        .slice(0, 3)
        .map((h) => `${h.r.corporateNumber}／${h.r.address}`)
        .join('、')}）。`,
    };
  }

  const hit = hits[0].r;
  return {
    status: 'VERIFIED',
    corporateNumber: hit.corporateNumber,
    nameCandidates: byName.length,
    addressCandidates: 1,
    matchedAddress: hit.address,
    block: false,
    reasonJa: `国税庁の全件データで、商号「${hit.name}」・住所「${hit.address}」がちょうど1件だけ一致した（${
      hits[0].agree === 3 ? '番地まで一致' : '町名まで一致'
    }）。`,
  };
}
