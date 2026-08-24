import AccountHealthBoard, { type HealthMetricView } from '@/components/AccountHealthBoard';
import AdWeeklyBoard, { type AdWeekView } from '@/components/AdWeeklyBoard';
import ShipDeadlineBoard, { type ShipRowView } from '@/components/ShipDeadlineBoard';
import { accountHealth } from '@/lib/account/health';
import { adTargets, adWeeklyList, currentWeekStart } from '@/lib/ads/adLedger';
import { migrate } from '@/lib/db/client';
import { config } from '@/lib/env';
import { shipSummary, shipmentQueue } from '@/lib/ops/shipDeadline';

export const dynamic = 'force-dynamic';

/**
 * アカウントを守る画面。
 *
 * ★ユーザー指定の絶対ルール：
 *   「広告や新規仕入れより、アカウント保護を最優先してください。」
 *   → だから並び順は ①健全性 ②出荷期限 ③広告 の順で固定する。
 *
 * ★この画面から外部に注文・入札・出品は一切行かない。
 */
export default async function HealthPage() {
  await migrate();
  const [health, ads, targets, ships, summary] = await Promise.all([
    accountHealth(),
    adWeeklyList(60),
    adTargets(),
    shipmentQueue(200),
    shipSummary(),
  ]);

  const metrics: HealthMetricView[] = health.metrics as HealthMetricView[];
  const adRows: AdWeekView[] = ads as AdWeekView[];
  const shipRows: ShipRowView[] = ships as ShipRowView[];
  const weekStart = currentWeekStart();

  const shipNoticeClass =
    summary.overdue > 0 ? 'notice err' : summary.today > 0 ? 'notice warn' : 'notice info';

  return (
    <main className="wrap">
      {health.freezeRecommended && (
        <div className="notice err">
          <strong>★アカウントが危険な状態です。新しい仕入れの承認と、広告の増額をいったん止めてください。</strong>
          <div className="small">
            アカウントが止まると、利益も在庫も学習データも全部止まります。ここが一番優先です。
          </div>
        </div>
      )}

      {summary.overdue > 0 && (
        <div className="notice err">
          <strong>★発送期限を過ぎた注文が{summary.overdue}件あります。いますぐ発送してください。</strong>
          <div className="small">出荷遅延率（4%未満が必須）はアカウント停止に直結します。</div>
        </div>
      )}

      {/* ---- ① アカウント健全性（最優先） ---- */}
      <div className="card">
        <h2>① アカウントの健全性（いちばん大事）</h2>
        <p className="desc">
          Amazonの評価が基準を割ると、売上に関係なくアカウントが止まります。
          数字は<strong>セラーセントラルの「アカウント健全性」から手で入れてください</strong>（自動では取れません）。
          入れていない項目は「未入力」と出し、勝手に推測はしません。
        </p>
        <AccountHealthBoard
          metrics={metrics}
          measuredOn={health.measuredOn}
          headline={health.headline}
          advice={health.advice}
          worst={health.worst}
          ageDays={health.ageDays}
        />
      </div>

      {/* ---- ② 出荷期限 ---- */}
      <div className="card">
        <h2>② 発送の期限（自己発送）</h2>
        <div className={shipNoticeClass} style={{ marginBottom: 8 }}>
          <strong>{summary.headline}</strong>
          <div className="small">
            発送待ち{summary.pending}件／今日{summary.today}件／明日{summary.tomorrow}件／3日以内{summary.soon}件
            {summary.noTracking > 0 && ` ／★追跡番号が未入力の発送済みが${summary.noTracking}件`}
          </div>
        </div>
        <p className="desc">
          期限を過ぎた注文は<strong>必ず一番上</strong>に出します。
          「急ぎの発送を通知する」を押すと、期限超過と今日発送の分だけを通知します。
        </p>
        <ShipDeadlineBoard rows={shipRows} />
      </div>

      {/* ---- ③ 広告の週次点検 ---- */}
      <div className="card">
        <h2>③ 広告の週次点検（7日ごと）</h2>
        <p className="desc">
          7日ぶんの数字を入れると、<strong>伸ばせる／ちょうど良い／使いすぎ／露出不足／見込みが薄い</strong>
          のどれかを判定します。
          「売れているが赤字」も「黒字だがほとんど売れない」も失敗とみなし、
          <strong>利益を保ったまま伸ばせる状態</strong>を良しとします。
          ★入札は1円も自動で変えません。人が実行してください。
        </p>
        <AdWeeklyBoard
          rows={adRows}
          targets={targets}
          defaultWeekStart={weekStart}
          adAutoOptimize={config.adAutoOptimize}
        />
      </div>

      <div className="card">
        <h2>この画面ができないこと</h2>
        <ul className="small">
          <li>Amazonから注文や健全性の数字を自動で取ってくること（人が入れます）</li>
          <li>広告の入札を自動で変えること（AD_AUTO_OPTIMIZE={String(config.adAutoOptimize)}）</li>
          <li>発送作業そのもの（配送業者への手配はご自身で行ってください）</li>
          <li>仕入れの発注（AUTO_PURCHASE={String(config.autoPurchase)}）</li>
        </ul>
      </div>
    </main>
  );
}
