/**
 * テストプレイ用モードの判定。
 *
 * 開発中（npm run dev）は自動でON。本番ビルドではOFF。
 * どうしても本番相当の環境でデモを見せたいときだけ DEMO_LOGIN=1 を明示する。
 * 逆に開発中でも切りたいときは DEMO_LOGIN=0。
 */
export function demoEnabled() {
  if (process.env.DEMO_LOGIN === '1') return true;
  if (process.env.DEMO_LOGIN === '0') return false;
  return process.env.NODE_ENV !== 'production';
}
