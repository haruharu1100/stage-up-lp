/**
 * バックテストで測る数字の一覧。
 *
 * 「良くなった気がする」で判断しないために、何を上げたくて何を下げたいのかを先に決めておく。
 * バックテストの実行側と、画面に出す側の両方がここを見る。
 */
export const METRIC_DEFS: { key: string; label: string; want: 'up' | 'down' | 'flat' }[] = [
  { key: 'companies', label: '会社の件数', want: 'flat' },
  // ★このシステムで一番大事な数字。ほかがどれだけ良くなっても、ここが0でなければ全部やり直し。
  //   別会社のHP・電話・メールを1件でも営業候補に通したら、送った先で取り返しがつかない。
  { key: 'wrong_link_leaked', label: '★別会社の連絡先を営業候補へ通した件数（0でなければ重大不具合）', want: 'down' },
  { key: 'wrong_link_rate', label: '★別会社の連絡先を営業候補へ通した割合(%)', want: 'down' },
  { key: 'analyzed_rate', label: '会社を読み取れた割合(%)', want: 'up' },
  { key: 'offer_matched_rate', label: '売る商品が決まった割合(%)', want: 'up' },
  { key: 'contactable_rate', label: '連絡先が使える割合(%)', want: 'up' },
  { key: 'draft_ready_rate', label: '使える文面の割合(%)', want: 'up' },
  { key: 'draft_similarity_avg', label: '文面の使い回し度合い(平均・止めた文も含む)', want: 'down' },
  { key: 'draft_similarity_ready_avg', label: '実際に出す文面の使い回し度合い(平均)', want: 'down' },
  { key: 'draft_expression_ng', label: '表現で引っかかった文面の数', want: 'down' },
  // ★HPの取り違えは、このシステムで一番大きい事故。上げたいのは「確認できた割合」、
  //   下げたいのは「確かめずに使っている割合」。外した件数は0を目指す数字ではない
  //   （外せたということは、事故を1件止めたということ）。
  { key: 'website_verified_rate', label: 'HPが本人のものと確認できた会社の割合(%)', want: 'up' },
  { key: 'website_unverified_rate', label: '確かめずにHPを使っている会社の割合(%)', want: 'down' },
  { key: 'website_rejected', label: '別会社のHPだったので外した件数', want: 'flat' },
  { key: 'jobs', label: '案件の件数', want: 'flat' },
  { key: 'job_exclude_rate', label: '受けない案件の割合(%)', want: 'flat' },
  { key: 'job_apply_rate', label: '応募したい案件の割合(%)', want: 'up' },
  { key: 'job_duplicate_rate', label: '同じ内容が重複して載っていた案件の割合(%)', want: 'flat' },
  { key: 'proposal_ready_rate', label: '使える応募文の割合(%)', want: 'up' },
  { key: 'proposal_ready_rate_unique', label: '重複を除いた依頼のうち応募文ができた割合(%)', want: 'up' },
  { key: 'proposal_similarity_avg', label: '応募文の使い回し度合い(平均・止めた文も含む)', want: 'down' },
  { key: 'proposal_similarity_ready_avg', label: '実際に出す応募文の使い回し度合い(平均)', want: 'down' },
  { key: 'job_hourly_avg', label: '応募したい案件の平均時給(円)', want: 'up' },
  // ★取りに行く順番の質。上位に置いた案件が本当に割の良い案件かを見る。
  { key: 'job_top10_hourly_avg', label: '取りに行く順の上位10件の平均時給(円)', want: 'up' },
  { key: 'job_top10_hours_avg', label: '取りに行く順の上位10件の平均作業時間(h)', want: 'down' },
  { key: 'job_revision_risk_avg', label: '応募したい案件の手直しの起きやすさ(平均)', want: 'down' },
  { key: 'job_estimate_low_rate', label: '見積りが短すぎる疑いのある案件の割合(%)', want: 'down' },
  { key: 'auto_apply_unknown_rate', label: '規約が未確認で自動応募を止めた割合(%)', want: 'down' },
  { key: 'executed_outreach', label: '実際に送信した件数', want: 'flat' },
  { key: 'executed_applications', label: '実際に応募した件数', want: 'flat' },
];

export const METRIC_LABEL = new Map(METRIC_DEFS.map((m) => [m.key, m.label]));
