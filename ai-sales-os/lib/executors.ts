import { EXTERNAL_ACTIONS_IMPLEMENTED, EXTERNAL_ACTION_LABEL, type ExternalAction } from './env';
import { canReachExecutor, isReal, toOrigin, type DataOrigin } from './origin';
import { checkExternalAction } from './gate';

/**
 * 外部への操作の「差し込み口」。
 *
 * ★ここには DryRun（何もしない）版しか置かない。
 *   実際に電話をかける／メールを送る／フォームを送信する／案件に応募する／納品する、
 *   という処理コードはこのファイルにも、このリポジトリのどこにも無い。
 *
 * ★なぜ差し込み口だけ先に作るのか。
 *   「送るとしたら、どの会社に、どの番号へ、何を、どんな根拠で送るのか」を
 *   先に全部見えるようにしておかないと、実装したその日に事故が起きる。
 *   先に中身を人が読んで、間違いが無いと分かってから実装する。
 *
 * ★守る決まりごと（コードで守る。設定では守らない）
 *   ① 練習用（TEST）のデータは、人が承認しても Executor へ渡らない。
 *   ② 実行を名乗る版を作るときは、この型を変えないと作れない。差分に必ず出る。
 *   ③ executed は常に false。DryRun しか無いので true になりようがない。
 */

export type ExecutorKind = 'DRY_RUN' | 'LIVE';

/** 送るとしたら何が起きるか、を1件ぶんまとめたもの。 */
export type ExecutionPlan = {
  action: ExternalAction;
  dataOrigin: DataOrigin;
  refTable: string;
  refId: number;
  /** 相手の名前（会社名 または 案件名）。人が読んで「違う会社だ」と気づけるように必ず入れる。 */
  subjectName: string;
  corporateNumber: string | null;
  /** どこへ送るか。電話番号・メール・フォームURL・応募先URL。 */
  channelTarget: string | null;
  offerCode: string | null;
  offerName: string | null;
  /** 送る文章、または電話の台本。 */
  body: string;
  /** なぜこの会社にこれを送るのか、の根拠。確認できた事実だけを入れる。 */
  evidence: string[];
  score: number | null;
};

export type ExecutionResult = {
  kind: ExecutorKind;
  action: ExternalAction;
  /** 実際に外部へ何かをしたか。★DryRunしか無いので常に false。 */
  executed: false;
  /** 送れない理由。1つでもあれば送らない。 */
  blockReasons: string[];
  /** 人の1クリック承認が必要か。 */
  needsApproval: boolean;
  /** 人が読んで確かめるための説明。 */
  preview: string;
  plan: ExecutionPlan;
};

/**
 * すべての Executor が守る形。
 * ★execute は必ず executed:false を返す型にしてある。
 *   実際に送る版を作るときは、この型そのものを変えないと作れない。
 */
export interface Executor {
  readonly kind: ExecutorKind;
  readonly action: ExternalAction;
  execute(plan: ExecutionPlan): Promise<ExecutionResult>;
}

/**
 * 送ってよいかの共通検査。
 * ★どの Executor もこれを必ず通る。個別に判断させない。
 */
export function preflight(plan: ExecutionPlan): { blockReasons: string[]; needsApproval: boolean } {
  const blockReasons: string[] = [];

  // ① 練習用データは、人が承認しても外部へ進めない。
  const origin = canReachExecutor(plan.dataOrigin);
  if (!origin.ok) blockReasons.push(origin.reason);

  // ② 実行する処理コードが無い。これが今の一番の理由。
  const gate = checkExternalAction(plan.action);
  blockReasons.push(gate.reasonJa);

  // ③ 送り先が無い。
  if (!plan.channelTarget) {
    blockReasons.push(`${EXTERNAL_ACTION_LABEL[plan.action]}の送り先（電話番号・メール・URL）が無い。`);
  }

  // ④ 文章が無い、または短すぎる。
  if (plan.body.trim().length < 30) {
    blockReasons.push('送る文章がまだ用意できていない。');
  }

  // ⑤ 根拠が無い。
  //   「なぜこの会社に送るのか」を1つも言えないものは送らない。
  if (plan.evidence.length === 0) {
    blockReasons.push('なぜこの会社に送るのかの根拠が1つも無い。');
  }

  return { blockReasons, needsApproval: true };
}

/** 人が読んで確かめるための説明を作る。 */
export function buildPreview(plan: ExecutionPlan, blockReasons: string[]): string {
  const lines: string[] = [];
  lines.push(`【${EXTERNAL_ACTION_LABEL[plan.action]}／${isReal(plan.dataOrigin) ? 'REAL' : 'TEST（送信不可）'}】`);
  lines.push(`会社・案件: ${plan.subjectName}`);
  lines.push(`法人番号  : ${plan.corporateNumber ?? '—（取れていない）'}`);
  lines.push(`送り先    : ${plan.channelTarget ?? '—（取れていない）'}`);
  lines.push(`営業商品  : ${plan.offerName ?? '—（決まっていない）'}${plan.offerCode ? `（${plan.offerCode}）` : ''}`);
  lines.push(`点数      : ${plan.score === null ? '—' : plan.score}`);
  lines.push('根拠:');
  if (plan.evidence.length === 0) lines.push('  —（1つも無い）');
  for (const e of plan.evidence) lines.push(`  ・${e}`);
  lines.push('本文または台本:');
  for (const l of plan.body.split('\n')) lines.push(`  ${l}`);
  lines.push('送れない理由:');
  for (const b of blockReasons) lines.push(`  ・${b}`);
  return lines.join('\n');
}

/**
 * 何もしない Executor。
 * ★これがこのシステムにある唯一の Executor。
 */
abstract class DryRunExecutor implements Executor {
  readonly kind = 'DRY_RUN' as const;
  abstract readonly action: ExternalAction;

  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    const { blockReasons, needsApproval } = preflight(plan);
    // ★ここに「送る」処理は無い。fetch も、外部のライブラリ呼び出しも無い。
    return {
      kind: this.kind,
      action: this.action,
      executed: false,
      blockReasons,
      needsApproval,
      preview: buildPreview(plan, blockReasons),
      plan,
    };
  }
}

export class DryRunCallExecutor extends DryRunExecutor {
  readonly action = 'CALL' as const;
}
export class DryRunEmailExecutor extends DryRunExecutor {
  readonly action = 'EMAIL' as const;
}
export class DryRunFormExecutor extends DryRunExecutor {
  readonly action = 'FORM' as const;
}
export class DryRunApplicationExecutor extends DryRunExecutor {
  readonly action = 'APPLY' as const;
}
export class DryRunDeliveryExecutor extends DryRunExecutor {
  readonly action = 'DELIVER' as const;
}

/**
 * 使う Executor を選ぶ。
 * ★今は必ず DryRun が返る。実行版は存在しないので選びようがない。
 */
export function executorFor(action: ExternalAction): Executor {
  switch (action) {
    case 'CALL':
      return new DryRunCallExecutor();
    case 'EMAIL':
      return new DryRunEmailExecutor();
    case 'FORM':
      return new DryRunFormExecutor();
    case 'APPLY':
      return new DryRunApplicationExecutor();
    case 'DELIVER':
      return new DryRunDeliveryExecutor();
  }
}

/** 画面と報告に出すための一覧。 */
export function executorInventory(): { action: ExternalAction; label: string; kind: ExecutorKind; liveExists: boolean }[] {
  return (['CALL', 'EMAIL', 'FORM', 'APPLY', 'DELIVER'] as ExternalAction[]).map((a) => ({
    action: a,
    label: EXTERNAL_ACTION_LABEL[a],
    kind: executorFor(a).kind,
    // ★実行版が存在するか。EXTERNAL_ACTIONS_IMPLEMENTED は false 固定なので必ず false。
    liveExists: EXTERNAL_ACTIONS_IMPLEMENTED,
  }));
}

/** DBの行から計画を作るときに使う。data_origin を取り違えないための入口。 */
export function planOriginFrom(row: { data_origin?: unknown }): DataOrigin {
  return toOrigin(row.data_origin);
}
