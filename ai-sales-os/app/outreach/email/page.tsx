import { senderIdentity } from '../../../lib/sales/sender-identity';
import { Panel, Tag } from '../../ui';
import { ChannelView } from '../channel-view';

export const dynamic = 'force-dynamic';

/** メール営業。法律で必須の4項目が1つでも欠けていたら、文面を作る段階で止める。 */

function LawPanel() {
  const id = senderIdentity();
  return (
    <Panel
      title="法律で必ず入れる項目（特定電子メール法）"
      note="1つでも欠けていると、メールの下書きそのものを作りません。あとから足すことができない項目のためです。"
    >
      {id.ok ? (
        <p>
          <Tag kind="ok">4項目そろっています</Tag> <span className="small">送信者名・住所・問い合わせ先・配信停止の受付先</span>
        </p>
      ) : (
        <>
          <p>
            <Tag kind="stop">足りません</Tag>
          </p>
          <ul>
            {id.missing.map((m) => (
              <li key={m} className="small">
                {m}
              </li>
            ))}
          </ul>
          <p className="small">{id.reasonJa}</p>
        </>
      )}
    </Panel>
  );
}

export default function EmailPage() {
  return (
    <ChannelView
      channel="EMAIL"
      action="EMAIL"
      title="メール営業"
      lead="1社ずつ、その会社のホームページを読んだ内容を入れた文面を作ります。同じ文章を大量に配ることはしません。"
      whatJa="営業メールの送信"
      extra={<LawPanel />}
    />
  );
}
