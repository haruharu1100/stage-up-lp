import { EXTERNAL_ACTIONS_IMPLEMENTED, EXTERNAL_ACTION_LABEL, externalFlag, type ExternalAction } from './env';

export type GateResult = {
  allowed: false;
  action: ExternalAction;
  flagOn: boolean;
  implemented: boolean;
  reason: string;
  reasonJa: string;
};

/**
 * 外部に影響が出る操作の唯一の入口。
 *
 * 戻り値の型が `allowed: false` の固定になっているのは意図的で、
 * 「条件が揃えば true が返る」という書き方をしない。
 * 送信・架電・応募・納品を実際に行う処理は、このリポジトリのどこにも存在しない。
 * 実装する時は、この関数の型を変えることが必ず差分に出るようにしてある。
 */
export function checkExternalAction(action: ExternalAction): GateResult {
  const flagOn = externalFlag(action);
  const label = EXTERNAL_ACTION_LABEL[action];
  return {
    allowed: false,
    action,
    flagOn,
    implemented: EXTERNAL_ACTIONS_IMPLEMENTED,
    reason: `external action "${action}" is not implemented in this phase`,
    reasonJa: flagOn
      ? `「${label}」のスイッチは入っていますが、実行する処理そのものをまだ作っていないので何も起きません。`
      : `「${label}」は初期値のOFFのままです。実行する処理そのものも作っていません。`,
  };
}

/** 画面や報告に出すための一覧。 */
export function externalActionStatus(): { action: ExternalAction; label: string; flagOn: boolean; implemented: boolean }[] {
  return (['CALL', 'EMAIL', 'FORM', 'APPLY', 'DELIVER'] as ExternalAction[]).map((a) => ({
    action: a,
    label: EXTERNAL_ACTION_LABEL[a],
    flagOn: externalFlag(a),
    implemented: EXTERNAL_ACTIONS_IMPLEMENTED,
  }));
}
