import Link from 'next/link';
import { all, one, scalar } from '../../../lib/db/client';
import { num } from '../../../lib/settings';
import { EXCLUSION_RULES } from '../../../lib/jobs/exclude';
import { Kpi, Kpis, Money, Page, Panel, Tag, verdictTag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * 応募候補。
 *
 * ★短時間・高単価・AIで自動化できる案件を上に出す。
 *   時給が下限を割る案件、8時間拘束・常駐などは、この画面に出る前に外れている。
 */

const RULE_LABEL = new Map(EXCLUSION_RULES.map((r) => [r.code, r.label]));

export default async function Candidates() {
  const apply = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'APPLY'");
  const hold = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'HOLD'");
  const exclude = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'EXCLUDE'");
  const ready = await scalar("SELECT COUNT(*) FROM proposals WHERE status = 'READY'");
  const target = await num('job.target_hourly');
  const min = await num('job.min_hourly');
  const avg = await one("SELECT AVG(expected_hourly_profit) AS v FROM job_scores WHERE verdict = 'APPLY' AND expected_hourly_profit IS NOT NULL");

  const rows = await all(
    `SELECT j.id, j.title, j.site_code, s.verdict, s.expected_profit AS p, s.expected_hours AS hrs,
            s.expected_hourly_profit AS h, s.automation_score AS auto, s.priority_score AS prio, s.verdict_reason AS why,
            pr.status AS pstatus
       FROM job_scores s JOIN jobs j ON j.id = s.job_id
       LEFT JOIN proposals pr ON pr.job_id = j.id
      WHERE s.verdict IN ('APPLY','HOLD')
      ORDER BY CASE s.verdict WHEN 'APPLY' THEN 0 ELSE 1 END, s.expected_hourly_profit DESC LIMIT 120`,
  );

  const excluded = await all(
    `SELECT e.rule_code, COUNT(DISTINCT e.job_id) AS n FROM job_exclusions e GROUP BY e.rule_code ORDER BY n DESC`,
  );

  return (
    <Page title="応募候補" lead={`時間あたりの利益が高い順に並べています。目標時給 ${target.toLocaleString()}円、最低時給 ${min.toLocaleString()}円を基準にしています。`}>
      <Kpis>
        <Kpi label="応募したい案件" value={apply} unit="件" />
        <Kpi label="人が判断する案件" value={hold} unit="件" />
        <Kpi label="受けない案件" value={exclude} unit="件" />
        <Kpi label="使える応募文" value={ready} unit="件" />
        <Kpi
          label="応募したい案件の平均時給"
          value={avg?.v ? Math.round(Number(avg.v)) : null}
          unit="円"
          hint={avg?.v ? '報酬 − AI費用 ÷ 想定時間' : '応募したい案件がまだ無い'}
        />
      </Kpis>

      <Panel title="受けないと決めた理由の内訳" note="8時間拘束・常駐・雇用・違法・なりすまし・AI利用禁止などは、点数を付ける前の段階で外しています。">
        {excluded.length === 0 ? (
          <p className="empty">ルールで外した案件はありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>理由</th>
                <th className="num">件数</th>
              </tr>
            </thead>
            <tbody>
              {excluded.map((e) => (
                <tr key={String(e.rule_code)}>
                  <td>{RULE_LABEL.get(String(e.rule_code)) ?? String(e.rule_code)}</td>
                  <td className="num">{Number(e.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="候補の一覧（時間あたりの利益が高い順）">
        {rows.length === 0 ? (
          <p className="empty">候補がまだありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>案件</th>
                <th>サイト</th>
                <th>判定</th>
                <th className="num">想定利益</th>
                <th className="num">想定時間</th>
                <th className="num">時間あたり</th>
                <th className="num">自動化</th>
                <th>応募文</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = verdictTag(String(r.verdict));
                const pt = r.pstatus ? verdictTag(String(r.pstatus)) : null;
                return (
                  <tr key={String(r.id)}>
                    <td>
                      <Link href={`/jobs/${r.id}`}>{String(r.title)}</Link>
                      <div className="small">{String(r.why)}</div>
                    </td>
                    <td className="small">{String(r.site_code)}</td>
                    <td>
                      <Tag kind={t.kind}>{t.label}</Tag>
                    </td>
                    <td className="num">
                      <Money v={r.p === null ? null : Number(r.p)} />
                    </td>
                    <td className="num">{r.hrs === null ? '—' : `${Number(r.hrs)}h`}</td>
                    <td className="num">
                      <Money v={r.h === null ? null : Number(r.h)} />
                    </td>
                    <td className="num">{Number(r.auto)}</td>
                    <td>{pt ? <Tag kind={pt.kind}>{pt.label}</Tag> : <span className="small">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </Page>
  );
}
