/**
 * 画面にそのまま出せるエラー。
 *
 * 認証まわり（lib/auth.js）はブラウザの仕組みに寄りかかっているため、
 * 検証スクリプトなど「画面の外」から読み込めない。
 * エラーの形だけはどこからでも使えるよう、ここに置いて分けている。
 */
export class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
