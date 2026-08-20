import { all } from './db/client';
import {
  WORK_STEPS, AUTOMATABLE_WEIGHT, AUTOMATABLE_JA,
  normalizeWorkStep, workStepJa,
} from './listing';

/**
 * 「次に自動化すると一番効く工程はどれか」を、実測した秒数から決める（Phase 3.8・ユーザー指示8／9）。
 *
 * 【なぜ勘で決めないのか】
 * 「この作業が面倒だった」という感覚は、たいてい**回数が多い作業**を指していて、
 * **時間が長い作業**を指していない。実際に測ると、面倒だと思っていた工程が
 * 全体の1割しか占めていない、ということが普通に起きる。
 * そこを自動化しても、全体の作業時間は9割残る。
 *
 * だから順番は、感覚ではなく `observation_work_log` に記録した秒数で決める。
 * ユーザー指示45：「いちばん時間がかかった工程が次に自動化する場所。」
 *
 * 【時間が長い工程＝自動化できる工程、ではない】
 * ここが一番間違えやすい。
 * 「商品発見」と「商品情報確認」はたいてい一番時間がかかるが、
 * **このシステムでは自動化できない**。外部サイトを無断で自動巡回しない決まりだからで、
 * 公式APIか正式なデータ提供が無いかぎり、人が見るしかない。
 * 秒数だけで並べると、この2つが上位に来て「そこを自動化しよう」という誤った結論になる。
 *
 * そこで2つの並びを両方出す。
 *   ① かかっている時間の順（事実）
 *   ② 実際に減らせそうな時間の順（＝時間 × 自動化しやすさ。これが次に作るものの順番）
 *
 * 【AUTOMATION_ROI を大きく見せない】
 * 自動化しやすさの重み（`AUTOMATABLE_WEIGHT`）は、EASY でも 1.0 = 全部消える扱いにしているが、
 * HARD は 0.25 しか減らないことにしてある。
 * 「全部自動化すれば作業0分」という計算は現実には起きない。
 * 見栄えのいい数字を出すためにここを甘くしない（CLAUDE.md ルール35：測っていない数字を良く見せない）。
 *
 * 【ここでは何も自動化しない】
 * ユーザー指示9：「まだ実装はしなくて構いません。」
 * このファイルは、どれを作るべきかを決めるための計算だけを行う。
 */

export type StepStat = {
  step: string;
  ja: string;
  /** 実測の合計秒数 */
  seconds: number;
  /** その工程を何回記録したか */
  entries: number;
  /** その工程で処理した件数の合計 */
  rows: number;
  /** 全工程の合計秒数に対する割合 */
  share: number;
  /** 1件あたりの秒数。件数が0なら null。 */
  secondsPerItem: number | null;
  automatable: string;
  automatableJa: string;
  automatableNote: string;
  /** 自動化した場合に減らせると見込む秒数（＝ seconds × 自動化しやすさの重み） */
  reducibleSeconds: number;
  /** 減らせる秒数の、全体の減らせる秒数に対する割合 */
  reducibleShare: number;
};

export type AutomationRoi = {
  /** 何件で換算したか（既定1000件） */
  scaleItems: number;
  /** 実測の1件あたり秒数（全工程の合計 ÷ 件数）。測れていなければ null。 */
  secondsPerItem: number | null;
  /** その秒数で scaleItems 件をこなした場合の時間 */
  manualHours: number | null;
  /** 自動化しやすさを反映したあとに残る時間 */
  remainingHours: number | null;
  /** 減らせる時間 */
  savedHours: number | null;
  /** 削減率。分母0なら null。 */
  savedRate: number | null;
  /** 人間向けの一言。測れていないときは「測れない」と言う。 */
  ja: string;
};

export type AutomationPlan = {
  /** 実測が1件でもあるか */
  measured: boolean;
  totalSeconds: number;
  measuredItems: number;
  /**
   * 数えなかった秒数。記入見本・テスト用の出品に書かれていた分。
   * 「実測」に混ぜると、誰も作業していないのに工程の割合が出てしまう。
   */
  excludedSeconds: number;
  /** ① かかっている時間の順 */
  byTime: StepStat[];
  /** ② 実際に減らせそうな時間の順（次に作るものの順番） */
  byImpact: StepStat[];
  /** 次に自動化すべき工程 TOP3（人間向けの文） */
  top3Ja: string[];
  roi: AutomationRoi;
  verdictJa: string;
  /** 注意書き。時間が長くても自動化できない工程がある場合に出す。 */
  cautionJa: string | null;
};

/** 1000件で換算する。100件だと差が小さく見えて判断しづらい。 */
const DEFAULT_SCALE_ITEMS = 1000;

function hours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

export async function automationPlan(scaleItems = DEFAULT_SCALE_ITEMS): Promise<AutomationPlan> {
  /*
   * 工程ごとの実測。旧コード（IDENTIFY/RECORD など）は normalizeWorkStep で今の6工程に寄せる。
   * 寄せずに別々に数えると、同じ作業が2行に割れて、どちらも「大したことない」ように見える。
   */
  /*
   * 【記入見本・テスト用の行で測った秒数を「実測」にしない（CLAUDE.md ルール33・35）】
   *
   * 画面の記入見本を取り込むと、出品そのものは実市場データではないと判定されて弾かれるが、
   * そこに書いてある作業秒数は作業ログへ入る。これを混ぜると、誰も実際には作業していないのに
   * 「型番確認が26%」のような数字が出て、それを見て次に自動化する工程を決めてしまう。
   * 出品1件ごとの記録（batch_id が `LISTING:`）は、その出品が実市場データのときだけ数える。
   * 手で記録した分（`MANUAL-…`）は人が実際に作業した時間なので、そのまま数える。
   */
  const raw = await all(
    `SELECT batch_id, step, SUM(seconds) AS sec, SUM(rows) AS rows, COUNT(*) AS entries
       FROM observation_work_log GROUP BY batch_id, step`,
  );

  const realKeys = new Set(
    (await all(`SELECT listing_key FROM tracked_listings WHERE real_market_data = 1`))
      .map((r) => String(r.listing_key)),
  );

  /** `LISTING:<出品キー>@<観測日時>` から出品キーを取り出す。 */
  const listingKeyOf = (batchId: string): string | null => {
    if (!batchId.startsWith('LISTING:')) return null;
    const body = batchId.slice('LISTING:'.length);
    const at = body.lastIndexOf('@');
    return at === -1 ? body : body.slice(0, at);
  };

  const merged = new Map<string, { sec: number; rows: number; entries: number }>();
  let excludedSeconds = 0;
  for (const r of raw) {
    const key = listingKeyOf(String(r.batch_id));
    if (key !== null && !realKeys.has(key)) {
      excludedSeconds += Number(r.sec ?? 0);
      continue;
    }
    const code = normalizeWorkStep(String(r.step)) ?? String(r.step);
    const cur = merged.get(code) ?? { sec: 0, rows: 0, entries: 0 };
    cur.sec += Number(r.sec ?? 0);
    cur.rows += Number(r.rows ?? 0);
    cur.entries += Number(r.entries ?? 0);
    merged.set(code, cur);
  }
  excludedSeconds = Math.round(excludedSeconds);

  const totalSeconds = [...merged.values()].reduce((a, v) => a + v.sec, 0);

  /*
   * 実測した「件数」。工程ごとの rows は同じ商品を何度も数えるので合計すると多重に数える。
   * 全体の件数は、実市場の出品の件数で見る方が正しい。
   */
  const listings = await all(
    `SELECT COUNT(*) AS n FROM tracked_listings WHERE real_market_data = 1`,
  );
  const measuredItems = Number(listings[0]?.n ?? 0);

  const stats: StepStat[] = [...merged.entries()].map(([step, v]) => {
    const def = WORK_STEPS.find((s) => s.code === step);
    const level = def ? String(def.automatable) : 'UNKNOWN';
    const weight = AUTOMATABLE_WEIGHT[level] ?? AUTOMATABLE_WEIGHT.UNKNOWN;
    return {
      step,
      ja: workStepJa(step),
      seconds: v.sec,
      entries: v.entries,
      rows: v.rows,
      share: totalSeconds > 0 ? v.sec / totalSeconds : 0,
      secondsPerItem: v.rows > 0 ? Math.round((v.sec / v.rows) * 10) / 10 : null,
      automatable: level,
      automatableJa: AUTOMATABLE_JA[level] ?? AUTOMATABLE_JA.UNKNOWN,
      automatableNote: def ? String(def.automatableNote) : 'この工程は登録されていないため、自動化できるか判断できません。',
      reducibleSeconds: v.sec * weight,
      reducibleShare: 0,
    };
  });

  const totalReducible = stats.reduce((a, s) => a + s.reducibleSeconds, 0);
  for (const s of stats) {
    s.reducibleShare = totalReducible > 0 ? s.reducibleSeconds / totalReducible : 0;
  }

  const byTime = [...stats].sort((a, b) => b.seconds - a.seconds);
  const byImpact = [...stats].sort((a, b) => b.reducibleSeconds - a.reducibleSeconds);

  const measured = totalSeconds > 0;

  const top3Ja = measured
    ? byImpact.slice(0, 3).map((s, i) =>
        `${i + 1}位：「${s.ja}」`
        + `（実測${Math.round(s.seconds / 60)}分・全体の${Math.round(s.share * 100)}%／${s.automatableJa}）`
        + ` → ${s.automatableNote}`)
    : [];

  // --- AUTOMATION_ROI ---
  const secondsPerItem = measuredItems > 0 && totalSeconds > 0
    ? Math.round((totalSeconds / measuredItems) * 10) / 10
    : null;

  let roi: AutomationRoi;
  if (secondsPerItem === null) {
    /*
     * 出せない理由は2つあり、次にやることが違う。混ぜて1つの文にしない。
     *   秒数が無い   → まず秒数を書く。
     *   商品が0件    → 秒数はあるが割る相手がいない（受入テストの記録だけ、など）。
     */
    const reasonJa = !measured
      ? '工程ごとの作業時間がまだ記録されていないため'
      : '実市場の出品がまだ0件で、1件あたりの秒数を出せないため';
    roi = {
      scaleItems, secondsPerItem: null,
      manualHours: null, remainingHours: null, savedHours: null, savedRate: null,
      ja: `${reasonJa}、自動化でどれだけ短くなるかは計算できません。（推測で数字を出しません）`,
    };
  } else {
    const manualSec = secondsPerItem * scaleItems;
    // 残る時間 = 全体のうち「自動化しても減らない分」の割合を、そのまま掛ける。
    const remainRatio = totalSeconds > 0 ? (totalSeconds - totalReducible) / totalSeconds : 1;
    const remainSec = manualSec * remainRatio;
    const savedSec = manualSec - remainSec;
    roi = {
      scaleItems,
      secondsPerItem,
      manualHours: hours(manualSec),
      remainingHours: hours(remainSec),
      savedHours: hours(savedSec),
      savedRate: manualSec > 0 ? savedSec / manualSec : null,
      ja: `いまのやり方だと1件あたり約${Math.round(secondsPerItem)}秒。`
        + `${scaleItems}件で約${hours(manualSec)}時間かかります。`
        + `自動化しやすい工程だけを自動化した場合、残るのは約${hours(remainSec)}時間で、`
        + `約${hours(savedSec)}時間（${Math.round((savedSec / manualSec) * 100)}%）減る見込みです。`
        + '※「全部自動化して0時間」にはなりません。外部サイトを無断で巡回しない決まりのため、'
        + '商品を見つける工程と情報を確認する工程は人が残ります。',
    };
  }

  // 時間は長いのに自動化できない工程が上位にある場合、その事実をはっきり書く。
  const hardTop = byTime.filter((s) => s.automatable === 'HARD' && s.share >= 0.2);
  const cautionJa = hardTop.length > 0
    ? `いちばん時間がかかっているのは「${hardTop.map((s) => s.ja).join('・')}」ですが、`
      + 'この工程は公式APIか正式なデータ提供が無いと自動化できません（無断の自動巡回はしません）。'
      + 'そのため、次に作るものは2番目以降の工程から選んでいます。'
    : null;

  const excludedJa = excludedSeconds > 0
    ? `（記入見本・テスト用の行に書かれていた ${Math.round(excludedSeconds / 60)}分 は、`
      + '実際の作業ではないので数えていません）'
    : '';

  const verdictJa = !measured
    ? '工程ごとの作業時間がまだ1件も記録されていません。'
      + `まず観測CSVに工程ごとの秒数を書いてください。${excludedJa}`
    : `実測 合計${Math.round(totalSeconds / 60)}分。`
      + `かかっている時間の1位は「${byTime[0].ja}」ですが、`
      + `次に自動化して一番効くのは「${byImpact[0].ja}」です。${excludedJa}`;

  return {
    measured, totalSeconds, measuredItems, excludedSeconds,
    byTime, byImpact, top3Ja, roi, verdictJa, cautionJa,
  };
}
