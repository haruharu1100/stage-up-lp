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
  | "point.view" | "point.request" | "point.approve"
  | "fraud.view" | "fraud.act"
  | "shipping.view" | "shipping.act"
  | "support.view" | "support.reply"
  | "security.view" | "audit.view"
  | "user.suspend" | "settings.edit";

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
  SUPPORT: [
    "gacha.view", "point.view", "shipping.view", "shipping.act",
    "support.view", "support.reply",
  ],
  OPERATOR: [
    "gacha.view", "gacha.edit", "gacha.publish",
    "point.view", "shipping.view", "shipping.act",
    "support.view", "support.reply", "fraud.view",
  ],
  FINANCE: [
    "gacha.view", "point.view", "point.request",
    "shipping.view", "audit.view",
  ],
  SECURITY: [
    "gacha.view", "point.view", "fraud.view", "fraud.act",
    "security.view", "audit.view", "user.suspend",
  ],
  SUPER_ADMIN: [
    "gacha.view", "gacha.edit", "gacha.publish",
    "point.view", "point.request", "point.approve",
    "fraud.view", "fraud.act",
    "shipping.view", "shipping.act",
    "support.view", "support.reply",
    "security.view", "audit.view",
    "user.suspend", "settings.edit",
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
  "settings.edit": "設定を変える",
};

/**
 * 権限表に出す順番と、まとまり。
 *
 * ★危ないものを下に埋めないこと。
 *   お金と個人情報に触れる権限を先に見せます。
 *   「サポートに全部渡してしまっていた」に、その場で気づけるようにです。
 */
export const PERMISSION_GROUPS: { title: string; items: Permission[] }[] = [
  { title: "お金（ポイント）", items: ["point.view", "point.request", "point.approve"] },
  { title: "ガチャ", items: ["gacha.view", "gacha.edit", "gacha.publish"] },
  { title: "発送", items: ["shipping.view", "shipping.act"] },
  { title: "問い合わせ", items: ["support.view", "support.reply"] },
  { title: "不正・セキュリティ", items: ["fraud.view", "fraud.act", "security.view", "audit.view", "user.suspend"] },
  { title: "設定", items: ["settings.edit"] },
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
 */
export function asRole(v: unknown): Role {
  const s = String(v ?? "");
  return (s in ROLE_PERMISSIONS ? s : "VIEWER") as Role;
}
