import { BRAND } from "@/config/brand";
import type { XProfile } from "./client";

// OAuth 途中経過を保持する httpOnly cookie 名
export const COOKIE_STATE = "aura_x_state";
export const COOKIE_VERIFIER = "aura_x_verifier";
// テストモードで「接続済み」を保持する cookie（本番では未使用）
export const COOKIE_TEST_ACCOUNT = "aura_test_account";

// テストモードの疑似プロフィール（外部に一切出ずに接続画面を検証するため）
export function mockProfile(): XProfile {
  return {
    id: "0",
    name: BRAND.name.replace(/^AURA \/ /, ""),
    username: BRAND.handle,
    profileImageUrl: null,
    followers: 1842,
    following: 231,
    tweetCount: 512,
  };
}
