/**
 * 【ASIN_MATCH_SCORE — 手元の商品と、Amazonの商品が同じものか】（Phase 3.10・2026-08-25）
 *
 * ★このファイルは他のファイルを一切 import しない（ルール37）。
 *
 * ------------------------------------------------------------------
 * 【なぜ点数にするのか】
 *
 * ご本人の指示（原文）：
 *   「ASINが見つかったから同一商品確定にはしないでください。」
 *   「取り違えは重大事故。」
 *
 * まったくその通りで、ここは金額計算より危ない場所である。
 * 相場を間違えれば「思ったより儲からなかった」で済むが、商品を取り違えると
 * **別の商品の相場を見て仕入れ、売れない在庫を掴む**。
 *
 * しかも取り違えは気づきにくい。画面には商品名が出ているので、
 * 人は「Amazonにあった＝これだ」と思ってしまう。
 *
 * だから、
 *   ① 一致の根拠を項目ごとに分けて点数にする（どこが合っていてどこが合っていないかを見せる）
 *   ② 決定的に違う点が1つでもあれば、合計点が高くても不一致にする（拒否権）
 *   ③ 候補が複数残ったら、点数が高くても人の確認へ回す
 * の3段構えにする。
 *
 * ------------------------------------------------------------------
 * 【1つのJANに複数のASINがある】
 *
 * 調査で分かった重要な事実。同じJANコードに対して、Amazon側の登録が
 * 複数のASINに分かれていることがある（旧版・並行輸入・セット売りなど）。
 * だから「JANで引いたら1件出た」を前提にした作りにしない。
 * **候補は複数のまま持ち、選ぶのは人**。
 */

/* ================================================================
 * 判定（3つ。「たぶん合っている」を作らない・ルール48）
 * ================================================================ */

export const ASIN_MATCH_VERDICTS = ['MATCHED', 'NEEDS_HUMAN_CHECK', 'MISMATCH'] as const;
export type AsinMatchVerdict = (typeof ASIN_MATCH_VERDICTS)[number];

export const ASIN_MATCH_VERDICT_JA: Record<AsinMatchVerdict, string> = {
  MATCHED: '同じ商品と判断できる',
  NEEDS_HUMAN_CHECK: '候補ではあるが、人が確認するまで使わない',
  MISMATCH: '違う商品',
};

/**
 * この点数以上でなければ `MATCHED` にしない。
 *
 * ★候補を増やしたいときに、ここを下げない（ルール13・81）。
 *   下げれば候補は必ず増えるが、増えるのは「紛らわしい商品」である。
 */
export const ASIN_MATCH_THRESHOLDS = {
  /** これ未満は候補にもしない */
  MIN_CANDIDATE: 40,
  /** これ以上かつ拒否権に触れていなければ MATCHED */
  MATCHED: 75,
} as const;

/* ================================================================
 * 点数の内訳
 * ================================================================ */

/**
 * 何点ずつ付けるか。合計100点。
 *
 * JANに半分を割り当てているのは、これが唯一「同じ商品を指す共通の番号」だから。
 * 商品名は最後の手がかりであって、名前が似ているだけでは同じ商品にしない。
 */
export const ASIN_MATCH_WEIGHTS = {
  /** JAN / EAN / UPC が一致 */
  BARCODE: 50,
  /** 型番（model / partNumber）が一致 */
  MODEL: 20,
  /** ブランドが一致 */
  BRAND: 10,
  /** 商品名が十分に似ている */
  TITLE: 10,
  /** 色が一致 */
  COLOR: 4,
  /** 入数・セット個数が一致 */
  QUANTITY: 6,
} as const;

export type MatchFieldResult = {
  field: keyof typeof ASIN_MATCH_WEIGHTS;
  labelJa: string;
  /** 'MATCH' 一致 / 'DIFFER' 違う / 'UNKNOWN' どちらかに値が無い */
  state: 'MATCH' | 'DIFFER' | 'UNKNOWN';
  points: number;
  detailJa: string;
};

export type AsinMatchResult = {
  asin: string;
  score: number;
  verdict: AsinMatchVerdict;
  fields: MatchFieldResult[];
  /** 拒否権に触れた理由。1つでもあれば MISMATCH。 */
  vetoes: string[];
  /** 判定の理由（画面にそのまま出す日本語）。 */
  reasonJa: string;
};

/* ================================================================
 * 入力
 * ================================================================ */

/** 手元の商品（仕入先のCSVなどから来る側）。 */
export type LocalProduct = {
  jan?: string | null;
  model?: string | null;
  brand?: string | null;
  name?: string | null;
  color?: string | null;
  /** 入数・セット個数。単品なら1。 */
  quantity?: number | null;
};

/** Amazon側の商品（Keepaが返した側）。 */
export type AmazonProduct = {
  asin: string;
  eanList?: string[] | null;
  upcList?: string[] | null;
  model?: string | null;
  partNumber?: string | null;
  brand?: string | null;
  title?: string | null;
  color?: string | null;
  packageQuantity?: number | null;
  numberOfItems?: number | null;
};

/* ================================================================
 * 文字を比べる下ごしらえ
 * ================================================================ */

/**
 * 比較用に文字を揃える。
 *
 * ★長音符「ー」を半角ハイフンに変えない（既存ルール。商品名が読めなくなる）。
 *   ここは比較専用なので表示には使わないが、同じ落とし穴を作らないため揃えておく。
 */
function norm(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    // 全角の英数字と記号を半角へ（長音符は対象外）
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[　\s]+/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .toUpperCase()
    .trim();
}

/** 型番の比較用。ハイフン・スペース・記号を落として英数字だけにする。 */
function normModel(s: unknown): string {
  return norm(s).replace(/[^A-Z0-9]/g, '');
}

/** バーコードの比較用。数字だけにする。 */
function normCode(s: unknown): string {
  return String(s ?? '').replace(/[^0-9]/g, '');
}

/**
 * 商品名の似ている度合い（0〜1）。
 *
 * 文字2つ組の重なりで測る。日本語の商品名は語の切れ目が曖昧なので、
 * 単語単位より2文字単位の方が素直に効く。
 */
function titleSimilarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    if (s.length === 1) set.add(s);
    return set;
  };
  const ga = grams(x);
  const gb = grams(y);
  if (ga.size === 0 || gb.size === 0) return 0;
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit++;
  return (2 * hit) / (ga.size + gb.size);
}

/** 商品名が「似ている」と言ってよい下限。 */
export const TITLE_SIMILARITY_MIN = 0.45;

/* ================================================================
 * 本体
 * ================================================================ */

/**
 * 1つのASINについて、手元の商品と同じかを採点する。
 *
 * 【拒否権（veto）】
 * 次のどれかに当てはまったら、合計点が何点でも `MISMATCH`。
 *   ① バーコードが両方あって、違う
 *   ② 入数・セット個数が両方あって、違う（単品とセットの取り違えは典型的な事故）
 *   ③ ブランドが両方あって、違う
 *
 * 「どちらかが空欄」は違いではない。**分からないことを、違うことにしない。**
 */
export function scoreAsinMatch(local: LocalProduct, amazon: AmazonProduct): AsinMatchResult {
  const fields: MatchFieldResult[] = [];
  const vetoes: string[] = [];
  let score = 0;

  const push = (
    field: keyof typeof ASIN_MATCH_WEIGHTS,
    labelJa: string,
    state: MatchFieldResult['state'],
    points: number,
    detailJa: string,
  ) => {
    fields.push({ field, labelJa, state, points, detailJa });
    score += points;
  };

  // ---- ① バーコード（JAN / EAN / UPC） -------------------------
  const localCode = normCode(local.jan);
  const amazonCodes = [...(amazon.eanList ?? []), ...(amazon.upcList ?? [])]
    .map(normCode)
    .filter((c) => c.length >= 8);
  if (localCode.length >= 8 && amazonCodes.length > 0) {
    // 12桁(UPC)と13桁(EAN)は先頭0の有無だけの違いになることがあるので、後ろ12桁でも比べる。
    const tail = (c: string) => c.slice(-12);
    const hit = amazonCodes.some((c) => c === localCode || tail(c) === tail(localCode));
    if (hit) {
      push('BARCODE', 'JAN/EAN/UPC', 'MATCH', ASIN_MATCH_WEIGHTS.BARCODE, `一致（${localCode}）`);
    } else {
      push('BARCODE', 'JAN/EAN/UPC', 'DIFFER', 0, `不一致（手元 ${localCode} ／ Amazon ${amazonCodes.join(', ')}）`);
      vetoes.push(`バーコードが違います（手元 ${localCode} ／ Amazon ${amazonCodes.join(', ')}）`);
    }
  } else {
    push('BARCODE', 'JAN/EAN/UPC', 'UNKNOWN', 0,
      localCode.length >= 8 ? 'Amazon側にバーコードの登録がありません' : '手元の商品にJANがありません');
  }

  // ---- ② 型番 -------------------------------------------------
  const localModel = normModel(local.model);
  const amazonModels = [amazon.model, amazon.partNumber].map(normModel).filter((m) => m.length >= 3);
  if (localModel.length >= 3 && amazonModels.length > 0) {
    // 完全一致だけでなく「片方がもう片方を含む」も一致とみなす
    // （メーカー型番に色番号や梱包記号が足されていることがあるため）。
    const hit = amazonModels.some((m) => m === localModel || m.includes(localModel) || localModel.includes(m));
    if (hit) {
      push('MODEL', '型番', 'MATCH', ASIN_MATCH_WEIGHTS.MODEL, `一致（${local.model}）`);
    } else {
      // 型番違いは拒否権にしない。表記ゆれが非常に多く、拒否権にすると正しい候補まで落とす。
      push('MODEL', '型番', 'DIFFER', 0, `不一致（手元 ${local.model} ／ Amazon ${amazonModels.join(', ')}）`);
    }
  } else {
    push('MODEL', '型番', 'UNKNOWN', 0, '型番がどちらかに入っていません');
  }

  // ---- ③ ブランド ---------------------------------------------
  const lb = norm(local.brand);
  const ab = norm(amazon.brand);
  if (lb && ab) {
    if (lb === ab || lb.includes(ab) || ab.includes(lb)) {
      push('BRAND', 'ブランド', 'MATCH', ASIN_MATCH_WEIGHTS.BRAND, `一致（${amazon.brand}）`);
    } else {
      push('BRAND', 'ブランド', 'DIFFER', 0, `不一致（手元 ${local.brand} ／ Amazon ${amazon.brand}）`);
      vetoes.push(`ブランドが違います（手元 ${local.brand} ／ Amazon ${amazon.brand}）`);
    }
  } else {
    push('BRAND', 'ブランド', 'UNKNOWN', 0, 'ブランドがどちらかに入っていません');
  }

  // ---- ④ 商品名 -----------------------------------------------
  const sim = titleSimilarity(local.name ?? '', amazon.title ?? '');
  if (local.name && amazon.title) {
    if (sim >= TITLE_SIMILARITY_MIN) {
      push('TITLE', '商品名', 'MATCH', ASIN_MATCH_WEIGHTS.TITLE, `似ています（一致度 ${(sim * 100).toFixed(0)}%）`);
    } else {
      // 名前が似ていないだけでは拒否権にしない。日本語の商品名は表記が大きく揺れる。
      push('TITLE', '商品名', 'DIFFER', 0, `あまり似ていません（一致度 ${(sim * 100).toFixed(0)}%）`);
    }
  } else {
    push('TITLE', '商品名', 'UNKNOWN', 0, '商品名がどちらかに入っていません');
  }

  // ---- ⑤ 色 ---------------------------------------------------
  const lc = norm(local.color);
  const ac = norm(amazon.color);
  if (lc && ac) {
    if (lc === ac || lc.includes(ac) || ac.includes(lc)) {
      push('COLOR', '色', 'MATCH', ASIN_MATCH_WEIGHTS.COLOR, `一致（${amazon.color}）`);
    } else {
      push('COLOR', '色', 'DIFFER', 0, `不一致（手元 ${local.color} ／ Amazon ${amazon.color}）`);
    }
  } else {
    push('COLOR', '色', 'UNKNOWN', 0, '色がどちらかに入っていません');
  }

  // ---- ⑥ 入数・セット個数 --------------------------------------
  const lq = Number.isFinite(Number(local.quantity)) && Number(local.quantity) > 0 ? Number(local.quantity) : null;
  const aqRaw = [amazon.numberOfItems, amazon.packageQuantity]
    .map((v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null))
    .filter((v): v is number => v !== null);
  const aq = aqRaw.length > 0 ? aqRaw[0] : null;
  if (lq !== null && aq !== null) {
    if (lq === aq) {
      push('QUANTITY', '入数・セット個数', 'MATCH', ASIN_MATCH_WEIGHTS.QUANTITY, `一致（${lq}個）`);
    } else {
      push('QUANTITY', '入数・セット個数', 'DIFFER', 0, `不一致（手元 ${lq}個 ／ Amazon ${aq}個）`);
      vetoes.push(
        `入数が違います（手元 ${lq}個 ／ Amazon ${aq}個）。`
        + '単品とセット売りの取り違えは、相場が何倍も変わるため重大です。',
      );
    }
  } else {
    push('QUANTITY', '入数・セット個数', 'UNKNOWN', 0, '入数がどちらかに入っていません');
  }

  // ---- 判定 ----------------------------------------------------
  let verdict: AsinMatchVerdict;
  let reasonJa: string;

  if (vetoes.length > 0) {
    verdict = 'MISMATCH';
    reasonJa = `決定的に違う点があるため、違う商品と判断しました：${vetoes.join(' / ')}`;
  } else if (score >= ASIN_MATCH_THRESHOLDS.MATCHED) {
    verdict = 'MATCHED';
    const matched = fields.filter((f) => f.state === 'MATCH').map((f) => f.labelJa);
    reasonJa = `${score}点。${matched.join('・')}が一致しています。`;
  } else if (score >= ASIN_MATCH_THRESHOLDS.MIN_CANDIDATE) {
    verdict = 'NEEDS_HUMAN_CHECK';
    const unknown = fields.filter((f) => f.state === 'UNKNOWN').map((f) => f.labelJa);
    reasonJa =
      `${score}点。同じ商品と言い切るには足りません`
      + (unknown.length > 0 ? `（${unknown.join('・')}が確認できていません）` : '')
      + '。人が見て確かめてください。';
  } else {
    verdict = 'MISMATCH';
    reasonJa = `${score}点しかなく、同じ商品と考える根拠がありません。`;
  }

  return { asin: amazon.asin, score, verdict, fields, vetoes, reasonJa };
}

/* ================================================================
 * 候補が複数あるとき
 * ================================================================ */

export type AsinMatchSelection = {
  candidates: AsinMatchResult[];
  /** 選ばれたASIN。決められなければ null。 */
  chosenAsin: string | null;
  verdict: AsinMatchVerdict;
  reasonJa: string;
};

/**
 * 候補の中から1つ選ぶ……のではなく、**選べるかどうかを判定する**。
 *
 * 【1位を自動で採らない】
 * 1位と2位の点数が近いとき、1位を採ると「紛らわしい2つのうち片方」を
 * 機械が勝手に選んだことになる。これがいちばん危ない取り違え方である。
 * 差が十分に開いているときだけ、1つに決める。
 */
export const ASIN_MATCH_MIN_LEAD = 15;

export function selectAsinMatch(results: AsinMatchResult[]): AsinMatchSelection {
  const candidates = [...results].sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return {
      candidates,
      chosenAsin: null,
      verdict: 'MISMATCH',
      reasonJa: 'Amazon側に候補が見つかりませんでした。',
    };
  }

  const usable = candidates.filter((c) => c.verdict !== 'MISMATCH');
  if (usable.length === 0) {
    return {
      candidates,
      chosenAsin: null,
      verdict: 'MISMATCH',
      reasonJa: `候補は${candidates.length}件ありましたが、いずれも違う商品と判断しました。`,
    };
  }

  const top = usable[0];
  const second = usable[1];

  if (second && top.score - second.score < ASIN_MATCH_MIN_LEAD) {
    return {
      candidates,
      chosenAsin: null,
      verdict: 'NEEDS_HUMAN_CHECK',
      reasonJa:
        `似た候補が${usable.length}件あり、1位（${top.asin}・${top.score}点）と`
        + `2位（${second.asin}・${second.score}点）の差が${top.score - second.score}点しかありません。`
        + '機械が選ぶと取り違えるおそれがあるため、人が確かめてください。',
    };
  }

  if (top.verdict === 'MATCHED') {
    return {
      candidates,
      chosenAsin: top.asin,
      verdict: 'MATCHED',
      reasonJa: `${top.asin} を同じ商品と判断しました。${top.reasonJa}`,
    };
  }

  return {
    candidates,
    chosenAsin: null,
    verdict: 'NEEDS_HUMAN_CHECK',
    reasonJa: `いちばん近いのは ${top.asin}（${top.score}点）ですが、${top.reasonJa}`,
  };
}
