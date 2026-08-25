/**
 * その画面を開く権限が無いときに出す画面。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ「404」にしないのか
 * ═══════════════════════════════════════════════
 *
 *   外から来た人には、管理画面の地図を渡さないほうが安全です。
 *   だから、ログインしていない人には 404 を返します。
 *
 *   ですが、ここまで来た人は「社内の、ログイン済みの人」です。
 *   その人に「そんな画面はありません」と返すと、
 *
 *       ・自分の操作が間違っていると思って探し続ける
 *       ・「壊れている」と判断して連絡してくる
 *
 *   のどちらかになります。どちらも時間の無駄です。
 *
 *   ★正直に「あなたの役割では開けません」と伝え、
 *     次にどうすればよいか（誰に頼むか）まで書きます。
 *
 * ═══════════════════════════════════════════════
 * ★書いてはいけないこと
 * ═══════════════════════════════════════════════
 *
 *   足りない権限の名前（point.approve など）を出さないこと。
 *   何が足りないかを教えると、
 *   「どの役割を狙えばよいか」の地図になります。
 *
 *   役割の名前（日本語）までにとどめます。
 */

import Link from "next/link";
import { CONSOLE_BASE, SLUG } from "./menu";
import { ROLE_LABEL, type Role } from "@/lib/permissions";

export default function NoPermission({
  screenLabel,
  role,
}: {
  screenLabel: string;
  role: Role;
}) {
  return (
    <main className="min-h-screen bg-void text-ink">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
        <p className="text-sm text-mute">契約者向け管理画面</p>

        <h1 className="mt-3 text-2xl font-bold">
          この画面は、いまの役割では開けません
        </h1>

        <div className="mt-6 rounded-xl border border-line bg-panel p-6">
          <dl className="space-y-3 text-sm">
            <div className="flex gap-4">
              <dt className="w-28 shrink-0 text-mute">開こうとした画面</dt>
              <dd className="font-medium">{screenLabel}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="w-28 shrink-0 text-mute">いまの役割</dt>
              <dd className="font-medium">{ROLE_LABEL[role]}</dd>
            </div>
          </dl>
        </div>

        <p className="mt-6 text-sm leading-relaxed text-mute">
          設定の間違いではありません。役割ごとに、開ける画面を分けています。
          この画面が必要な場合は、社内の管理者（全権）の方に、
          役割の変更をご依頼ください。
        </p>

        <p className="mt-2 text-sm leading-relaxed text-mute">
          ★役割は、変更したその場から効きます。
          いったんログアウトしていただく必要はありません。
        </p>

        {/* ★ここに「ログアウト」の見た目のリンクを置かないこと。
              ログアウトは、押した本人の意思で行う操作なので
              POST でしか受け付けていません。
              リンクにすると、押しても何も起きない部品になります。 */}
        <div className="mt-8">
          <Link
            href={`${CONSOLE_BASE}/${SLUG.dashboard}`}
            className="inline-block rounded-lg bg-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-deep"
          >
            ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
