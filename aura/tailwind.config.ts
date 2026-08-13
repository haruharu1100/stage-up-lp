import type { Config } from "tailwindcss";

// section 4 のデザイントークン
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./config/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 地：ミルクベージュ / インク
        milk: "#F7F3EC",
        ink: "#1C1A17",
        // アクセントはアカウント色をCSS変数で流す（誤爆防止の要）
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
      },
      fontFamily: {
        // 見出し：セリフ体 / UI：ゴシック / 数字：Outfit
        serif: ["var(--font-serif)", "serif"],
        sans: ["var(--font-sans)", "sans-serif"],
        num: ["var(--font-num)", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
