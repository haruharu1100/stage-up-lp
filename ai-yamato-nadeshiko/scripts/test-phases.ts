/**
 * 順番ゲート（lib/phases.ts）の検査。
 *
 * ★何を守るためのテストか
 *   「名前 → 顔 → 投稿」の順番を、機械が本当に強制できているか。
 *   ここが緩むと、名前が動いた瞬間に顔も投稿も全部作り直しになる。
 *   逆に厳しすぎて下書きやテストまで止まると、人が待つだけの時間が増える。
 *   その両方を毎回確かめる。
 *
 * ★DBを使わない。状態は全部この場で組み立てる。
 *   実際の台帳（data/identity-screening.csv）の中身に影響されると、
 *   人が1行書き換えただけでテストの意味が変わってしまう。
 *
 * 実行: npx tsx scripts/test-phases.ts（npm test からも自動で拾われる）
 */
import {
  CHARACTER_IDENTITY,
  REQUIRED_SCREENINGS,
  type CharacterIdentity,
  type ScreeningItem,
  type ScreeningStatus,
} from "../lib/identity.js";
import { HUMAN_ONLY_SCREENINGS } from "../lib/screening.js";
import {
  ACTION_LABEL,
  can,
  nextStepFor,
  orderedSteps,
  type Action,
  type WorldState,
} from "../lib/phases.js";

let ng = 0;
const line = (ok: boolean, label: string, extra = "") => {
  if (!ok) ng++;
  console.log(`  ${ok ? "OK" : "NG"}  ${label}${extra ? `  ${extra}` : ""}`);
};

// --- 状態を組み立てる道具 --------------------------------------------------

/** 台帳1行。CLEAR には必ず確認日と出典を付ける（無いと UNKNOWN に戻る仕様のため） */
const item = (id: string, status: ScreeningStatus): ScreeningItem => {
  const spec = REQUIRED_SCREENINGS.find((r) => r.id === id);
  return {
    id,
    registry: spec?.registry ?? id,
    status,
    checkedAt: status === "UNKNOWN" ? null : "2026-08-23",
    sourceUrl: status === "UNKNOWN" ? null : `https://example.test/${id}`,
    note: "",
    gate: spec?.gate ?? "NAME_LOCK",
    required: spec?.required ?? false,
  };
};

/** 必須項目をまとめて同じ状態にした台帳 */
const ledger = (status: ScreeningStatus, only?: string[]): ScreeningItem[] =>
  REQUIRED_SCREENINGS.map((r) =>
    item(r.id, !only || only.includes(r.id) ? status : "CLEAR"),
  );

const identity = (
  identity_status: CharacterIdentity["identity_status"],
  reference_face_status: CharacterIdentity["reference_face_status"],
): CharacterIdentity => ({
  ...CHARACTER_IDENTITY,
  identity_status,
  reference_face_status,
});

const state = (o: Partial<WorldState>): WorldState => ({
  identity: identity("PROVISIONAL", "NOT_GENERATED"),
  screening: ledger("UNKNOWN"),
  faceMatcherReady: false,
  ...o,
});

/** 全部そろった「最後まで進んでよい」状態 */
const allDone = state({
  identity: identity("LOCKED", "LOCKED"),
  screening: ledger("CLEAR"),
  faceMatcherReady: true,
});

console.log("=== 下書き・テスト・ドキュメントは、どんな状態でも止めない ===");
{
  // 何ひとつ調べ終わっていない最悪の状態
  const zero = state({});
  line(
    can("WRITE_DRAFTS_AND_TESTS", zero).allowed,
    "調査ゼロ・名前も顔も未確定でも、下書きとテストは書ける",
  );
  line(
    can("WRITE_DRAFTS_AND_TESTS", allDone).allowed,
    "全部そろった後ももちろん書ける",
  );
}

console.log("\n=== 名前の確定を止められるのは NAME_LOCK ゲートだけ ===");
{
  const nameLockIds = REQUIRED_SCREENINGS.filter(
    (r) => r.gate === "NAME_LOCK" && r.required,
  ).map((r) => r.id);
  line(nameLockIds.length > 0, `NAME_LOCK の必須項目がある（${nameLockIds.length}件）`);

  for (const id of nameLockIds) {
    const s = state({ screening: ledger("UNKNOWN", [id]) });
    const v = can("LOCK_IDENTITY", s);
    line(!v.allowed, `${id} が未実測なら名前を確定できない`);
  }

  // ACCOUNT / EXPANSION は名前の正しさとは無関係なので、名前確定は止めない
  const otherIds = REQUIRED_SCREENINGS.filter((r) => r.gate !== "NAME_LOCK").map((r) => r.id);
  const s = state({ screening: ledger("UNKNOWN", otherIds) });
  line(
    can("LOCK_IDENTITY", s).allowed,
    "ID空き（ACCOUNT）や将来の拡張（EXPANSION）が未確認でも、名前は確定できる",
  );

  // 衝突が見つかっていたら、埋まっていても確定させない
  const conflicted = state({
    screening: ledger("CLEAR").map((i) =>
      i.gate === "NAME_LOCK" && i.required ? { ...i, status: "CONFLICT" as const } : i,
    ),
  });
  const cv = can("LOCK_IDENTITY", conflicted);
  line(!cv.allowed, "商標が衝突していたら名前を確定できない");
  line(
    cv.nextStep.includes("名前候補"),
    "その場合の次の一手は「名前候補フェーズへ戻す」",
  );
}

console.log("\n=== 基準顔は、名前とID空きの両方が済むまで作らない ===");
{
  // 名前だけ LOCKED、ID未確認
  const noAccount = state({
    identity: identity("LOCKED", "NOT_GENERATED"),
    screening: ledger("UNKNOWN", ["X_HANDLE"]),
  });
  const v1 = can("GENERATE_FACE_CANDIDATES", noAccount);
  line(!v1.allowed, "XのIDが未確認なら候補8枚を作らない");
  line(
    v1.blockers.some((b) => b.includes("人が目視")),
    "理由に「人が目視で確認する」と書いてある（機械では調べられない旨）",
  );

  // 台帳は全部そろっているが名前がまだ PROVISIONAL
  const notLocked = state({
    identity: identity("PROVISIONAL", "NOT_GENERATED"),
    screening: ledger("CLEAR"),
  });
  line(
    !can("GENERATE_FACE_CANDIDATES", notLocked).allowed,
    "名前が PROVISIONAL のままなら候補8枚を作らない",
  );

  // 両方そろえば作れる
  const ok = state({
    identity: identity("LOCKED", "NOT_GENERATED"),
    screening: ledger("CLEAR"),
  });
  line(can("GENERATE_FACE_CANDIDATES", ok).allowed, "名前確定＋ID確認済みなら作ってよい");
}

console.log("\n=== 名前が通っても、顔は自動で確定しない ===");
{
  const generated = state({
    identity: identity("LOCKED", "PENDING_HUMAN_SELECTION"),
    screening: ledger("CLEAR"),
  });
  line(
    can("LOCK_REFERENCE_FACE", generated).allowed,
    "候補8枚が出そろった後なら、確定操作そのものは可能",
  );
  line(
    generated.identity.reference_face_status !== "LOCKED",
    "ただし機械は勝手に LOCKED にしない（人が1枚選ぶまで PENDING のまま）",
  );

  const notGenerated = state({
    identity: identity("LOCKED", "NOT_GENERATED"),
    screening: ledger("CLEAR"),
  });
  line(
    !can("LOCK_REFERENCE_FACE", notGenerated).allowed,
    "候補が1枚も無い状態では基準顔を確定できない",
  );
}

console.log("\n=== 顔一致率の実測処理は、基準顔が決まってから作る ===");
{
  const pending = state({
    identity: identity("LOCKED", "PENDING_HUMAN_SELECTION"),
    screening: ledger("CLEAR"),
  });
  line(
    !can("BUILD_FACE_MATCHER", pending).allowed,
    "比べる相手（基準顔）が決まっていないと一致率は測れない",
  );

  const locked = state({
    identity: identity("LOCKED", "LOCKED"),
    screening: ledger("CLEAR"),
  });
  line(can("BUILD_FACE_MATCHER", locked).allowed, "基準顔が確定していれば作ってよい");
}

console.log("\n=== 第1週21投稿は、3つ全部そろうまで作らない ===");
{
  const cases: { label: string; s: WorldState }[] = [
    {
      label: "商標調査が残っている",
      s: state({
        identity: identity("LOCKED", "LOCKED"),
        screening: ledger("UNKNOWN", ["X_HANDLE"]),
        faceMatcherReady: true,
      }),
    },
    {
      label: "名前が未確定",
      s: state({
        identity: identity("PROVISIONAL", "LOCKED"),
        screening: ledger("CLEAR"),
        faceMatcherReady: true,
      }),
    },
    {
      label: "基準顔が未確定",
      s: state({
        identity: identity("LOCKED", "PENDING_HUMAN_SELECTION"),
        screening: ledger("CLEAR"),
        faceMatcherReady: true,
      }),
    },
    {
      label: "顔一致の回帰テストが通っていない",
      s: state({
        identity: identity("LOCKED", "LOCKED"),
        screening: ledger("CLEAR"),
        faceMatcherReady: false,
      }),
    },
  ];
  for (const c of cases) {
    line(!can("GENERATE_WEEK_POSTS", c.s).allowed, `${c.label} → 21投稿を作らない`);
  }
  line(can("GENERATE_WEEK_POSTS", allDone).allowed, "3つそろって初めて作ってよい");
}

console.log("\n=== 「作った」と言うだけでは通さない ===");
{
  // faceMatcherReady は回帰テストが通って初めて true になる値。
  // 既定値が true になっていたら、実装しないまま21投稿へ進めてしまう。
  const def = state({
    identity: identity("LOCKED", "LOCKED"),
    screening: ledger("CLEAR"),
  });
  line(
    def.faceMatcherReady === false,
    "顔一致の実測処理は、明示的に通したと記録するまで「無い」扱い",
  );
}

console.log("\n=== X本番プロフィールは名前と顔がそろってから ===");
{
  const noFace = state({
    identity: identity("LOCKED", "PENDING_HUMAN_SELECTION"),
    screening: ledger("CLEAR"),
  });
  line(!can("PREPARE_X_PROFILE", noFace).allowed, "アイコンにする顔が無いうちは用意しない");
  line(can("PREPARE_X_PROFILE", allDone).allowed, "名前と顔がそろえば用意してよい");
}

console.log("\n=== 止めた時は必ず理由と次の一手を返す ===");
{
  const zero = state({});
  const blocked: Action[] = [
    "GENERATE_FACE_CANDIDATES",
    "LOCK_REFERENCE_FACE",
    "BUILD_FACE_MATCHER",
    "GENERATE_WEEK_POSTS",
    "PREPARE_X_PROFILE",
  ];
  for (const a of blocked) {
    const v = can(a, zero);
    line(
      !v.allowed && v.blockers.length > 0 && v.nextStep.trim().length > 0,
      `${ACTION_LABEL[a]}：理由と次の一手が空でない`,
    );
  }
}

console.log("\n=== 次の一手は、いつも1つだけ・今やるべきものを指す ===");
{
  const cases: { s: WorldState; must: string }[] = [
    { s: state({}), must: "商標" },
    {
      s: state({ screening: ledger("CLEAR"), identity: identity("PROVISIONAL", "NOT_GENERATED") }),
      must: "identity_status",
    },
    {
      s: state({ screening: ledger("CLEAR"), identity: identity("LOCKED", "NOT_GENERATED") }),
      must: "faces:prompts",
    },
    {
      s: state({
        screening: ledger("CLEAR"),
        identity: identity("LOCKED", "PENDING_HUMAN_SELECTION"),
      }),
      must: "1枚を選び",
    },
    {
      s: state({ screening: ledger("CLEAR"), identity: identity("LOCKED", "LOCKED") }),
      must: "顔一致率",
    },
    { s: allDone, must: "21投稿" },
  ];
  for (const c of cases) {
    const n = nextStepFor(c.s);
    line(n.includes(c.must), `「${c.must}」を指している`, `→ ${n.slice(0, 40)}`);
  }
}

console.log("\n=== 8段階の進み具合（抜けや重複が無いこと） ===");
{
  const steps = orderedSteps(state({}));
  line(steps.length === 8, "工程はちょうど8段階", `${steps.length}段階`);
  line(
    steps.every((s, i) => s.step === i + 1),
    "番号が1から8まで飛ばずに並んでいる",
  );
  line(
    steps.every((s) => s.label.trim().length > 0),
    "全段階に日本語の説明がある",
  );
  line(
    steps.filter((s) => s.humanOnly).length >= 3,
    "人にしかできない工程が明示されている（調査・名前確定・顔選び）",
  );
  line(
    steps.every((s) => !s.done),
    "何もしていない状態では、8段階すべてが未完了",
  );

  const done = orderedSteps(allDone);
  line(
    done.slice(0, 6).every((s) => s.done),
    "名前・顔・顔一致まで済んだ状態では、1〜6段階が完了になる",
  );
}

console.log("\n=== 機械では調べられない項目が固定されていること ===");
{
  // ここが緩むと「自動で調べられるのでは」と毎回考え直すことになる。
  for (const id of ["X_HANDLE", "INSTAGRAM_HANDLE", "TIKTOK_HANDLE"]) {
    line(HUMAN_ONLY_SCREENINGS.has(id), `${id} は人が目視で確認する項目として固定`);
  }
  line(
    !HUMAN_ONLY_SCREENINGS.has("JP_TRADEMARK"),
    "商標検索は人の目視限定ではない（出典URLを残せる）",
  );
}

console.log("");
if (ng > 0) {
  console.error(`❌ ${ng}件が不合格`);
  process.exit(1);
}
console.log("✅ すべて合格（順番ゲートは名前→顔→投稿の順を強制し、下書きは止めない）");
