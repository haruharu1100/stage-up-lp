/**
 * 還元率の計算（3種類を、絶対に混ぜない）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、このファイルが必要になったのか（2026-08-26）
 * ═══════════════════════════════════════════════════════
 *
 *   画面には「設計還元率 88.0％」と出ていました。
 *   実際にお客様へ返っていたのは 18.23％ でした。
 *
 *   売上 50,000pt に対して、お返し 9,113pt。500回ぶんの記録が
 *   最初から保存されていたのに、それを見る画面が1つも無かったので、
 *   誰も気づけませんでした。
 *
 *   ★集めているのに見せていない数字は、無いのと同じです。
 *
 *   だから「実際にどれだけ返したか」を、正式な機能にします。
 *
 * ═══════════════════════════════════════════════════════
 * ★3種類を、絶対に混ぜないこと
 * ═══════════════════════════════════════════════════════
 *
 *   この3つは、別物です。同じ「還元率」という言葉で呼ぶと、
 *   運営の方が必ず取り違えます。だから名前を分けます。
 *
 *     設計還元率（designed）
 *       ガチャを作った時点での予定値。
 *       「こう配るつもりだ」という約束。実績ではありません。
 *
 *     残数還元率（remaining）
 *       いま箱に残っている景品の価値 ÷ 残りの販売総額。
 *       これから引く人にとっての、期待できる値です。
 *       100％を超えていたら、ここから先は売るほど赤字になります。
 *
 *     実績還元率（actual）
 *       実際に売れた金額に対して、実際に返した価値。
 *       すでに起きたことなので、言い訳ができません。
 *       今回の 88％→18.23％ を暴けるのは、これだけです。
 *
 *   ★「実還元率」という曖昧な呼び方をしないこと。
 *     どれのことなのか分からず、会議で必ず食い違います。
 *
 * ═══════════════════════════════════════════════════════
 * ★分子と分母を、必ず一緒に返すこと
 * ═══════════════════════════════════════════════════════
 *
 *   「88.02％」とだけ出すと、それが正しいかどうかを
 *   人間は確かめようがありません。
 *
 *       販売額           500,000pt
 *       実際に返した価値 440,120pt
 *       実績還元率        88.02％
 *
 *   この3行が並んでいれば、計算がおかしいときに人が気づけます。
 *   だから numerator（分子）と denominator（分母）を必ず持たせます。
 *
 * ═══════════════════════════════════════════════════════
 * ★分からないときに、0％や100％を出さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   まだ1回も売れていないガチャの実績還元率は、0％ではありません。
 *   「まだ分からない」です。
 *
 *   0％と出すと、運営の方は「1円も返していない」と読みます。
 *   逆に100％と出すと「危ない」と読みます。どちらも嘘です。
 *
 *   分からないときは UNKNOWN と、その理由を返します。
 *   これは手抜きではなく、いちばん正しい答えです。
 *
 * ★壊れた値を、正常な顔で表示しないこと（SAFE FAIL）。
 *   分母がマイナス、価値がNaN、といった状態は、
 *   「たまたま変な数字」ではなく「どこかが壊れている」合図です。
 *   それを丸めて表示すると、壊れたまま運用が続きます。
 */

/* ══════════════════════════════════════════════
   型
   ══════════════════════════════════════════════ */

/** 3種類の還元率。名前を必ず分ける */
export type RtpKind = "designed" | "remaining" | "actual";

export const RTP_LABEL: Record<RtpKind, string> = {
  designed: "設計",
  remaining: "残数",
  actual: "実績",
};

export const RTP_DESCRIPTION: Record<RtpKind, string> = {
  designed: "ガチャを作った時点での予定値です。実績ではありません。",
  remaining:
    "いま箱に残っている景品の価値 ÷ 残りの販売総額です。これから引く方にとっての期待値です。",
  actual:
    "実際に売れた金額に対して、実際にお返しした価値です。すでに起きたことです。",
};

/** 値が出せなかった理由 */
export type RtpUnknownCode =
  /** まだ1回も売れていない、など、分母が0 */
  | "NO_SALES"
  /** 売れてはいるが、判断できるほどの回数がない */
  | "TOO_FEW_PLAYS"
  /** 景品の価値が取れない（在庫表が無い・空） */
  | "NO_PRIZE_VALUE"
  /** 数字が壊れている（NaN・マイナスなど） */
  | "BROKEN_DATA"
  /** 設計値そのものが入っていない */
  | "NO_DESIGN";

export const UNKNOWN_MESSAGE: Record<RtpUnknownCode, string> = {
  NO_SALES: "まだ販売実績がありません。",
  TOO_FEW_PLAYS: "判断できるほどの回数がまだありません。",
  NO_PRIZE_VALUE: "当選価値が取得できません。",
  BROKEN_DATA: "数字が壊れています。表示を止めました。",
  NO_DESIGN: "設計還元率が登録されていません。",
};

/** 還元率ひとつぶん。known が false のときは、絶対に数字を出さないこと */
export type Rtp =
  | {
      known: true;
      kind: RtpKind;
      /** ％。88.02 のように、百分率で持つ（0.8802 ではない） */
      percent: number;
      /** 分子：返した（返す予定の）価値 */
      numerator: number;
      /** 分母：売れた（売る予定の）金額 */
      denominator: number;
      /** 何回ぶんの話か。設計・残数では口数 */
      plays: number;
      /** 内訳（実績のみ）。景品としてお渡しした価値と、ポイントでお返しした価値 */
      breakdown?: { prizeValue: number; pointValue: number };
    }
  | {
      known: false;
      kind: RtpKind;
      code: RtpUnknownCode;
      /** 画面にそのまま出せる日本語 */
      reason: string;
      /** 分かっている範囲の材料（人が見て原因を追えるように） */
      numerator: number | null;
      denominator: number | null;
      plays: number;
    };

/* ══════════════════════════════════════════════
   決まりごと
   ══════════════════════════════════════════════ */

/**
 * これ以上の回数がないと、実績還元率で良し悪しを判断しない。
 *
 * ★なぜ必要か。
 *   10回しか引かれていないガチャで、たまたまS賞が1本出れば
 *   実績還元率は 800％ になります。これは異常ではありません。
 *   ただ回数が足りないだけです。
 *
 *   ここを決めておかないと、開店初日に必ず誤報が出ます。
 *   誤報が続くと、運営の方は警告を読まなくなります。
 *   読まれない警告は、無いのと同じです。
 */
export const MIN_PLAYS_FOR_JUDGEMENT = 30;

/** 設計値からこれだけ離れたら、注意（％ポイント） */
export const WARN_GAP_POINTS = 5;

/** 設計値からこれだけ離れたら、危険（％ポイント） */
export const DANGER_GAP_POINTS = 15;

/**
 * 残数還元率がこれを超えたら、売るほど損が増える。
 *
 * ★100％ちょうどで危険にしないこと。
 *   端数の丸めだけで超えることがあります。少しだけ余裕を持たせます。
 */
export const REMAINING_DANGER_PERCENT = 100;

/* ══════════════════════════════════════════════
   道具
   ══════════════════════════════════════════════ */

/** 使える数字か。NaN・Infinity・マイナスを、ここで全部はじく */
function tsukaeru(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function wakaranai(
  kind: RtpKind,
  code: RtpUnknownCode,
  opts: {
    numerator?: number | null;
    denominator?: number | null;
    plays?: number;
  } = {},
): Rtp {
  return {
    known: false,
    kind,
    code,
    reason: UNKNOWN_MESSAGE[code],
    numerator: opts.numerator ?? null,
    denominator: opts.denominator ?? null,
    plays: opts.plays ?? 0,
  };
}

/**
 * 分子 ÷ 分母 を％にする。
 *
 * ★ここが唯一の割り算です。ほかの場所で割らないこと。
 *   割り算が散らばると、0で割る場所も散らばります。
 */
function warizan(
  kind: RtpKind,
  numerator: number,
  denominator: number,
  plays: number,
  breakdown?: { prizeValue: number; pointValue: number },
): Rtp {
  if (!tsukaeru(numerator) || !tsukaeru(denominator)) {
    return wakaranai(kind, "BROKEN_DATA", {
      numerator: Number.isFinite(numerator) ? numerator : null,
      denominator: Number.isFinite(denominator) ? denominator : null,
      plays,
    });
  }
  if (denominator <= 0) {
    return wakaranai(kind, "NO_SALES", { numerator, denominator, plays });
  }

  const percent = (numerator / denominator) * 100;
  if (!Number.isFinite(percent)) {
    return wakaranai(kind, "BROKEN_DATA", { numerator, denominator, plays });
  }

  return {
    known: true,
    kind,
    /* 小数第2位まで。それ以上は、読む人にとって意味がありません */
    percent: Math.round(percent * 100) / 100,
    numerator,
    denominator,
    plays,
    breakdown,
  };
}

/* ══════════════════════════════════════════════
   ① 設計還元率
   ══════════════════════════════════════════════ */

/**
 * 設計還元率。ガチャを作った時点での予定値。
 *
 * ★2026-08-26 の事故がここです。
 *   「％」で受け取る約束なのに「比率（0.88）」が入っていました。
 *   normalizeRtp（lib/console/draw.ts）が直しますが、
 *   ここでは「直された」ことも分かるようにしておきます。
 */
export function designedRtp(
  designedRtpRaw: number,
  total: number,
  price: number,
): Rtp & { normalized?: boolean } {
  if (!tsukaeru(designedRtpRaw) || designedRtpRaw <= 0) {
    return wakaranai("designed", "NO_DESIGN");
  }

  /* 比率で書かれていたら、％へ直す（0.88 → 88）。
     ★黙って直さないこと。直したことを normalized で知らせます。 */
  const naoshita = designedRtpRaw <= 1.5;
  const percent = naoshita ? designedRtpRaw * 100 : designedRtpRaw;

  if (!tsukaeru(total) || !tsukaeru(price) || total <= 0 || price <= 0) {
    /* 口数や値段が分からなくても、％そのものは言えます。
       ただし分子・分母は出せません */
    return {
      known: true,
      kind: "designed",
      percent: Math.round(percent * 100) / 100,
      numerator: 0,
      denominator: 0,
      plays: 0,
      normalized: naoshita,
    };
  }

  const denominator = price * total;
  const numerator = Math.round(denominator * (percent / 100));

  return {
    ...(warizan("designed", numerator, denominator, total) as Extract<
      Rtp,
      { known: true }
    >),
    /* 割り算の丸めで 87.99 などになるのを避け、設計値そのものを出す */
    percent: Math.round(percent * 100) / 100,
    normalized: naoshita,
  };
}

/* ══════════════════════════════════════════════
   ② 残数還元率
   ══════════════════════════════════════════════ */

export type StockRow = {
  grade: string;
  value: number;
  total: number;
  drawn: number;
};

/**
 * 残数還元率。
 *
 *   いま箱に残っている景品の価値 ÷ 残りの販売総額
 *
 * ★100％を超えたら、そこから先は売るほど損が増えます。
 *   上位賞が早く出てしまった箱は下がり、
 *   上位賞が残っている箱は上がります。どちらも異常ではありません。
 *   ただし、100％超えのまま売り続けるのは経営判断が要ります。
 */
export function remainingRtp(args: {
  price: number;
  leftCount: number;
  stock: StockRow[];
}): Rtp {
  const { price, leftCount, stock } = args;

  if (!tsukaeru(price) || !tsukaeru(leftCount)) {
    return wakaranai("remaining", "BROKEN_DATA");
  }
  if (!Array.isArray(stock) || stock.length === 0) {
    return wakaranai("remaining", "NO_PRIZE_VALUE", {
      denominator: price * leftCount,
    });
  }

  let nokori = 0;
  for (const s of stock) {
    if (!tsukaeru(s.value) || !tsukaeru(s.total) || !tsukaeru(s.drawn)) {
      /* ★1行でも壊れていたら、全体を出さないこと。
           壊れた行だけ0として足すと、それらしい数字が出てしまいます */
      return wakaranai("remaining", "BROKEN_DATA", {
        denominator: price * leftCount,
      });
    }
    nokori += Math.max(0, s.total - s.drawn) * s.value;
  }

  const denominator = price * leftCount;
  if (denominator <= 0) {
    /* 完売。残りが無いので「残数」は存在しない */
    return wakaranai("remaining", "NO_SALES", {
      numerator: nokori,
      denominator,
    });
  }

  return warizan("remaining", nokori, denominator, leftCount);
}

/* ══════════════════════════════════════════════
   ③ 実績還元率
   ══════════════════════════════════════════════ */

/**
 * 実績還元率のもとになる、実際の記録。
 *
 * ★これはサーバー側（draws テーブル）から作ること。
 *   画面で計算しないこと。画面の計算は、画面ごとにずれます。
 */
export type ActualFacts = {
  /** 何回引かれたか */
  plays: number;
  /** 実際に売れた金額（pt） */
  sold: number;
  /** 現物としてお渡しした景品の価値 */
  prizeValue: number;
  /** ポイントでお返しした価値 */
  pointValue: number;
};

/**
 * 実績還元率。
 *
 * ★分子を「景品の価値」だけにしないこと。
 *   C賞・D賞は現物ではなくポイントでお返ししています。
 *   これも立派な還元です。数えなければ、実績は実際より低く出ます。
 *
 * ★逆に、両方を足して二重に数えないこと。
 *   1回の抽選で、お客様が受け取るのは「現物」か「ポイント」の
 *   どちらか一方です。だからサーバー側の集計で、
 *   等級ごとにどちらか片方だけを数えています。
 */
export function actualRtp(facts: ActualFacts): Rtp {
  const { plays, sold, prizeValue, pointValue } = facts;

  if (
    !tsukaeru(plays) ||
    !tsukaeru(sold) ||
    !tsukaeru(prizeValue) ||
    !tsukaeru(pointValue)
  ) {
    return wakaranai("actual", "BROKEN_DATA", { plays: 0 });
  }

  if (plays <= 0 || sold <= 0) {
    return wakaranai("actual", "NO_SALES", {
      numerator: prizeValue + pointValue,
      denominator: sold,
      plays,
    });
  }

  return warizan("actual", prizeValue + pointValue, sold, plays, {
    prizeValue,
    pointValue,
  });
}

/* ══════════════════════════════════════════════
   異常検知
   ══════════════════════════════════════════════ */

export type RtpAlertLevel = "OK" | "INFO" | "WARN" | "DANGER";

export type RtpAlert = {
  level: RtpAlertLevel;
  code:
    | "OK"
    | "TOO_FEW_PLAYS"
    | "UNKNOWN"
    | "BELOW_DESIGN"
    | "ABOVE_DESIGN"
    | "REMAINING_OVER_100"
    | "SUDDEN_DROP"
    | "SUDDEN_RISE"
    | "LEDGER_MISMATCH";
  /** 画面にそのまま出せる日本語 */
  message: string;
  /** 運営が次にやること */
  advice?: string;
};

export const ALERT_ORDER: Record<RtpAlertLevel, number> = {
  DANGER: 3,
  WARN: 2,
  INFO: 1,
  OK: 0,
};

/**
 * 3つの数字を見て、危ないかどうかを判断する。
 *
 * ★母数を必ず見ること。
 *   設計94％に対して実績80％でも、20回しか引かれていなければ
 *   それは異常ではなく「まだ分からない」です。
 *   回数が足りないときは、良し悪しを言わずに
 *   「データ不足」とだけ伝えます。
 */
export function judgeRtp(args: {
  designed: Rtp;
  remaining: Rtp;
  actual: Rtp;
  /** 直近の実績（前回の集計時点）。急落・急騰を見るために使う */
  previousActualPercent?: number | null;
  /** 台帳（gachas.revenue / paid_value）との突き合わせ結果 */
  ledgerMismatch?: boolean;
}): RtpAlert[] {
  const out: RtpAlert[] = [];
  const { designed, remaining, actual } = args;

  /* ── 分からないものは、分からないと言う ───────────── */
  if (!actual.known) {
    out.push({
      level: actual.code === "BROKEN_DATA" ? "DANGER" : "INFO",
      code: actual.code === "BROKEN_DATA" ? "UNKNOWN" : "TOO_FEW_PLAYS",
      message: `実績還元率：UNKNOWN（${actual.reason}）`,
      advice:
        actual.code === "BROKEN_DATA"
          ? "数字が壊れています。販売を止めて、記録を確認してください。"
          : "販売が進めば表示されます。",
    });
    return out;
  }

  if (actual.plays < MIN_PLAYS_FOR_JUDGEMENT) {
    out.push({
      level: "INFO",
      code: "TOO_FEW_PLAYS",
      message: `まだ ${actual.plays} 回です。${MIN_PLAYS_FOR_JUDGEMENT} 回を超えるまで、良し悪しは判断しません。`,
      advice: "数字は出ていますが、たまたまの振れが大きい段階です。",
    });
    /* ★ここで返すこと。回数が足りないのに警告を出すと、必ず誤報になります */
    return out;
  }

  /* ── 設計値との差 ───────────────────────────── */
  if (designed.known && designed.percent > 0) {
    const sa = actual.percent - designed.percent;
    const haba = Math.abs(sa);

    if (haba >= DANGER_GAP_POINTS) {
      out.push({
        level: "DANGER",
        code: sa < 0 ? "BELOW_DESIGN" : "ABOVE_DESIGN",
        message:
          sa < 0
            ? `実績が設計を ${haba.toFixed(1)} ポイント下回っています（設計 ${designed.percent}％ → 実績 ${actual.percent}％）。`
            : `実績が設計を ${haba.toFixed(1)} ポイント上回っています（設計 ${designed.percent}％ → 実績 ${actual.percent}％）。`,
        advice:
          sa < 0
            ? "お客様への還元が、約束より少なくなっています。販売を止めて、景品の設定を確認してください。"
            : "想定より多く還元しています。赤字が続く恐れがあります。",
      });
    } else if (haba >= WARN_GAP_POINTS) {
      out.push({
        level: "WARN",
        code: sa < 0 ? "BELOW_DESIGN" : "ABOVE_DESIGN",
        message: `実績が設計から ${haba.toFixed(1)} ポイント離れています（設計 ${designed.percent}％ → 実績 ${actual.percent}％）。`,
        advice: "しばらく様子を見てください。差が広がるようなら要確認です。",
      });
    }
  }

  /* ── 残数が100％を超えている ────────────────── */
  if (remaining.known && remaining.percent > REMAINING_DANGER_PERCENT) {
    out.push({
      level: "WARN",
      code: "REMAINING_OVER_100",
      message: `残数還元率が ${remaining.percent}％ です。ここから先は、売るほど損が増えます。`,
      advice: "上位賞が多く残っています。販売を止めるかどうか、ご判断ください。",
    });
  }

  /* ── 急落・急騰 ─────────────────────────────
     ★「前より下がった」だけで騒がないこと。
       抽選なので、上下するのが普通です。
       大きく動いたときだけ知らせます。 */
  const zen = args.previousActualPercent;
  if (typeof zen === "number" && Number.isFinite(zen) && zen > 0) {
    const ugoki = actual.percent - zen;
    if (ugoki <= -DANGER_GAP_POINTS) {
      out.push({
        level: "WARN",
        code: "SUDDEN_DROP",
        message: `実績還元率が急に下がりました（${zen.toFixed(1)}％ → ${actual.percent}％）。`,
        advice: "景品の設定が変わっていないか、確認してください。",
      });
    } else if (ugoki >= DANGER_GAP_POINTS) {
      out.push({
        level: "WARN",
        code: "SUDDEN_RISE",
        message: `実績還元率が急に上がりました（${zen.toFixed(1)}％ → ${actual.percent}％）。`,
        advice: "上位賞が続けて出た可能性があります。",
      });
    }
  }

  /* ── 台帳と合わない ─────────────────────────
     ★これは「どちらが正しいか」の問題ではありません。
       2つの記録が食い違っている、という事実そのものが異常です。 */
  if (args.ledgerMismatch) {
    out.push({
      level: "DANGER",
      code: "LEDGER_MISMATCH",
      message:
        "抽選の記録と、ガチャの集計値が食い違っています。どちらかが壊れています。",
      advice: "販売を止めて、記録を確認してください。数字は信用しないでください。",
    });
  }

  if (out.length === 0) {
    out.push({
      level: "OK",
      code: "OK",
      message: "設計どおりに還元できています。",
    });
  }

  return out;
}

/** いちばん重い警告を1つ返す */
export function worstAlert(alerts: RtpAlert[]): RtpAlert {
  return alerts.reduce(
    (a, b) => (ALERT_ORDER[b.level] > ALERT_ORDER[a.level] ? b : a),
    alerts[0] ?? { level: "OK", code: "OK", message: "" },
  );
}

/**
 * 画面に出す文字。
 *
 * ★UNKNOWN のときに「0.0％」と出さないこと。
 *   ここを1か所にまとめてあるので、画面ごとの書き方の違いで
 *   嘘の0％が出ることはありません。
 */
export function rtpText(r: Rtp): string {
  return r.known ? `${r.percent.toFixed(1)}%` : "UNKNOWN";
}
