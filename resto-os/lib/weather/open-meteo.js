/**
 * Open-Meteo（無料・申込不要・商用利用可）。
 * 過去の実測データも取れるので、あとから取り込んだ昔の売上にも天気を紐づけられる。
 *
 * ここは「取ってきて形をそろえるだけ」。判断は一切しない。
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

// 世界共通の天気コード（WMO）を、お店の人が読む日本語にする
const CODE_TEXT = [
  [[0], '快晴'],
  [[1], '晴れ'],
  [[2], '晴れ時々くもり'],
  [[3], 'くもり'],
  [[45, 48], '霧'],
  [[51, 53, 55], '霧雨'],
  [[56, 57], '着氷性の霧雨'],
  [[61], '弱い雨'],
  [[63], '雨'],
  [[65], '強い雨'],
  [[66, 67], '着氷性の雨'],
  [[71], '弱い雪'],
  [[73], '雪'],
  [[75], '大雪'],
  [[77], '霧雪'],
  [[80], 'にわか雨'],
  [[81], '強いにわか雨'],
  [[82], '激しいにわか雨'],
  [[85, 86], 'にわか雪'],
  [[95], '雷雨'],
  [[96, 99], 'ひょうを伴う雷雨'],
];

export function weatherText(code) {
  const c = Number(code);
  for (const [codes, text] of CODE_TEXT) if (codes.includes(c)) return text;
  return '不明';
}

/** 雨・雪かどうか（似た日を探すときの大分類に使う） */
export function weatherGroup(code) {
  const c = Number(code);
  if (c >= 71 && c <= 77) return 'snow';
  if (c >= 85 && c <= 86) return 'snow';
  if (c >= 95) return 'storm';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if (c === 45 || c === 48) return 'fog';
  if (c === 3) return 'cloudy';
  return 'clear';
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`天気の取得に失敗しました (${res.status})`);
  return res.json();
}

/** 1時間ごとの湿度を、日ごとの平均にならす */
function humidityByDay(hourly) {
  const out = new Map();
  const times = hourly?.time || [];
  const hums = hourly?.relative_humidity_2m || [];
  for (let i = 0; i < times.length; i += 1) {
    const day = String(times[i]).slice(0, 10);
    const v = Number(hums[i]);
    if (!Number.isFinite(v)) continue;
    const cur = out.get(day) || { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    out.set(day, cur);
  }
  const avg = new Map();
  for (const [day, { sum, n }] of out) avg.set(day, n ? Math.round(sum / n) : null);
  return avg;
}

function shape(json) {
  const d = json?.daily;
  if (!d?.time?.length) return [];
  const hum = humidityByDay(json?.hourly);
  const num = (arr, i) => {
    const v = Number(arr?.[i]);
    return Number.isFinite(v) ? v : null;
  };
  return d.time.map((date, i) => {
    const code = num(d.weather_code, i);
    return {
      date,
      code,
      text: code === null ? '' : weatherText(code),
      group: code === null ? '' : weatherGroup(code),
      tempMax: num(d.temperature_2m_max, i),
      tempMin: num(d.temperature_2m_min, i),
      tempAvg: num(d.temperature_2m_mean, i),
      precipMm: num(d.precipitation_sum, i),
      precipProb: num(d.precipitation_probability_max, i),
      humidity: hum.get(date) ?? null,
      windSpeed: num(d.wind_speed_10m_max, i),
    };
  });
}

const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,wind_speed_10m_max';

export const openMeteo = {
  name: 'open-meteo',

  /** これから先の予報（降水確率つき） */
  async forecast(lat, lng, from, to) {
    const url =
      `${FORECAST_URL}?latitude=${lat}&longitude=${lng}` +
      `&daily=${DAILY},precipitation_probability_max` +
      `&hourly=relative_humidity_2m&timezone=Asia%2FTokyo` +
      `&start_date=${from}&end_date=${to}`;
    return shape(await fetchJson(url));
  },

  /**
   * 過ぎた日の実績。
   * 直近10日ほどは予報サービス側に実測が残っているのでそちらを使い、
   * それより古い日は保存庫（archive）から取る。分けるのは、
   * 保存庫への反映に数日かかるため「昨日の実績が空っぽ」になるのを避けるため。
   */
  async actual(lat, lng, from, to) {
    const today = new Date();
    const daysAgo = Math.floor((today - new Date(`${from}T00:00:00Z`)) / 86400000);
    const useArchive = daysAgo > 10;
    if (useArchive) {
      const url =
        `${ARCHIVE_URL}?latitude=${lat}&longitude=${lng}` +
        `&daily=${DAILY}&hourly=relative_humidity_2m&timezone=Asia%2FTokyo` +
        `&start_date=${from}&end_date=${to}`;
      return shape(await fetchJson(url));
    }
    const url =
      `${FORECAST_URL}?latitude=${lat}&longitude=${lng}` +
      `&daily=${DAILY}&hourly=relative_humidity_2m&timezone=Asia%2FTokyo` +
      `&start_date=${from}&end_date=${to}`;
    return shape(await fetchJson(url));
  },
};
