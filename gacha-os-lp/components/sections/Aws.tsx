import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { awsStack } from "@/content/site";

const layers = [
  { label: "入口", names: ["Route 53", "CloudFront", "WAF"] },
  { label: "アプリ", names: ["ALB / Auto Scaling"] },
  { label: "データ", names: ["RDS / Aurora", "S3"] },
  { label: "運用", names: ["CloudWatch", "Secrets Manager", "AWS Backup"] },
];

export default function Aws() {
  return (
    <Section
      id="infra"
      no="21"
      eyebrow="AWS INFRASTRUCTURE"
      title={
        <>
          公開初日に、
          <br />
          人が集まる前提でつくる。
        </>
      }
      lead="新ガチャの公開直後やSNSで話題になった瞬間に、アクセスは一気に伸びます。AWSのマネージドサービスを組み合わせ、アクセス集中を想定した構成と、異常に気づける監視をセットで設計します。"
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        <Reveal>
          <div className="lp-card h-full p-7 sm:p-9">
            <span className="num text-label text-slate3">
              REFERENCE ARCHITECTURE
            </span>
            <div className="mt-8 space-y-3">
              {layers.map((l, i) => (
                <div key={l.label} className="relative">
                  <div className="flex flex-col gap-4 rounded-2xl border border-edge2 bg-paper2 p-5 sm:flex-row sm:items-center">
                    <span className="num w-20 shrink-0 text-label text-slate3">
                      {l.label}
                    </span>
                    <div className="flex flex-wrap gap-2.5">
                      {l.names.map((n) => (
                        <span
                          key={n}
                          className="num rounded-full border border-edge bg-white px-4 py-1.5 text-note leading-normal text-blue-ink shadow-lift"
                        >
                          {n}
                        </span>
                      ))}
                    </div>
                  </div>
                  {i < layers.length - 1 && (
                    <div className="flex justify-center py-1.5">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                        <path
                          d="M8 3v10M4 9l4 4 4-4"
                          stroke="rgba(11,18,32,0.22)"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-8 rounded-2xl border border-edge bg-paper2 p-6">
              <p className="text-note text-slate2">
                どんな条件でも絶対に停止しないと保証することはできません。想定する同時アクセス規模をうかがったうえで、必要な構成・監視・復旧手順をご提案します。
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="h-full rounded-3xl border border-edge bg-white p-7 shadow-lift sm:p-8">
            <span className="num text-label text-slate3">
              WHAT EACH ONE DOES
            </span>
            <div className="mt-7 divide-y divide-edge2">
              {awsStack.map((s) => (
                <div key={s.name} className="py-5 first:pt-0">
                  <p className="num text-note font-bold text-slate">{s.name}</p>
                  <p className="mt-2 text-note text-slate2">{s.role}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
