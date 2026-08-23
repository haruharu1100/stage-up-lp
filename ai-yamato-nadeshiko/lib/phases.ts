/**
 * 順番ゲート — 「まだやってはいけないこと」を機械で止める。
 *
 * ★なぜ必要か
 *   名前・顔・投稿は、後戻りのコストが段違いに違う。
 *     名前を変える  → 顔も投稿もアカウント名も全部やり直し
 *     顔を変える    → 投稿画像が全部やり直し
 *     投稿を変える  → その週だけやり直し
 *   だから必ず「名前 → 顔 → 投稿」の順に確定させる。
 *   逆順や同時進行をやると、上流が動いた瞬間に下流が全部ゴミになる。
 *
 * ★今の最大のボトルネックはコードではない
 *   商標・同名調査の実測8項目（data/identity-screening.csv）。
 *   これが埋まるまで、新しい機能を足しても前に進まない。
 *   ここではその状態を「機械が読める形」にして、先へ進もうとしたら止める。
 *
 * ★止めないもの
 *   下書き・テストコード・ドキュメント・調査。
 *   これらは後戻りコストが無いので、いつやってもよい。
 */
import {
  CHARACTER_IDENTITY,
  decideLock,
  type CharacterIdentity,
  type ScreeningItem,
} from "./identity.js";
import { loadScreening, remainingRequired } from "./screening.js";

// ---------------------------------------------------------------------------
// 何をしようとしているか
// ---------------------------------------------------------------------------

export type Action =
  /** 名前を LOCKED にする（人が lib/identity.ts を編集する） */
  | "LOCK_IDENTITY"
  /** 基準顔の候補8枚を生成する */
  | "GENERATE_FACE_CANDIDATES"
  /** 選んだ1枚を基準顔として確定する */
  | "LOCK_REFERENCE_FACE"
  /** 顔一致率をローカルで実測する処理を実装する */
  | "BUILD_FACE_MATCHER"
  /** 第1週21投稿を作る・作り直す */
  | "GENERATE_WEEK_POSTS"
  /** X本番プロフィールを用意する（公開はしない） */
  | "PREPARE_X_PROFILE"
  /** 下書き・テスト・ドキュメント */
  | "WRITE_DRAFTS_AND_TESTS";

export const ACTION_LABEL: Record<Action, string> = {
  LOCK_IDENTITY: "名前を確定する",
  GENERATE_FACE_CANDIDATES: "基準顔の候補8枚を作る",
  LOCK_REFERENCE_FACE: "基準顔を1枚に確定する",
  BUILD_FACE_MATCHER: "顔一致率を実測する処理を作る",
  GENERATE_WEEK_POSTS: "第1週21投稿を作る",
  PREPARE_X_PROFILE: "X本番プロフィールを用意する",
  WRITE_DRAFTS_AND_TESTS: "下書き・テストコード・ドキュメントを書く",
};

// ---------------------------------------------------------------------------
// 判定に使う「今の状態」
// ---------------------------------------------------------------------------

export interface WorldState {
  identity: CharacterIdentity;
  screening: ScreeningItem[];
  /**
   * 顔一致率を画像から実測する処理が存在するか。
   * ★人が「作った」と言うだけでは true にしない。
   *   回帰テスト（同一人物の別カット=PASS / 別人物=FAIL）が通って初めて true。
   */
  faceMatcherReady: boolean;
}

export function currentState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    identity: CHARACTER_IDENTITY,
    screening: loadScreening(),
    faceMatcherReady: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

export interface Verdict {
  action: Action;
  allowed: boolean;
  /** 止まっている理由。allowed=true なら空 */
  blockers: string[];
  /** 今この状況で人が次にやること */
  nextStep: string;
}

const REQUIRED_HINT =
  "npm run identity:check で残りを確認 → data/identity-screening.csv に確認日と出典URLを書く";

/**
 * 名前を確定してよいか（NAME_LOCK ゲート）。
 * 商標・同名の実測がここに効く。IDが空いているかは名前の正しさとは別問題なので見ない。
 */
function nameLockBlockers(screening: ScreeningItem[]): string[] {
  const decision = decideLock(screening);
  if (decision.suggested === "REJECTED") {
    return [
      `商標調査で重大な衝突が見つかっています（${decision.conflicts.map((c) => c.id).join(", ")}）。` +
        `この名前は使わず、名前候補フェーズへ戻してください`,
    ];
  }
  const remaining = remainingRequired(screening, ["NAME_LOCK"]);
  if (remaining.length > 0) {
    return [
      `商標・同名調査の必須項目が${remaining.length}件まだ実測されていません` +
        `（${remaining.map((r) => r.id).join(", ")}）。人が埋めるまで先へ進めません`,
    ];
  }
  return [];
}

/**
 * 本番アカウントを作れるか（ACCOUNT ゲート）。
 *
 * ★基準顔の生成前にここを見る理由
 *   IDが1つも取れないと分かった時、取れる名前へ変える判断があり得る。
 *   その時に基準顔を作り終えていると、顔ごと作り直しになる。
 *   顔は後戻りのコストが一番高いので、先に「その名前で世に出られるか」を確かめる。
 */
function accountBlockers(screening: ScreeningItem[]): string[] {
  const remaining = remainingRequired(screening, ["ACCOUNT"]);
  if (remaining.length === 0) return [];
  return remaining.map(
    (r) =>
      `${r.registry} が未確認。` +
      (r.humanOnly
        ? "スクレイピング禁止・ブラウザ自動操作禁止のため機械では調べられません。人が目視で空きを確認してください"
        : "確認してから進めてください"),
  );
}

export function can(action: Action, state: WorldState = currentState()): Verdict {
  const { identity, screening, faceMatcherReady } = state;
  const blockers: string[] = [];

  const nameLocked = identity.identity_status === "LOCKED";
  const faceLocked = identity.reference_face_status === "LOCKED";
  const faceGenerated = identity.reference_face_status !== "NOT_GENERATED";

  switch (action) {
    // 後戻りコストが無いので、いつでもやってよい
    case "WRITE_DRAFTS_AND_TESTS":
      break;

    case "LOCK_IDENTITY":
      // ★名前の確定を止めるのは NAME_LOCK ゲートだけ。
      //   IDが空いているかは「その名前が正しいか」とは無関係なのでここでは見ない。
      blockers.push(...nameLockBlockers(screening));
      if (identity.identity_status === "REJECTED") {
        blockers.push("名前が REJECTED です。この名前は確定できません");
      }
      break;

    case "GENERATE_FACE_CANDIDATES":
      blockers.push(...nameLockBlockers(screening));
      // ★ここで初めて ACCOUNT ゲートを見る。
      //   IDが1つも取れないと分かれば名前を変える判断があり得るが、
      //   その時に顔を作り終えていると顔ごと捨てになる。顔が一番戻れない。
      blockers.push(...accountBlockers(screening));
      if (!nameLocked) {
        blockers.push(
          `名前がまだ ${identity.identity_status} です。基準顔は一度選ぶと全投稿がそれに縛られるため、名前が動く可能性がある状態では作りません`,
        );
      }
      break;

    case "LOCK_REFERENCE_FACE":
      if (!nameLocked) blockers.push(`名前がまだ ${identity.identity_status} です`);
      if (!faceGenerated) blockers.push("候補8枚がまだ生成されていません");
      // ★人が選ぶ以外の方法で確定させない。機械が「一番スコアが高い1枚」を選ばない
      break;

    case "BUILD_FACE_MATCHER":
      if (!faceLocked) {
        blockers.push(
          `基準顔がまだ ${identity.reference_face_status} です。比べる相手が決まっていないと一致率は測れません`,
        );
      }
      break;

    case "GENERATE_WEEK_POSTS":
      blockers.push(...nameLockBlockers(screening));
      blockers.push(...accountBlockers(screening));
      if (!nameLocked) blockers.push(`名前がまだ ${identity.identity_status} です`);
      if (!faceLocked) blockers.push(`基準顔がまだ ${identity.reference_face_status} です`);
      if (!faceMatcherReady) {
        blockers.push(
          "顔一致率を実測する処理がまだ通っていません（同一人物の別カットでPASS・別人物でFAILする回帰テストが必要）",
        );
      }
      break;

    case "PREPARE_X_PROFILE":
      if (!nameLocked) blockers.push(`名前がまだ ${identity.identity_status} です`);
      if (!faceLocked) blockers.push(`基準顔がまだ ${identity.reference_face_status} です`);
      break;
  }

  return {
    action,
    allowed: blockers.length === 0,
    blockers,
    nextStep: nextStepFor(state),
  };
}

/** 今この状況で、人が次にやるべきたった1つのこと */
export function nextStepFor(state: WorldState = currentState()): string {
  const { identity, screening, faceMatcherReady } = state;

  const decision = decideLock(screening);
  if (decision.suggested === "REJECTED") {
    return "名前候補フェーズへ戻す（この名前は使わない）";
  }
  const remaining = remainingRequired(screening);
  if (remaining.length > 0) {
    return `【人がやる】商標・同名調査の残り${remaining.length}件を実測する（${remaining.map((r) => r.id).join(", ")}）。${REQUIRED_HINT}`;
  }
  if (identity.identity_status !== "LOCKED") {
    return "【人がやる】lib/identity.ts の identity_status を LOCKED にする";
  }
  if (identity.reference_face_status === "NOT_GENERATED") {
    return "npm run faces:prompts → ai-influencer/ で候補8枚を生成する";
  }
  if (identity.reference_face_status !== "LOCKED") {
    return "【人がやる】8枚から1枚を選び、lib/identity.ts の reference_face_status を LOCKED にする";
  }
  if (!faceMatcherReady) {
    return "顔一致率を画像から実測する処理を実装し、同一人物=PASS・別人物=FAIL の回帰テストを通す";
  }
  return "第1週21投稿を作り直す（古い仮名・古い顔・旧Character IDが残っていないか全体検索で確認する）";
}

// ---------------------------------------------------------------------------
// スクリプトから使う番人
// ---------------------------------------------------------------------------

/**
 * 禁止されている操作なら、理由を出してプロセスを止める。
 * ★ここを try/catch で握りつぶさない。止まることが仕事。
 */
export function requireAllowed(action: Action, state: WorldState = currentState()): void {
  const v = can(action, state);
  if (v.allowed) return;

  console.error("");
  console.error("=".repeat(76));
  console.error(`［停止］まだ「${ACTION_LABEL[action]}」はできません。`);
  console.error("=".repeat(76));
  console.error("");
  console.error("■ 理由");
  for (const b of v.blockers) console.error(`  ・${b}`);
  console.error("");
  console.error("■ 次にやること");
  console.error(`  ${v.nextStep}`);
  console.error("");
  console.error("■ 今やってよいこと");
  console.error("  下書き・テストコード・ドキュメント・調査（後戻りのコストが無いもの）");
  console.error("");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 全体の進み具合
// ---------------------------------------------------------------------------

export interface StepStatus {
  step: number;
  label: string;
  /** 人にしかできない工程か */
  humanOnly: boolean;
  done: boolean;
}

/** ユーザーが指定した8段階。この順番以外では進めない */
export function orderedSteps(state: WorldState = currentState()): StepStatus[] {
  const { identity, screening, faceMatcherReady } = state;
  const remaining = remainingRequired(screening);
  const nameLocked = identity.identity_status === "LOCKED";
  const faceLocked = identity.reference_face_status === "LOCKED";

  return [
    {
      step: 1,
      label: "商標・同名調査8項目を実測で埋める（確認日＋出典URL必須）",
      humanOnly: true,
      done: remaining.length === 0,
    },
    { step: 2, label: "衝突なしを確認して名前を確定する", humanOnly: true, done: nameLocked },
    {
      step: 3,
      label: "基準顔の候補8枚を生成する",
      humanOnly: false,
      done: identity.reference_face_status !== "NOT_GENERATED",
    },
    { step: 4, label: "人が1枚を基準顔として選ぶ", humanOnly: true, done: faceLocked },
    {
      step: 5,
      label: "顔一致率を画像から実測するローカル処理を実装する",
      humanOnly: false,
      done: faceMatcherReady,
    },
    { step: 6, label: "顔固定の回帰テストを通す（同一人物=PASS / 別人物=FAIL）", humanOnly: false, done: faceMatcherReady },
    { step: 7, label: "第1週21投稿を作り直す", humanOnly: false, done: false },
    { step: 8, label: "判断・理由・テスト結果を事業Vaultへ保存する", humanOnly: false, done: false },
  ];
}
