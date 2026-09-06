/**
 * 誰が、何をしてよいか（RBAC）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この表を1枚だけにするのか
 * ═══════════════════════════════════════════════════════
 *
 *   権限の表は、放っておくと必ず2枚になります。
 *
 *       画面側 … ボタンを出すか消すかを決めるため
 *       入口側 … 実際に受け付けるかを決めるため
 *
 *   2枚あると、片方だけ直した日に、静かにずれます。
 *   しかも、ずれ方が最悪です。
 *
 *       画面では消えているのに、入口は受け付ける
 *
 *   この状態は、画面を見ているかぎり絶対に気づけません。
 *   ボタンが無いのですから、誰も押しません。
 *   気づくのは、入口を直接叩ける人だけです。
 *   つまり、悪意のある人だけが気づきます。
 *
 *   だから、表はこの1枚にします。
 *   画面（lib/console/state.ts）も、入口（lib/server/context.ts）も、
 *   ここから読みます。ここ以外に権限の判断を書かないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★この表は「画面を隠す」ためのものではありません
 * ═══════════════════════════════════════════════════════
 *
 *   ボタンを消すのは、親切のためです。安全のためではありません。
 *   安全は、入口（API）が断ることでしか作れません。
 *
 *   UIでボタンを隠しただけの状態を「権限を付けた」と呼ばないこと。
 *   その状態は、鍵をかけずにドアの取っ手を外しただけです。
 */

export type Role =
  | "VIEWER"
  | "SUPPORT"
  | "OPERATOR"
  | "FINANCE"
  | "SECURITY"
  | "SUPER_ADMIN";

export type Permission =
  | "gacha.view" | "gacha.edit" | "gacha.publish"
  /**
   * 売上・粗利を見る。
   *
   * ★これを gacha.view で兼ねないこと（2026-08-26 に直しました）。
   *   以前、売上と粗利は「ガチャを見る権限」で守っているつもりでした。
   *   ところが VIEWER（閲覧のみ）も gacha.view を持っています。
   *   つまり、守っているつもりで、誰も締め出していませんでした。
   *
   *   売上と粗利は、その会社が
   *   「いくら売れて、いくら返しているか」がそのまま読める数字です。
   *   閲覧アカウントは、外の方や短期の方にお渡しすることがあります。
   *   ガチャの中身が見られることと、経営の数字が見られることは、別の話です。
   *
   *   ★「持っているつもり」の権限は、無い権限より危ないです。
   *     無ければ足しますが、あるつもりでいると、誰も確かめません。
   */
  | "revenue.view"
  | "point.view" | "point.request" | "point.approve"
  | "fraud.view" | "fraud.act"
  | "shipping.view" | "shipping.act"
  | "support.view" | "support.reply"
  | "security.view" | "audit.view"
  | "user.suspend"
  /**
   * お店の設定と「公開準備」の状況を見る。
   *
   * ★これを settings.edit と1つにまとめないこと。
   *   ガチャを公開するのは運営（OPERATOR）です。
   *   その運営が「お店の設定がそろっていないので公開できません」と断られたとき、
   *   何が足りないのかを見られないと、運営はガチャの設定を延々と見直します。
   *   直す場所は、別の画面にあります。
   *
   *   見えても危なくありません。ここに入る文章は、
   *   もともとお客様に見せるための文章（特商法・規約）です。
   *   危ないのは「書き換えられること」なので、そちらだけ settings.edit で守ります。
   */
  | "settings.view"
  | "settings.edit";

/**
 * 役割ごとにできること。
 *
 * ★ポイントの「申請」と「承認」を、必ず別の権限にしてあること。
 *   1人が両方を持っていると、二人承認が形だけになります。
 *   SUPER_ADMIN だけは両方持ちますが、それでも
 *   「自分が出した申請を自分で承認する」ことは canApprove() で禁じています。
 *
 * ★承認できる人を、必ず2人以上つくること（重要）。
 *   ここを1人にすると、その人が出した申請を承認できる人がいなくなり、
 *   高額のポイント操作が永久に処理できなくなります。
 *   逆に「面倒だから」と自己承認を許すと、二人承認そのものが消えます。
 *
 *   だから、承認できる人が1人しかいない状態では、
 *   そもそも高額の申請を受け付けないようにしてあります
 *   （reducer の POINT_REQUEST を参照）。
 *   運営者には「承認できる人をもう1人つくってください」と伝えます。
 *
 * ★ここから権限を1つ消すときは、必ず入口側も落ちることを確かめること。
 *   tests/roleAccess.test.ts が、画面と入口が同じ表を見ているかを見張ります。
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  VIEWER: ["gacha.view", "point.view", "shipping.view", "support.view"],
  /**
   * サポートは、発送を「見る」だけ。
   *
   * ★shipping.act を持たせないこと。
   *   サポートが発送を見たい理由は、
   *   「まだ届きません」に答えるためです。答えるのに必要なのは、
   *   今どこにあるかを読むことだけで、箱を作る力ではありません。
   *
   *   ここに shipping.act を足すと、
   *   お客様と電話でつながっている最中の人が、
   *   その場で宛先を変えたり、出荷を確定したりできるようになります。
   *   なりすましの電話は、まさにその瞬間を狙ってきます。
   *
   *   発送を動かすのは、運営（OPERATOR）の仕事です。
   */
  SUPPORT: [
    "gacha.view", "point.view", "shipping.view",
    "support.view", "support.reply",
  ],
  /**
   * 運営は、売上を見られること。
   *
   * ★ここを外さないこと。
   *   ガチャを止めるかどうかを決めるのは運営です。
   *   「いくら売れているか」を見ずに止め時を決めろ、というのは無理です。
   */
  OPERATOR: [
    "gacha.view", "gacha.edit", "gacha.publish", "revenue.view",
    "point.view", "shipping.view", "shipping.act",
    "support.view", "support.reply", "fraud.view",
    /* ★公開できない理由を読むために要ります。
         書き換えは settings.edit なので、運営にはできません。 */
    "settings.view",
  ],
  FINANCE: [
    "gacha.view", "revenue.view", "point.view", "point.request",
    "shipping.view", "audit.view",
    /* 特商法の支払方法・支払時期は、経理が確認する項目です */
    "settings.view",
  ],
  /**
   * セキュリティに revenue.view は付けません。
   *
   * ★不正を追うのに、売上の総額は要りません。
   *   要るのは「誰が、いつ、いくら動かしたか」で、それは
   *   fraud / audit / point の側にあります。
   *   要らない権限を付けないのは、その人を疑うからではありません。
   *   その人のアカウントが乗っ取られた日に、
   *   持ち出されるものを減らすためです。
   */
  SECURITY: [
    "gacha.view", "point.view", "fraud.view", "fraud.act",
    "security.view", "audit.view", "user.suspend",
  ],
  SUPER_ADMIN: [
    "gacha.view", "gacha.edit", "gacha.publish", "revenue.view",
    "point.view", "point.request", "point.approve",
    "fraud.view", "fraud.act",
    "shipping.view", "shipping.act",
    "support.view", "support.reply",
    "security.view", "audit.view",
    "user.suspend", "settings.view", "settings.edit",
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  VIEWER: "閲覧のみ",
  SUPPORT: "サポート",
  OPERATOR: "運営",
  FINANCE: "経理",
  SECURITY: "セキュリティ",
  SUPER_ADMIN: "管理者（全権）",
};

/**
 * 権限の名前を、日本語で。
 *
 * ★"point.approve" のまま画面に出さないこと。
 *   権限表は、運営者が「この人に何を任せるか」を決めるための表です。
 *   決めるのは、たいてい技術の人ではありません。
 */
export const PERMISSION_LABEL: Record<Permission, string> = {
  "gacha.view": "ガチャを見る",
  "gacha.edit": "ガチャを作る・直す",
  "gacha.publish": "ガチャを公開する・止める",
  "revenue.view": "売上・粗利を見る",
  "point.view": "ポイントを見る",
  "point.request": "ポイント変更を申請する",
  "point.approve": "ポイント変更を承認する",
  "fraud.view": "不正判定を見る",
  "fraud.act": "不正判定を確定する",
  "shipping.view": "発送を見る",
  "shipping.act": "発送を処理する",
  "support.view": "問い合わせを見る",
  "support.reply": "問い合わせに返信する",
  "security.view": "セキュリティを見る",
  "audit.view": "監査ログを見る",
  "user.suspend": "会員を停止する",
  "settings.view": "お店の設定と公開準備を見る",
  "settings.edit": "お店の設定を変える（特商法・規約・法人情報）",
};

/**
 * 権限表に出す順番と、まとまり。
 *
 * ★危ないものを下に埋めないこと。
 *   お金と個人情報に触れる権限を先に見せます。
 *   「サポートに全部渡してしまっていた」に、その場で気づけるようにです。
 */
export const PERMISSION_GROUPS: { title: string; items: Permission[] }[] = [
  { title: "お金（売上）", items: ["revenue.view"] },
  { title: "お金（ポイント）", items: ["point.view", "point.request", "point.approve"] },
  { title: "ガチャ", items: ["gacha.view", "gacha.edit", "gacha.publish"] },
  { title: "発送", items: ["shipping.view", "shipping.act"] },
  { title: "問い合わせ", items: ["support.view", "support.reply"] },
  { title: "不正・セキュリティ", items: ["fraud.view", "fraud.act", "security.view", "audit.view", "user.suspend"] },
  { title: "設定", items: ["settings.view", "settings.edit"] },
];

/** 権限表に出す役割の順番（弱い順。強くなっていく様子が見えるように） */
export const ROLE_ORDER: Role[] = [
  "VIEWER", "SUPPORT", "OPERATOR", "FINANCE", "SECURITY", "SUPER_ADMIN",
];

/** その役割は、その操作をしてよいか */
export function can(role: Role, p: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(p) ?? false;
}

/**
 * DBから読んだ文字が、本当に知っている役割かを確かめる。
 *
 * ★知らない文字を、そのまま役割として扱わないこと。
 *   役割の綴りを1文字間違えて保存された行があると、
 *   can() が「権限が無い」ではなく「表に無いので落ちる」になります。
 *   落ちた場所によっては、断るつもりが通ってしまいます。
 *   知らない文字は、いちばん弱い役割として扱います。
 *
 * ═══════════════════════════════════════════════════════
 * ★これは「表示のための道具」です。門番で使わないこと
 * ═══════════════════════════════════════════════════════
 *
 *   画面に役職名を出すとき、知らない値でも何か出す必要があります。
 *   そのための「いちばん弱い VIEWER にしておく」です。
 *
 *   ですが、入口の門番がこれを使うと、意味が反転します。
 *
 *       行が読めない → 役割が分からない → ★VIEWER として通る
 *
 *   VIEWER は「見るだけ」ですが、見えるのは
 *   ガチャ・ポイント・発送・問い合わせ、つまり会社の中身ぜんぶです。
 *   消したはずの担当者が、手元のクッキーだけで読み続けられます。
 *   DBが一瞬答えなかっただけでも、同じことが起きます。
 *
 *   2026-08-26、公開先の総点検で実際に見つかりました。
 *   いまは lib/server/context.ts が自分で確かめ、
 *   知らない値・行が無い・止めた人・締め出し中は、すべて断ります。
 *   tests/failClosed.test.ts が、戻されていないかを見張っています。
 */
export function asRole(v: unknown): Role {
  const s = String(v ?? "");
  return (s in ROLE_PERMISSIONS ? s : "VIEWER") as Role;
}

/**
 * 知らない役割なら、null を返す。丸めない。
 *
 * ═══════════════════════════════════════════════════════
 * ★「決める」側は、必ずこちらを使うこと
 * ═══════════════════════════════════════════════════════
 *
 *   asRole() は、画面に何か出すための道具です。
 *   知らない値を VIEWER にして、とにかく1つ返します。
 *
 *   ところが「権限を変える」ときに同じ道具を使うと、こうなります。
 *
 *       打ち間違い／古い名前／攻める側が送った文字
 *         → 知らない値 → ★黙って VIEWER に変更される
 *
 *   運営の方は「経理にしたつもり」で、実際は閲覧のみになります。
 *   逆に、DBの側が壊れていて役割が読めないときも、
 *   「いまは VIEWER だったことにする」と決めつけてしまい、
 *   壊れていた事実がその場で上書きされて消えます。
 *
 *   ★分からないときは、決めないこと。断ること。
 *     2026-08-26、担当者管理の試験で実際に見つかりました
 *     （"GOD_MODE" を送ると、黙って VIEWER に降格できた）。
 *     tests/adminManage.test.ts が見張っています。
 */
export function parseRole(v: unknown): Role | null {
  const s = String(v ?? "");
  return s in ROLE_PERMISSIONS ? (s as Role) : null;
}
