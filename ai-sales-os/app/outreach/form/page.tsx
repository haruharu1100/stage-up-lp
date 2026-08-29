import { scalar } from '../../../lib/db/client';
import { Panel } from '../../ui';
import { ChannelView } from '../channel-view';

export const dynamic = 'force-dynamic';

/** フォーム営業。営業お断りの記載がある会社は外す。認証画像の回避は行わない。 */

async function RulePanel() {
  const noSales = await scalar('SELECT COUNT(*) FROM companies WHERE no_sales_flag = 1');
  const queued = await scalar("SELECT COUNT(*) FROM approval_queue WHERE kind = 'FORM' AND status = 'PENDING'");
  return (
    <Panel title="フォームを送る前に必ず確認していること">
      <ul>
        <li>
          ホームページに「営業お断り」の記載がある会社は外す（現在 <b>{noSales}社</b> を対象外にしています）
        </li>
        <li>
          認証画像（CAPTCHA）などの仕組みは回避しません。自動で通せない場合は人の確認へ回します（現在 <b>{queued}件</b> が確認待ち）
        </li>
        <li>同じ会社へ二重に送らないよう、会社ごとに1件だけに絞っています</li>
      </ul>
    </Panel>
  );
}

export default async function FormPage() {
  return (
    <ChannelView
      channel="FORM"
      action="FORM"
      title="フォーム営業"
      lead="問い合わせフォームから送る文面です。営業お断りの記載を確認し、認証画像などがある場合は自動化せず人の確認へ回します。"
      whatJa="問い合わせフォームの送信"
      extra={await RulePanel()}
    />
  );
}
