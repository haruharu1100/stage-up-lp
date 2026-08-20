import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./content/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      opacity: Object.fromEntries(
        Array.from({ length: 101 }, (_, i) => [String(i), String(i / 100)])
      ),
      colors: {
        /* ───────── 暗い面（管理画面・デモ・危険警告・最終画面） ─────────
         * 既存の /demo /launch /sales-demo はこの系統のまま。
         * LP では「製品のコンソール」を埋め込む部分だけに使う。 */
        void: "#05060A",
        panel: "#0B1020",
        panel2: "#0F162B",
        line: "rgba(255,255,255,0.08)",
        ink: "#E8ECF5",
        mute: "#8C97B0",

        /* ───────── 明るい面（LP本体：全体の70%） ───────── */
        paper: "#FFFFFF",
        paper2: "#F7F9FC",
        mist: "#EDF2F9",
        silver: "#DEE6F1",
        edge: "rgba(11,18,32,0.10)",
        edge2: "rgba(11,18,32,0.06)",

        /* 明るい面の文字（16px未満を作らないので濃度は3段で足りる） */
        slate: "#0B1220",
        slate2: "#3B475C",
        slate3: "#63708A",

        /* 濃紺（全体の10%） */
        navy: "#070C18",
        navy2: "#101A31",

        blue: {
          DEFAULT: "#3B82F6",
          bright: "#60A5FA",
          deep: "#1D4ED8",
          /* 白背景で本文にも使える濃さ */
          ink: "#1B4BD8",
          pale: "#E8EFFE",
        },
        cyan: {
          DEFAULT: "#22D3EE",
          deep: "#0891B2",
        },
        gold: {
          DEFAULT: "#C8A96A",
          soft: "#E3CFA0",
          deep: "#8A6F3C",
        },
        warn: "#EAB308",
        "warn-ink": "#A16207",
        danger: "#EF4444",
        "danger-ink": "#C2262A",
        ok: "#34D399",
        "ok-ink": "#0F855C",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "var(--font-noto)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      /* ───────── タイポグラフィ（PC/SPで別スケール・補足も16px未満にしない） ───────── */
      fontSize: {
        /* SP 40〜52px / PC 64〜88px */
        hero: ["clamp(2.5rem, 5.6vw, 5.5rem)", { lineHeight: "1.06", letterSpacing: "-0.04em" }],
        /* SP 32〜42px / PC 48〜64px */
        h1: ["clamp(2rem, 4.1vw, 4rem)", { lineHeight: "1.12", letterSpacing: "-0.035em" }],
        /* SP 28〜36px / PC 40〜56px */
        h2: ["clamp(1.75rem, 3.5vw, 3.5rem)", { lineHeight: "1.16", letterSpacing: "-0.03em" }],
        h3: ["clamp(1.375rem, 2.2vw, 2rem)", { lineHeight: "1.3", letterSpacing: "-0.02em" }],
        /* 導入文 */
        lead: ["clamp(1.125rem, 1.55vw, 1.5rem)", { lineHeight: "1.85" }],
        /* SP 17〜19px / PC 18〜22px */
        body: ["clamp(1.0625rem, 1.3vw, 1.375rem)", { lineHeight: "1.9" }],
        /* 補足。これが最小で、16pxを下回らない */
        note: ["clamp(1rem, 1.05vw, 1.125rem)", { lineHeight: "1.85" }],
        /* ラベル・数値ラベル用（大文字＋字間を広げるので小さくても読める） */
        label: ["0.8125rem", { lineHeight: "1.5", letterSpacing: "0.22em" }],
        /* 巨大数値 */
        mega: ["clamp(3.5rem, 12vw, 11rem)", { lineHeight: "0.94", letterSpacing: "-0.05em" }],
      },
      letterSpacing: {
        tightest: "-0.045em",
      },
      backgroundImage: {
        "grid-fine":
          "linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px)",
        "radial-blue":
          "radial-gradient(ellipse at center, rgba(59,130,246,0.22), transparent 62%)",
        sheen:
          "linear-gradient(120deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.14) 50%, rgba(255,255,255,0) 70%)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(59,130,246,0.28), 0 20px 60px -20px rgba(59,130,246,0.45)",
        panel: "0 30px 90px -40px rgba(0,0,0,0.9)",
        goldglow:
          "0 0 0 1px rgba(200,169,106,0.35), 0 20px 60px -24px rgba(200,169,106,0.35)",
        /* 明るい面の奥行き。影を弱く広くして「上質な紙」に見せる */
        lift: "0 1px 2px rgba(11,18,32,0.04), 0 12px 32px -12px rgba(11,18,32,0.10)",
        lift2:
          "0 1px 2px rgba(11,18,32,0.05), 0 28px 70px -28px rgba(11,18,32,0.20)",
        float:
          "0 2px 4px rgba(11,18,32,0.04), 0 44px 110px -40px rgba(16,32,72,0.34)",
        "blue-lift":
          "0 10px 34px -12px rgba(27,75,216,0.42), 0 2px 6px rgba(27,75,216,0.16)",
        /* 暗いコンソールを白の上に置くときの影 */
        console:
          "0 2px 6px rgba(7,12,24,0.18), 0 50px 120px -44px rgba(7,12,24,0.55)",
      },
      keyframes: {
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        sweep: {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(220%)" },
        },
        pulseline: {
          "0%,100%": { opacity: "0.25" },
          "50%": { opacity: "1" },
        },
        /* 接続線を光が流れる（3Dの補助） */
        trail: {
          "0%": { strokeDashoffset: "220" },
          "100%": { strokeDashoffset: "0" },
        },
        riseIn: {
          "0%": { opacity: "0", transform: "translateY(18px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        breathe: {
          "0%,100%": { transform: "scale(1)", opacity: "0.55" },
          "50%": { transform: "scale(1.06)", opacity: "0.9" },
        },
      },
      animation: {
        float: "float 7s ease-in-out infinite",
        sweep: "sweep 3.6s ease-in-out infinite",
        pulseline: "pulseline 2.4s ease-in-out infinite",
        trail: "trail 2.2s linear infinite",
        riseIn: "riseIn 0.7s cubic-bezier(0.22,1,0.36,1) both",
        breathe: "breathe 5.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
