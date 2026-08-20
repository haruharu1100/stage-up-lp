import { all, nowIso, run } from '../db/client';
import {
  GATE_AXES,
  PERMISSION_FIELDS,
  SCORE_AXES,
  VENUE_RESEARCH,
  gateReasonJa,
  passesGate,
  priorityScore,
  rankedResearch,
  type VenueResearch,
} from '../venuepermissions';

/**
 * 【市場ごとの調査結果を venue_connectors へ登録する】
 *
 * ★ここで登録するのは「調べた結果」であって「使ってよい」という許可ではない。
 *   state を CONNECTED にする行は1つも無い。CONNECTED にしてよい条件は
 *   ①出典URL ②確認日 ③確認者 ④実際の取得成功記録 の4つが全部そろったときだけで、
 *   いまはどの市場も④を満たしていない（1件も取得していない）。
 *
 * 【何度実行しても同じになる】
 *   UNIQUE(venue_code, operation) があるので、既にある行は上書き更新する。
 *   調査をやり直したときに古い判定が残らないようにするため。
 */

/** 調査結果を1つの市場につき2行に分ける。価格が取れることと、成約価格が取れることは別の話だから。 */
const OPERATIONS = ['READ_PRICE', 'READ_SOLD'] as const;

export async function ensureConnectorResearch(): Promise<void> {
  const now = nowIso();
  const today = now.slice(0, 10);

  const existing = new Set(
    (await all('SELECT venue_code, operation FROM venue_connectors')).map(
      (r) => `${r.venue_code}|${r.operation}`,
    ),
  );

  for (const r of VENUE_RESEARCH) {
    for (const op of OPERATIONS) {
      /*
       * 成約価格（READ_SOLD）は、価格が取れる市場でも取れないことが普通にある。
       * 例：Yahoo!ショッピングは現在価格は取れるが、販売数・成約履歴のフィールドが
       * レスポンス定義に存在しない（＝「無い」と確認済み。UNKNOWNではない）。
       * だから行を分けて、READ_SOLD 側だけ MANUAL_ONLY にする。
       */
      const state = op === 'READ_SOLD' && r.sold_data === 'NO' ? 'MANUAL_ONLY' : r.state;
      const scoreJson = JSON.stringify(r.scores);
      const unknownsJson = JSON.stringify(r.unknowns);
      const note = op === 'READ_SOLD' && r.sold_data === 'NO'
        ? `成約価格（いくらで売れたか）は取得できないと確認済み。／${r.note}`
        : r.note;

      const args = [
        r.access_method, state, r.source_urls[0] ?? null, today, 'claude-research-2026-08-20',
        r.rate_limit_note, note, r.venue_ref,
        r.permissions.api_exists,
        r.permissions.commercial_use_allowed,
        r.permissions.internal_business_use_allowed,
        r.permissions.price_analysis_allowed,
        r.permissions.data_storage_allowed,
        r.permissions.automated_collection_allowed,
        r.permissions.automated_purchase_allowed,
        r.permissions.automated_listing_allowed,
        r.verdict, priorityScore(r), scoreJson, unknownsJson, r.sold_data,
      ];

      if (existing.has(`${r.connector_code}|${op}`)) {
        await run(
          `UPDATE venue_connectors SET
             access_method = ?, state = ?, terms_source_url = ?, terms_verified_at = ?, verified_by = ?,
             rate_limit_note = ?, note = ?, venue_ref = ?,
             api_exists = ?, commercial_use_allowed = ?, internal_business_use_allowed = ?,
             price_analysis_allowed = ?, data_storage_allowed = ?, automated_collection_allowed = ?,
             automated_purchase_allowed = ?, automated_listing_allowed = ?,
             usage_verdict = ?, priority_score = ?, priority_score_json = ?, unknowns_json = ?,
             sold_data_available = ?, updated_at = ?
           WHERE venue_code = ? AND operation = ?`,
          [...args, now, r.connector_code, op],
        );
      } else {
        await run(
          `INSERT INTO venue_connectors
            (venue_code, operation, access_method, state, terms_source_url, terms_verified_at, verified_by,
             rate_limit_note, note, venue_ref,
             api_exists, commercial_use_allowed, internal_business_use_allowed,
             price_analysis_allowed, data_storage_allowed, automated_collection_allowed,
             automated_purchase_allowed, automated_listing_allowed,
             usage_verdict, priority_score, priority_score_json, unknowns_json, sold_data_available,
             created_at, updated_at)
           VALUES (?,?, ?,?,?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,?, ?,?,?,?,?, ?,?)`,
          [r.connector_code, op, ...args, now, now],
        );
      }
    }
  }
}

export type ConnectorRankRow = {
  connector_code: string;
  venue_ref: string;
  name: string;
  score: number;
  passes_gate: boolean;
  gate_reason_ja: string | null;
  state: string;
  verdict: string;
  unknown_count: number;
};

/**
 * 画面に出す順番。
 * ★点数の高い順に並べるだけにしない。Gate を通っていない市場は、点数が高くても下に置く。
 *   Amazon Creators API は技術点が高いのに、ライセンスが当社の目的を名指しで禁じている。
 *   点数順に並べて上から選ぶと、この市場を選んでしまう。
 */
export function connectorRanking(): ConnectorRankRow[] {
  return rankedResearch().map((r) => ({
    connector_code: r.connector_code,
    venue_ref: r.venue_ref,
    name: r.name,
    score: priorityScore(r),
    passes_gate: passesGate(r),
    gate_reason_ja: gateReasonJa(r),
    state: r.state,
    verdict: r.verdict,
    unknown_count: countUnknownPermissions(r) + r.unknowns.length,
  }));
}

export function countUnknownPermissions(r: VenueResearch): number {
  return PERMISSION_FIELDS.filter((f) => r.permissions[f] === 'UNKNOWN').length;
}

/**
 * 自動取得を始めてよいか。
 *
 * ★1つでも UNKNOWN が残っていたら false。
 *   「たぶん大丈夫」で始めない。データが欲しいことは、許可の代わりにならない。
 */
export function mayStartAutoCollection(r: VenueResearch): { ok: false; reasonJa: string } | { ok: true } {
  if (r.verdict === 'CONFIRMED_PROHIBITED') {
    return { ok: false, reasonJa: '公式情報で禁止と確認できているため、接続しません。' };
  }
  if (!passesGate(r)) {
    return { ok: false, reasonJa: gateReasonJa(r) ?? '許可の確認が取れていないため、接続しません。' };
  }
  const unknowns = PERMISSION_FIELDS.filter((f) => r.permissions[f] === 'UNKNOWN');
  if (unknowns.length > 0) {
    return {
      ok: false,
      reasonJa: `まだ確認できていない項目が ${unknowns.length} 件あるため、接続しません。`,
    };
  }
  return { ok: true };
}

/** 採点の内訳を人間向けに出す。なぜその点なのかを画面で追えるようにするため。 */
export function scoreBreakdown(r: VenueResearch): { ja: string; point: number; isGate: boolean }[] {
  return SCORE_AXES.map((a) => ({
    ja: a.ja,
    point: r.scores[a.key] ?? 0,
    isGate: (GATE_AXES as string[]).includes(a.key),
  }));
}
