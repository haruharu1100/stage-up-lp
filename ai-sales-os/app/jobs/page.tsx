import Link from 'next/link';
import { all, scalar } from '../../lib/db/client';
import { listSitePolicies } from '../../lib/jobs/sites';
import { Kpi, Kpis, Page, Panel, Tag, verdictTag } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * 案件検索。
 *
 * ★サイトを増やす前に、必ず利用規約・API・robots.txt・自動応募の可否を確認する。
 *   確認できていないサイトは「不明」として扱い、自動では応募しない。
 */

const POLICY_JA: Record<string, { label: string; kind: 'ok' | 'warn' | 'stop' | 'mute' }> = {
  AUTO_ALLOWED: { label: '自動応募してよい', kind: 'ok' },
  APPROVAL_REQUIRED: { label: '人の承認が要る', kind: 'warn' },
  PROHIBITED: { label: '自動応募は禁止', kind: 'stop' },
  UNKNOWN: { label: '不明（＝自動応募しない）', kind: 'stop' },
};

const READ_JA: Record<string, string> = {
  API_OK: '公式APIで取得してよい',
  MANUAL_ONLY: '手作業での閲覧のみ',
  PROHIBITED: '取得禁止',
  UNKNOWN: '不明',
};

export default async function Jobs() {
  const total = await scalar('SELECT COUNT(*) FROM jobs');
  const excluded = await scalar('SELECT COUNT(DISTINCT job_id) FROM job_exclusions');
  const scored = await scalar('SELECT COUNT(*) FROM job_scores');
  const sites = await listSitePolicies();
  const siteRows = await all('SELECT code, has_official_api, read_policy FROM job_sites');
  const meta = new Map(siteRows.map((r) => [String(r.code), { api: String(r.has_official_api), read: String(r.read_policy) }]));

  const bySite = await all('SELECT site_code, COUNT(*) AS n FROM jobs GROUP BY site_code ORDER BY n DESC');
  const rows = await all(
    `SELECT j.id, j.title, j.site_code, j.budget_type, j.budget_min, j.budget_max, s.verdict, s.expected_hourly_profit AS h
       FROM jobs j LEFT JOIN job_scores s ON s.job_id = j.id
      ORDER BY j.id DESC LIMIT 150`,
  );

  return (
    <Page title="案件検索" lead="集めた案件の一覧です。サイトを増やす前に、必ずそのサイトの規約と自動応募の可否を確認しています。">
      <Kpis>
        <Kpi label="見つけた案件" value={total} unit="件" />
        <Kpi label="点数を付けた案件" value={scored} unit="件" />
        <Kpi label="ルールで外した案件" value={excluded} unit="件" hint="8時間拘束・常駐・違法など" />
        <Kpi label="登録しているサイト" value={sites.length} unit="件" />
      </Kpis>

      <Panel
        title="サイトごとの規約の確認結果"
        note="確認の記録が無い、または確認から180日を超えたサイトは「不明」に戻します。不明は安全側に倒して自動応募しません。"
      >
        <table>
          <thead>
            <tr>
              <th>サイト</th>
              <th>公式API</th>
              <th>案件の取得</th>
              <th>自動応募の可否</th>
              <th>確認日</th>
              <th>根拠</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => {
              const p = POLICY_JA[s.effectivePolicy] ?? POLICY_JA.UNKNOWN;
              const m = meta.get(s.code);
              return (
                <tr key={s.code}>
                  <td>{s.name}</td>
                  <td className="small">{m?.api === 'YES' ? 'あり' : m?.api === 'NO' ? 'なし' : '不明'}</td>
                  <td className="small">{READ_JA[m?.read ?? 'UNKNOWN'] ?? '不明'}</td>
                  <td>
                    <Tag kind={p.kind}>{p.label}</Tag>
                  </td>
                  <td className="small">{s.checkedAt ? String(s.checkedAt).slice(0, 10) : '—（未確認）'}</td>
                  <td className="small">{s.reasonJa}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel title="サイトごとの案件数">
        <table>
          <thead>
            <tr>
              <th>サイト</th>
              <th className="num">案件数</th>
            </tr>
          </thead>
          <tbody>
            {bySite.map((s) => (
              <tr key={String(s.site_code)}>
                <td>{String(s.site_code)}</td>
                <td className="num">{Number(s.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="案件の一覧（新しい順に150件）">
        {rows.length === 0 ? (
          <p className="empty">案件がまだありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>案件</th>
                <th>サイト</th>
                <th>報酬</th>
                <th>判定</th>
                <th className="num">時間あたり</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const t = j.verdict ? verdictTag(String(j.verdict)) : null;
                return (
                  <tr key={String(j.id)}>
                    <td>
                      <Link href={`/jobs/${j.id}`}>{String(j.title)}</Link>
                    </td>
                    <td className="small">{String(j.site_code)}</td>
                    <td className="small">
                      {j.budget_min === null && j.budget_max === null
                        ? '—（記載なし）'
                        : `${Number(j.budget_min ?? j.budget_max).toLocaleString()}〜${Number(j.budget_max ?? j.budget_min).toLocaleString()}円`}
                    </td>
                    <td>{t ? <Tag kind={t.kind}>{t.label}</Tag> : <span className="small">—</span>}</td>
                    <td className="num">{j.h === null || j.h === undefined ? '—' : `${Number(j.h).toLocaleString()}円`}</td>
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
