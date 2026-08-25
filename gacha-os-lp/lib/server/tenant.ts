/**
 * 会社ごとの切り分け（TENANT ISOLATION）。
 *
 * ═══════════════════════════════════════════════════════
 * ★何を防ぐためのものか
 * ═══════════════════════════════════════════════════════
 *
 *   このシステムは、これから複数の会社に売ります。
 *   A社の管理者が、B社の会員・売上・ガチャ・ポイント・当選・発送・
 *   問い合わせを、1件たりとも見られてはいけません。
 *
 *   いちばん多い事故は、画面では隠しているのに、
 *   問い合わせの文（SQL）に「どの会社か」を書き忘れる、というものです。
 *
 *       SELECT * FROM orders WHERE id = ?      ← 会社が抜けている
 *
 *   これは動きます。自分の会社のIDを入れている限り、正しく見えます。
 *   他社のIDを入れたときだけ、他社のデータが返ります。
 *   つまり、普通に使っている限り、誰も気づきません。
 *
 * ═══════════════════════════════════════════════════════
 * ★だから「書き忘れられない形」にする
 * ═══════════════════════════════════════════════════════
 *
 *   画面やAPIから、素の問い合わせを書かせません。
 *   かならず、この入れ物を通します。
 *
 *       const s = scopeFor(session.tenantId);
 *       const order = await s.require("orders", orderId);
 *
 *   ここを通ると、どの問い合わせにも必ず
 *
 *       WHERE tenant_id = ?
 *
 *   が入ります。入れるかどうかを、書く人が選べません。
 *   気をつける、では守れません。選べなくします。
 *
 * ═══════════════════════════════════════════════════════
 * ★「無い」と「他社のもの」を、区別して返さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   他社のIDを指定されたとき、
 *
 *       「それは他社のものです」   ← これを返してはいけない
 *       「見つかりません」         ← こう返す
 *
 *   前者だと、IDを順に試すだけで
 *   「B社には注文が何件あるか」「どのIDが生きているか」が分かります。
 *   中身は見えていなくても、それは漏れています。
 *
 *   だから、他社のものも・そもそも無いものも、
 *   まったく同じ「見つかりません」にします。
 */

import type { InValue, Transaction } from "@libsql/client";
import { db, migrate } from "./db";

/* ══════════════════════════════════════════════
   会社ごとに分かれている表
   ══════════════════════════════════════════════

   ★ここに書いていない名前は使えません。
     文字列を組み立てて表の名前にする作りだと、
     画面から送られてきた文字がそのまま表の名前になり得ます。
     一覧に無いものは、そもそも通しません。

   ★tenants だけは、ここに入れません。
     会社そのものの表なので、tenant_id の列がありません。 */
export const TENANT_TABLES = [
  "app_users",
  "customers",
  "sessions",
  "gachas",
  "gacha_stock",
  "draws",
  "prizes",
  "point_ledger",
  "point_adjustments",
  "orders",
  "shipments",
  "support_tickets",
  "audit_events",
  "idempotency",
  "roles",
  "settings",
  "market_prices",
  "products",
  "fraud_flags",
  "login_attempts",
  "password_resets",
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];

const ALLOWED = new Set<string>(TENANT_TABLES);

/**
 * 見つからなかったとき。
 *
 * ★他社のものだったときも、これを使うこと。
 *   別の種類の失敗にすると、そこから中身が推測できます。
 */
export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor(message = "見つかりませんでした。") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** 会社の指定が無いまま呼ばれたとき。これは作り間違いなので、はっきり落とす */
export class NoTenantError extends Error {
  readonly code = "NO_TENANT";
  constructor() {
    super("会社（tenant）が指定されていません。");
    this.name = "NoTenantError";
  }
}

type Row = Record<string, unknown>;

type ListOptions = {
  /** 追加の絞り込み。tenant_id は書かなくてよい（必ず付きます） */
  where?: string;
  args?: InValue[];
  orderBy?: string;
  limit?: number;
  offset?: number;
};

/** 表の名前を確かめる。一覧に無ければ、その場で落とす */
function tableOf(name: string): string {
  if (!ALLOWED.has(name)) {
    throw new Error(
      `表「${name}」は会社ごとの一覧にありません。` +
        "\n  新しい表を足したときは lib/server/tenant.ts の TENANT_TABLES にも足してください。",
    );
  }
  return name;
}

/** 並び順の指定に、危ないものが混ざっていないか */
function orderOf(raw: string | undefined): string {
  if (!raw) return "";
  if (!/^[A-Za-z_][\w]*(\s+(ASC|DESC))?(\s*,\s*[A-Za-z_][\w]*(\s+(ASC|DESC))?)*$/i.test(raw)) {
    throw new Error(`並び順の指定が正しくありません: ${raw}`);
  }
  return ` ORDER BY ${raw}`;
}

export type Scope = {
  readonly tenantId: string;

  /** 1件取る。無ければ null（他社のものも null） */
  get<T = Row>(table: TenantTable, id: string): Promise<T | null>;

  /** 1件取る。無ければ NotFoundError（他社のものも同じ失敗） */
  require<T = Row>(table: TenantTable, id: string): Promise<T>;

  /** 条件で1件取る */
  findOne<T = Row>(table: TenantTable, where: string, args: InValue[]): Promise<T | null>;

  /** 一覧を取る */
  list<T = Row>(table: TenantTable, opts?: ListOptions): Promise<T[]>;

  /** 件数を数える */
  count(table: TenantTable, opts?: Pick<ListOptions, "where" | "args">): Promise<number>;

  /** 合計を出す（数字の列だけ） */
  sum(
    table: TenantTable,
    column: string,
    opts?: Pick<ListOptions, "where" | "args">,
  ): Promise<number>;

  /** 自分の会社のものかどうかだけを確かめる */
  owns(table: TenantTable, id: string): Promise<boolean>;
};

/**
 * この会社ぶんだけを見る入れ物を作る。
 *
 * @param tenantId  セッションから取った会社のID。
 *                  ★画面から送られてきた値を渡さないこと。
 *                    渡すと、番号を書き換えるだけで他社が見えます。
 * @param runner    取引の中で使うときは、その取引を渡す
 */
export function scopeFor(
  tenantId: string | undefined | null,
  runner?: Transaction,
): Scope {
  if (!tenantId || typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new NoTenantError();
  }
  const tid = tenantId;

  const exec = async (sql: string, args: InValue[]) => {
    if (!runner) await migrate();
    const client = runner ?? db();
    return client.execute({ sql, args });
  };

  const build = (table: string, opts?: ListOptions) => {
    const extra = opts?.where ? ` AND (${opts.where})` : "";
    const args: InValue[] = [tid, ...(opts?.args ?? [])];
    return { extra, args };
  };

  return {
    tenantId: tid,

    async get<T = Row>(table: TenantTable, id: string): Promise<T | null> {
      const t = tableOf(table);
      if (!id) return null;
      const res = await exec(
        `SELECT * FROM ${t} WHERE tenant_id = ? AND id = ? LIMIT 1`,
        [tid, id],
      );
      return (res.rows[0] as T | undefined) ?? null;
    },

    async require<T = Row>(table: TenantTable, id: string): Promise<T> {
      const row = await this.get<T>(table, id);
      /* ★ここで「他社のものです」と言わないこと。
           言った時点で、そのIDが実在することを教えています。 */
      if (!row) throw new NotFoundError();
      return row;
    },

    async findOne<T = Row>(
      table: TenantTable,
      where: string,
      args: InValue[],
    ): Promise<T | null> {
      const t = tableOf(table);
      const res = await exec(
        `SELECT * FROM ${t} WHERE tenant_id = ? AND (${where}) LIMIT 1`,
        [tid, ...args],
      );
      return (res.rows[0] as T | undefined) ?? null;
    },

    async list<T = Row>(table: TenantTable, opts?: ListOptions): Promise<T[]> {
      const t = tableOf(table);
      const { extra, args } = build(t, opts);
      const limit = opts?.limit ? ` LIMIT ${Number(opts.limit)}` : "";
      const offset = opts?.offset ? ` OFFSET ${Number(opts.offset)}` : "";
      const res = await exec(
        `SELECT * FROM ${t} WHERE tenant_id = ?${extra}${orderOf(opts?.orderBy)}${limit}${offset}`,
        args,
      );
      return res.rows as T[];
    },

    async count(table: TenantTable, opts?: ListOptions): Promise<number> {
      const t = tableOf(table);
      const { extra, args } = build(t, opts);
      const res = await exec(
        `SELECT COUNT(*) AS n FROM ${t} WHERE tenant_id = ?${extra}`,
        args,
      );
      return Number((res.rows[0] as Row | undefined)?.n ?? 0);
    },

    async sum(table: TenantTable, column: string, opts?: ListOptions): Promise<number> {
      const t = tableOf(table);
      if (!/^[A-Za-z_][\w]*$/.test(column)) {
        throw new Error(`列の名前が正しくありません: ${column}`);
      }
      const { extra, args } = build(t, opts);
      const res = await exec(
        `SELECT COALESCE(SUM(${column}),0) AS n FROM ${t} WHERE tenant_id = ?${extra}`,
        args,
      );
      return Number((res.rows[0] as Row | undefined)?.n ?? 0);
    },

    async owns(table: TenantTable, id: string): Promise<boolean> {
      return (await this.get(table, id)) !== null;
    },
  };
}

/**
 * 会社をまたいで数える（運営側の内部用）。
 *
 * ★画面から呼ばないこと。
 *   ここを画面から呼べるようにした時点で、切り分けは無意味になります。
 *   使い道は「移行の確認」や「試験」だけです。
 */
export async function countAcrossAllTenants(table: TenantTable): Promise<number> {
  await migrate();
  const res = await db().execute(`SELECT COUNT(*) AS n FROM ${tableOf(table)}`);
  return Number((res.rows[0] as Row | undefined)?.n ?? 0);
}
