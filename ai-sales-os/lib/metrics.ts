/**
 * バックテストで測る数字の一覧。
 *
 * 「良くなった気がする」で判断しないために、何を上げたくて何を下げたいのかを先に決めておく。
 * バックテストの実行側と、画面に出す側の両方がここを見る。
 */
export const METRIC_DEFS: { key: string; label: string; want: 'up' | 'down' | 'flat' }[] = [
  { key: 'companies', label: '会社の件数', want: 'flat' },
  { key: 'analyzed_rate', label: '会社を読み取れた割合(%)', want: 'up' },
  { key: 'offer_matched_rate', label: '売る商品が決まった割合(%)', want: 'up' },
  { key: 'contactable_rate', label: '連絡先が使える割合(%)', want: 'up' },
  { key: 'draft_ready_rate', label: '使える文面の割合(%)', want: 'up' },
  { key: 'draft_similarity_avg', label: '文面の使い回し度合い(平均)', want: 'down' },
  { key: 'draft_expression_ng', label: '表現で引っかかった文面の数', want: 'down' },
  { key: 'jobs', label: '案件の件数', want: 'flat' },
  { key: 'job_exclude_rate', label: '受けない案件の割合(%)', want: 'flat' },
  { key: 'job_apply_rate', label: '応募したい案件の割合(%)', want: 'up' },
  { key: 'proposal_ready_rate', label: '使える応募文の割合(%)', want: 'up' },
  { key: 'proposal_similarity_avg', label: '応募文の使い回し度合い(平均)', want: 'down' },
  { key: 'job_hourly_avg', label: '応募したい案件の平均時給(円)', want: 'up' },
  { key: 'auto_apply_unknown_rate', label: '規約が未確認で自動応募を止めた割合(%)', want: 'down' },
  { key: 'executed_outreach', label: '実際に送信した件数', want: 'flat' },
  { key: 'executed_applications', label: '実際に応募した件数', want: 'flat' },
];

export const METRIC_LABEL = new Map(METRIC_DEFS.map((m) => [m.key, m.label]));
