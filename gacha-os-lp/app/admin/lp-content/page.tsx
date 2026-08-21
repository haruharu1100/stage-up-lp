import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import LpContentEditor from "@/components/admin/LpContentEditor";
import { activeHero, activeMobileCta, faqs } from "@/content/site";
import type { LpStore } from "@/lib/lpText";

export const metadata: Metadata = {
  title: "文章の編集｜AI GACHA OS",
  description: "サイトの文章と改行を直す管理者用の画面です。",
  robots: { index: false, follow: false, nocache: true },
};

/** 保存された中身をその場で読むため、事前生成しない */
export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "content", "lp-content.json");

async function load(): Promise<LpStore> {
  try {
    const raw = await readFile(FILE, "utf8");
    const j = JSON.parse(raw) as Partial<LpStore>;
    return { draft: j.draft ?? {}, published: j.published ?? {}, history: j.history ?? [] };
  } catch {
    return { draft: {}, published: {}, history: [] };
  }
}

/**
 * コード側にある「元の文章」。
 * 編集していない項目は、編集画面でもこれが薄く見えます
 * （何も入力しなければ、この文章のままサイトに出ます）。
 */
function fallbacks(): Record<string, string> {
  const out: Record<string, string> = {
    "hero.badge": "オンラインガチャ / オリパ 事業者向け",
    "hero.headline": activeHero.headlineSp.join("\n"),
    "hero.sub": "AIに指示。内容を確認。\nあとは運営をシステムが支える。",
    "mobilecta.primary": activeMobileCta.primary.label,
    "mobilecta.secondary": activeMobileCta.secondary.label,
    "mobilecta.pricing": "料金を見る",
    "contact.heading": "まず、いまの運営を\n見せてください。",
    "contact.lead":
      "どこに時間が溶けているのかを一緒に整理します。デモ画面をお見せしながら、必要な機能範囲とお見積りの目安をその場でお伝えします。",
    "contact.submit": "送信する",
    "contact.note":
      "その他の詳細は、ご相談の中でうかがいます。送信された内容は、ご相談への回答のみに使用します。営業目的での第三者提供は行いません。詳しくは",
  };
  faqs.forEach((f, i) => {
    out[`faq.${i}.q`] = f.q;
    out[`faq.${i}.a`] = f.a;
  });
  return out;
}

export default async function LpContentPage({
  searchParams,
}: {
  searchParams?: { key?: string };
}) {
  /**
   * 管理者用の画面。
   * ADMIN_KEY を設定していれば、URLに ?key=（合言葉）が付いていないと開けません。
   * 本番で未設定のときは、開けても保存できないようにしてあります
   * （API側でも同じ判定をしています。画面だけを隠すのは守りになりません）。
   */
  const gate = process.env.ADMIN_KEY?.trim();
  const allowed = !gate || searchParams?.key === gate;
  const prod = process.env.NODE_ENV === "production";

  if (!allowed) {
    return (
      <Locked
        title="この画面は開けません"
        body="URLの後ろに合言葉が必要です。分からない場合は管理担当にお尋ねください。"
      />
    );
  }

  if (prod && !gate) {
    return (
      <Locked
        title="まだ使える状態になっていません"
        body="合言葉（ADMIN_KEY）が設定されていないため、この画面は使えません。設定すると、その合言葉を知っている人だけが文章を直せるようになります。"
      />
    );
  }

  const store = await load();

  return (
    <LpContentEditor
      initial={store}
      adminKey={searchParams?.key ?? ""}
      fallbacks={fallbacks()}
    />
  );
}

function Locked({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper2 px-6">
      <div className="max-w-md rounded-3xl border border-edge bg-white p-8 text-center shadow-lift">
        <p className="text-h3 font-bold text-slate">{title}</p>
        <p className="mt-3 text-note leading-[1.9] text-slate2">{body}</p>
      </div>
    </div>
  );
}
