/**
 * 自動運転を「パソコンの機能」として登録する（macOS launchd）。
 *
 * ★ユーザー指定の絶対ルール：
 *   「scheduler:loop を『PCをつけっぱなし』だけに依存しない構造にしてください。」
 *   「OS再起動やプロセス停止後に、自動復旧できるようにしてください。」
 *
 * → ターミナルを開いたままにする必要をなくす。登録すると次の2つが常に面倒を見られる。
 *
 *   ① サーバー本体（画面と計算の中身）
 *      KeepAlive=true … 落ちたら自動で立ち上げ直す
 *      RunAtLoad=true … パソコンを起動／ログインしたら自動で立ち上がる
 *
 *   ② 予定表の確認役（5分おき）
 *      StartInterval … 5分ごとに1回だけ動かす。途中で固まっても次の5分で必ずやり直す。
 *      （動かしっぱなしにしないので、固まったまま気づかない、が起きない）
 *
 * ★この登録で動くのは「調べる・数える・学ぶ」だけ。
 *   発注・出品公開・価格変更・広告入札は1行も動かない。
 *
 * 使い方:
 *   npm run scheduler:install    … 登録して、すぐ動かし始める
 *   npm run scheduler:status     … 今どうなっているかを見る
 *   npm run scheduler:uninstall  … 登録を外す（データは消えない）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const HOME = os.homedir();
const AGENT_DIR = path.join(HOME, 'Library', 'LaunchAgents');
const LOG_DIR = path.join(ROOT, 'logs');

const SERVER_LABEL = 'com.amazon-ai-seller-factory.server';
const SCHEDULER_LABEL = 'com.amazon-ai-seller-factory.scheduler';
const PORT = Number(process.env.PORT || 3900);
const INTERVAL_SEC = Math.max(60, Number(process.env.SCHEDULER_INTERVAL_MIN || 5) * 60);

const NODE = process.execPath;
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const SCHEDULER_JS = path.join(ROOT, 'scripts', 'scheduler.mjs');

function xml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function plist({ label, args, runAtLoad, keepAlive, startInterval, out, err }) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${xml(label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...args.map((a) => `    <string>${xml(a)}</string>`),
    '  </array>',
    `  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>`,
    `  <key>RunAtLoad</key><${runAtLoad ? 'true' : 'false'}/>`,
  ];
  if (keepAlive) lines.push('  <key>KeepAlive</key><true/>');
  if (startInterval) lines.push(`  <key>StartInterval</key><integer>${startInterval}</integer>`);
  lines.push(
    `  <key>StandardOutPath</key><string>${xml(out)}</string>`,
    `  <key>StandardErrorPath</key><string>${xml(err)}</string>`,
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    `    <key>PATH</key><string>${xml(`${path.dirname(NODE)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>`,
    `    <key>FACTORY_URL</key><string>http://localhost:${PORT}</string>`,
    `    <key>PORT</key><string>${PORT}</string>`,
    '  </dict>',
    '</dict>',
    '</plist>',
    '',
  );
  return lines.join('\n');
}

function agentPath(label) {
  return path.join(AGENT_DIR, `${label}.plist`);
}

function launchctl(args, { quiet = true } = {}) {
  try {
    return execFileSync('/bin/launchctl', args, { encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });
  } catch (e) {
    return e?.stdout ? String(e.stdout) : '';
  }
}

function uid() {
  return process.getuid ? process.getuid() : 501;
}

function isLoaded(label) {
  const out = launchctl(['list']);
  return out.split('\n').some((l) => l.trim().endsWith(label));
}

function bootout(label) {
  launchctl(['bootout', `gui/${uid()}/${label}`]);
  launchctl(['unload', agentPath(label)]);
}

function bootstrap(label) {
  const p = agentPath(label);
  launchctl(['bootstrap', `gui/${uid()}`, p]);
  if (!isLoaded(label)) launchctl(['load', '-w', p]);
  launchctl(['enable', `gui/${uid()}/${label}`]);
}

// ---- 事前確認 -------------------------------------------------------

function preflight() {
  const problems = [];
  if (process.platform !== 'darwin') {
    problems.push('このコマンドは Mac 専用です（Windows/Linux では cron などに登録してください）');
  }
  if (!fs.existsSync(NEXT_BIN)) {
    problems.push('部品がそろっていません。先に「npm install」を実行してください');
  }
  if (!fs.existsSync(path.join(ROOT, '.next'))) {
    problems.push('本番用の組み立てがまだです。先に「npm run build」を実行してください');
  }
  if (String(process.env.AUTO_PURCHASE).toLowerCase() === 'true') {
    problems.push('AUTO_PURCHASE=true になっています。自動発注は許可されていないので登録しません');
  }
  return problems;
}

// ---- 実行 -----------------------------------------------------------

function install() {
  const problems = preflight();
  if (problems.length) {
    console.error('★登録できませんでした：');
    for (const p of problems) console.error(`  ・${p}`);
    process.exit(1);
  }

  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const serverPlist = plist({
    label: SERVER_LABEL,
    args: [NODE, NEXT_BIN, 'start', '-p', String(PORT)],
    runAtLoad: true,
    keepAlive: true, // ★落ちても自動で立ち上げ直す
    out: path.join(LOG_DIR, 'server.log'),
    err: path.join(LOG_DIR, 'server.error.log'),
  });

  const schedulerPlist = plist({
    label: SCHEDULER_LABEL,
    // ★--loop は使わない。1回だけ動いて終わる形にして、launchd に毎回起こしてもらう。
    //   こうすると「固まったまま動いているつもり」が起きない。
    args: [NODE, SCHEDULER_JS],
    runAtLoad: true,
    startInterval: INTERVAL_SEC,
    out: path.join(LOG_DIR, 'scheduler.log'),
    err: path.join(LOG_DIR, 'scheduler.error.log'),
  });

  for (const [label, body] of [
    [SERVER_LABEL, serverPlist],
    [SCHEDULER_LABEL, schedulerPlist],
  ]) {
    bootout(label); // 古い登録が残っていたら外してから入れ直す
    fs.writeFileSync(agentPath(label), body, 'utf8');
    bootstrap(label);
  }

  console.log('自動運転をパソコンに登録しました。');
  console.log('  ・パソコンを起動（ログイン）すると、画面と自動運転がひとりでに立ち上がります');
  console.log('  ・途中で落ちても、自動で立ち上げ直します');
  console.log(`  ・${INTERVAL_SEC / 60}分おきに「今やる仕事があるか」を確認します`);
  console.log(`  ・画面：http://localhost:${PORT}`);
  console.log(`  ・記録：${LOG_DIR}`);
  console.log('');
  console.log('★動くのは「調べる・数える・学ぶ」だけです。発注・出品公開・価格変更は起きません。');
  console.log('※パソコンの電源が切れている間は動きません。スリープ解除後に自動で追いつきます。');
}

function uninstall() {
  for (const label of [SERVER_LABEL, SCHEDULER_LABEL]) {
    bootout(label);
    try {
      fs.unlinkSync(agentPath(label));
    } catch {
      /* もともと無ければ何もしない */
    }
  }
  console.log('自動運転の登録を外しました（これまでのデータは消えていません）。');
  console.log('もう一度動かしたいときは「npm run scheduler:install」を実行してください。');
}

function status() {
  console.log('■ 自動運転の登録状況');
  for (const [label, name] of [
    [SERVER_LABEL, '画面とサーバー'],
    [SCHEDULER_LABEL, '予定表の確認役'],
  ]) {
    const file = fs.existsSync(agentPath(label));
    const loaded = file && isLoaded(label);
    console.log(`  ・${name}：${!file ? '未登録' : loaded ? '登録ずみ（動いています）' : '登録ずみ（読み込まれていません）'}`);
  }
  const problems = preflight();
  if (problems.length) {
    console.log('■ 先にやること');
    for (const p of problems) console.log(`  ・${p}`);
  }
  console.log(`■ 記録の置き場所：${LOG_DIR}`);
}

const cmd = process.argv[2] || 'install';
if (cmd === 'install') install();
else if (cmd === 'uninstall' || cmd === 'remove') uninstall();
else if (cmd === 'status') status();
else {
  console.error('使い方: node scripts/scheduler-service.mjs [install|uninstall|status]');
  process.exit(1);
}
