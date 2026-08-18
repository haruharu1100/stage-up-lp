/**
 * 天気の取り口を1か所にまとめる層。
 *
 * 画面もバッチも、この2つの関数しか呼ばない：
 *   getForecast(lat, lng, from, to)  … これからの予報
 *   getActual(lat, lng, from, to)    … 過ぎた日の実績
 *
 * こうしておくと、将来 気象庁や別の有料サービスへ乗り換えるときに
 * このフォルダの中だけを差し替えれば済み、売上や予測の側は一切触らずに済む。
 *
 * 返す形は必ず同じ（1日1件の配列）:
 *   { date, code, text, tempMax, tempMin, tempAvg, precipMm, precipProb, humidity, windSpeed }
 */

import { openMeteo } from './open-meteo.js';

const PROVIDERS = {
  'open-meteo': openMeteo,
};

export function currentProvider() {
  const name = process.env.WEATHER_PROVIDER || 'open-meteo';
  return PROVIDERS[name] || openMeteo;
}

export function providerName() {
  return currentProvider().name;
}

export async function getForecast(lat, lng, from, to) {
  return currentProvider().forecast(lat, lng, from, to);
}

export async function getActual(lat, lng, from, to) {
  return currentProvider().actual(lat, lng, from, to);
}

/**
 * 住所から緯度・経度を割り出す（国土地理院の無料サービス）。
 * 見つからないことも普通にあるので、そのときは null を返して
 * 「地図で手直ししてください」と案内する。勝手に近い場所を当てはめない。
 */
export async function geocodeJp(address) {
  const q = String(address || '').trim();
  if (!q) return null;
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'resto-os' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const list = await res.json();
    const hit = Array.isArray(list) ? list[0] : null;
    const c = hit?.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) return null;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    // 日本の範囲から外れていたら、住所の取り違えとみなして採用しない
    if (!(lat > 20 && lat < 46 && lng > 122 && lng < 154)) return null;
    return { lat, lng, matched: String(hit?.properties?.title || ''), source: 'geocode' };
  } catch {
    return null;
  }
}
