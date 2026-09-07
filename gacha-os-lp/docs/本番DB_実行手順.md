# 本番DBを作る — 実行手順書

**この文書の目的：** 上から順に読んで、その通りに打てば本番DBが用意できる状態にすること。
考える場面は全部この文書の中で終わらせ、当日は判断しないで済むようにします。

- 設計の理由 → `docs/本番DB分離設計.md`
- この文書は「何を押すか」だけを書きます。

> **★この文書を読んだ時点では、まだ何も作りません。**
> 実際の作成・課金は、本人の「作ってよい」が出てからです。
> 第0章の準備がすべて埋まるまで、第2章から先へ進まないでください。

---

## 0. 始める前に（ここが埋まるまで作らない）

| # | 準備 | いま | 誰が |
|---|---|---|---|
| 0-1 | Turso の支払い方法が登録されている | **未確認** | 本人 |
| 0-2 | どのプランにするかを決めた（第1章） | **未決** | 本人 |
| 0-3 | 控えの保管先を決めた（暗号化・置き場所） | **未決** | 本人 |
| 0-4 | メール送信会社が決まっている | **未** | 本人 |
| 0-5 | 決済会社の審査が通っている | **未** | 本人 |

**0-4・0-5 が未了でも、DBを作ること自体はできます。**
ただし、その状態で**お客様を入れてはいけません**（メールが出ない・入金できない）。

---

## 1. どのプランにするか（お金の話）

Turso の公開価格。**2026-09-07 に確認**。価格も保持期間も向こうの都合で変わるので、
**申し込む日にもう一度、本人の目で見てください。**

出典：https://turso.tech/pricing ／ https://docs.turso.tech/features/point-in-time-recovery

| プラン | 月額 | 容量 | 指定時点への復元（PITR）の保持 |
|---|---|---|---|
| Free | $0 | 5GB | **24時間** |
| Developer | $4.99 | 9GB | 約10日 |
| Scaler | $24.92 | 24GB | 30日 |
| Pro | $416.58 | 50GB | 90日 |

### 決めの目安（判断の材料。決めるのは本人）

- **Free で本番を始めないこと。** 戻せるのが24時間ぶんだけです。
  金曜に壊れて月曜に気づいたら、もう戻せません。
- 現実的な入口は **Scaler（30日）**。第3章の自前の控え（30日＋月末12か月）と
  保持期間が揃うので、運用の説明が1本で済みます。
- Developer（約10日）でも動きますが、**自前の控えを必ず毎日取る**ことが前提です。

> **★いまの契約プランは、この文書からは確認できませんでした。**
> `turso plan show` は組織の解決に失敗して答えを返しません（2026-09-07）。
> **プランは、Turso の管理画面で本人が目で見て確認してください。**
> 「たぶん Free のはず」で本番を作らないこと。

---

## 2. いまの状態（2026-09-07 に実際に確認した中身）

作る前に、すでに何があるかを確かめてあります。**推測ではなく実物です。**

```
組織   personal（ethereal-gemini-tim5oq）… いま選ばれている
       vercel-icfg-xuuu2kzz83gpxufkzznayine … Vercel連携で自動的にできた組織

グループ  jp       … 東京（aws-ap-northeast-1）
          default  … アイルランド（aws-eu-west-1）

いまあるDB
  ai-sales-os        jp        東京
  gacha-os-preview   jp        東京    ← このシステムの検証用。14MB
  resto-os           jp        東京
  nippou-db          default   アイルランド
```

**分かったこと（そのまま手順に反映しています）**

1. **本番DBは、まだ1つもありません。** 名前に `prod` が付いたものはゼロです。
2. **検証DB `gacha-os-preview` は、すでに東京にあります。** 新しく作る必要はありません。
3. **`gacha-os-preview` は削除保護が「No」です。** 打ち間違いで消せる状態です。
   → 第6章で、本番と一緒に保護を掛けます。
4. 東京は `aws-ap-northeast-1`。**この account では既定の場所**なので、
   場所の指定を忘れても東京になります。ただし手順では明示的に書きます。

---

## 3. 本番DBを作る

### 3-1. 名前を決める

```
本番   gacha-os-prod
検証   gacha-os-preview   ← すでに在る
```

> **★名前に `prod` を入れるのは、見た目のためではありません。**
> `scripts/db-dump.mjs` などの安全装置が、**URLに `prod` という文字が
> 入っているかどうかで本番を判定して止めています**。
> 名前に `prod` が無い本番DBを作ると、**その安全装置が全部きかなくなります。**

### 3-2. 作る（1行）

```bash
turso db create gacha-os-prod --group jp --location aws-ap-northeast-1 --wait
```

**こう出れば成功です**（`--wait` を付けているので、使える状態になるまで待ちます）：

```
Created database gacha-os-prod at group jp in ... seconds.
```

### 3-3. 場所とURLを確認する

```bash
turso db show gacha-os-prod
```

**必ず目で確かめること：**

- `Group: jp`
- `Locations: aws-ap-northeast-1`（東京。ここが他の国だと、日本のお客様に遅くなります）
- `URL:` の中に **`prod` という文字が入っている**こと

URLはこの形になります（`xxxx` は組織ごとに違います）：

```
libsql://gacha-os-prod-ethereal-gemini-tim5oq.aws-ap-northeast-1.turso.io
```

### 3-4. つなぐための鍵を作る

```bash
turso db tokens create gacha-os-prod
```

長い文字列が1本出ます。**これが本番の鍵です。**

> **★この鍵の扱い**
> - 画面に出たものを、そのまま人に見せない・貼らない・チャットに流さない。
> - **リポジトリの中のファイルに書かない。**
> - 置き場所は Vercel の環境変数（第5章）と、本人のパスワード管理ソフトだけ。
> - 既定では期限が無い（`never`）ので、漏れたら作り直すまで有効です。

---

## 4. 削除保護を掛ける（本番と検証の両方）

```bash
turso db config delete-protection enable gacha-os-prod
turso db config delete-protection enable gacha-os-preview
```

確認：

```bash
turso db config delete-protection show gacha-os-prod
```

> **★なぜ検証にも掛けるのか。**
> `turso db destroy gacha-os-preview` と打つつもりで
> `gacha-os-prod` と打つ事故より、**逆のほうが起きます**。
> どちらも消えて困るので、両方に掛けます。

---

## 5. Vercel に環境変数を入れる

本番（Production）にだけ、次の4つを入れます。

| 変数 | 入れる値 |
|---|---|
| `DATABASE_ENV` | `production` |
| `DATABASE_URL` | 3-3 で確認した `libsql://gacha-os-prod-....turso.io` |
| `DATABASE_AUTH_TOKEN` | 3-4 で出た鍵 |
| `ALLOW_PRODUCTION_DB` | `yes-i-am-sure` |

**画面での入れ方**

```
Vercel → プロジェクト gacha-os-lp → Settings → Environment Variables
→ Add New → Key と Value を入れる
→ Environment は 「Production」だけにチェック（Preview と Development は外す）
→ Save
```

> **★「Production」だけにチェックすること。**
> 3つ全部にチェックを入れると、**検証環境が本番DBを触ります**。
> それは、この設計で防ごうとしている事故そのものです。

`ALLOW_PRODUCTION_DB` は「うっかり本番に向いた」を止める2つ目の鍵です
（`lib/server/db.ts` の `databaseUrl()`）。
これが無いと、`DATABASE_ENV=production` でも接続そのものが例外で止まります。

**入れ終わったら、再デプロイが要ります**（環境変数は既存のデプロイには反映されません）。

---

## 6. 表の作りを、最新まで進める

お客様が来る前に、**人の手で1回**走らせます。

```bash
cd gacha-os-lp

DATABASE_ENV=production \
ALLOW_PRODUCTION_DB=yes-i-am-sure \
DATABASE_URL="libsql://gacha-os-prod-....turso.io" \
DATABASE_AUTH_TOKEN="（3-4の鍵）" \
MIGRATE_ALLOW_PRODUCTION=yes-i-am-migrating \
npm run db:migrate
```

**成功すると、こう出ます：**

```
  MIGRATION_OK = YES（20 段）
  いちばん新しい段 : 020_tenant_domains_grade_labels
```

> **★なぜ手で走らせるのか。**
> 本体は「誰かが最初にアクセスした時」に足りない段を自動で当てます。
> 手元ではそれで困りませんが、本番でそれをやると
> **最初のお客様が、20段の作り替えの引き金を引く**ことになります。
> その人はいちばん遅い画面を見せられ、途中で失敗すればその人の目の前で壊れます。
> だから、お客様が来る前に済ませます。

`MIGRATION_OK = NO` が出たら、**そこで止めて先へ進まないこと。**
特に「見覚えのない段」と出た場合は、そのDBが**いまのプログラムより新しい版**で
使われた可能性があります。古い版のままつなぐと壊します。

---

## 7. 空であること・混ざっていないことを確かめる

```bash
DATABASE_ENV=production \
DATABASE_URL="libsql://gacha-os-prod-....turso.io" \
DATABASE_AUTH_TOKEN="（3-4の鍵）" \
PRODUCTION_READ_ALLOW=yes-i-am-only-reading \
npm run db:check-clean
```

作った直後なので、**こう出るのが正しい状態です：**

```
  PRODUCTION_CLEAN = YES
  試験用のデータは見つかりませんでした。
  （参考）お店 0 店 ／ 会員 0 人
```

この道具は**件数とお店コードしか出しません**。
お客様の氏名・住所・メールは画面に出ないので、報告に貼っても漏れません。

> **★この道具は、何も直しません。** 見つかっても消す判断は人がします。
> 自動で消す形に変えないこと。いつか本物のお客様を消します。

---

## 8. 最初の控えを取る（お店を作る前に1回）

```bash
DATABASE_ENV=production \
DATABASE_URL="libsql://gacha-os-prod-....turso.io" \
DATABASE_AUTH_TOKEN="（3-4の鍵）" \
BACKUP_ALLOW_PRODUCTION=yes-i-am-taking-a-backup \
npm run db:dump -- ~/gacha-os-backup/2026-09-07-初回
```

空のうちに1回取っておくと、「戻す練習」が安全にできます。

> **★置き場所は、必ずこのリポジトリの外にすること。**
> 道具のほうでも禁止してあります（`.data` の下だけは試し用に許しています）。
> 控えには**お客様の氏名・住所・メールが入ります**。
> リポジトリの中に置くと、いつか誰かが commit します。

**取った控えは、必ずこれで確かめます：**

```bash
npm run db:restore-verify -- ~/gacha-os-backup/2026-09-07-初回
```

```
  RESTORE_VERIFIED = YES
```

> **★「バックアップが取れた」で終わらせないこと。**
> 取っただけの控えは控えではありません。**戻せて初めて控えです。**
> この道具は、空の新しいDBへ実際に戻して、
> 表の数・行数・指紋・ポイント残高・監査の鎖まで突き合わせます。

**控えの置き場所（第0章 0-3 で決めておくこと）**

| 項目 | 決め |
|---|---|
| どこへ | 本人が管理する保管先。**リポジトリには入れない** |
| 何日 | 直近30日ぶん＋月末ぶんを12か月 |
| 守り | 保管先は暗号化。共有リンクを作らない |

控えの中身には**お客様の氏名・住所・メールが入ります**。
置き場所を決めずに取り始めないこと。取った控えの置き忘れが、いちばん多い漏れ方です。

---

## 9. 戻し方（壊れた日にやること）

### 9-1. Turso の指定時点への復元（PITR）

Turso 側の復元は、**新しいDBを作る形**でしか行われません。
元のDBは書き換わりません。

```bash
turso db create gacha-os-prod-restore \
  --from-db gacha-os-prod \
  --timestamp 2026-09-07T10:00:00+09:00
```

- 時刻は RFC3339 の形（`+09:00` が日本時間）。
- 戻せる範囲はプランの保持期間まで（第1章）。
- 出典：https://docs.turso.tech/features/point-in-time-recovery （2026-09-07 確認）

### 9-2. 自前の控えから戻す

```bash
npm run db:restore-verify -- .data/backup-prod-YYYYMMDD
```

これは**検証用の新しいDBへ**戻して確かめるところまでをやります。

### 9-3. 順番（ここを守る）

```
① まず止める（動いたまま戻すと、戻した後の書き込みが混ざる）
② 戻す先は、必ず「新しいDB」。★元のDBの上に直接書き戻さない
③ 新しいDBで RESTORE_VERIFIED = YES を確認する
④ 確認できてから、Vercel の DATABASE_URL を新しいDBへ向け替えて再デプロイ
⑤ 古いDBは消さずに残す（原因を調べるため）
```

> **★②が最重要です。**
> 壊れたDBの上に控えを書き戻すと、「壊れた状態」と「戻した状態」が混ざり、
> 何が本当か誰にも分からなくなります。原因調査もできなくなります。

---

## 10. コードの版を戻すとき（Rollback）

**コードを戻すことと、表の作りを戻すことは、別の話です。**

- Vercel でひとつ前のデプロイに戻すのは、コードだけが戻ります。
- **表の作り（段）は戻りません。** 20段のままです。
- 設計上、段は「前へだけ進める」ので、
  ひとつ前のコードは20段のDBでもそのまま動きます
  （列を消さない・名前を変えない、を守っている限り）。
- **段そのものを戻したくなったら、それは第9章の「戻す」です。**
  ひとつ前のデプロイに戻すことでは解決しません。

---

## 11. 終わったかの確認表

上から順に、全部 ✅ になって初めて「本番DBが用意できた」です。

| # | やること | 確認のしかた | いま |
|---|---|---|---|
| 1 | プランを決めて契約した | Turso の管理画面を目で見る | **未** |
| 2 | `gacha-os-prod` を東京に作った | `turso db show` で `aws-ap-northeast-1` | **未** |
| 3 | URLに `prod` が入っている | `turso db show` の URL 行 | **未** |
| 4 | 鍵を作り、安全な場所に置いた | パスワード管理ソフト | **未** |
| 5 | 本番・検証の両方に削除保護を掛けた | `delete-protection show` | **未** |
| 6 | Vercel の Production だけに4変数を入れた | Vercel の画面 | **未** |
| 7 | 再デプロイした | Vercel の画面 | **未** |
| 8 | `MIGRATION_OK = YES（20 段）` | `npm run db:migrate` | **未** |
| 9 | `PRODUCTION_CLEAN = YES` | `npm run db:check-clean` | **未** |
| 10 | `RESTORE_VERIFIED = YES` | `npm run db:dump` → `db:restore-verify` | **未** |
| 11 | 控えの保管先を決めて、実際に1本置いた | 保管先を目で見る | **未** |

**この11個が終わるまで、本番DBへは1件も書き込みません。**

---

## 12. 使う道具の一覧

| コマンド | 何をするか | 本番で要る合図 |
|---|---|---|
| `npm run db:migrate` | 表の作りを最新の段まで進める | `MIGRATE_ALLOW_PRODUCTION=yes-i-am-migrating` |
| `npm run db:check-clean` | 試験用データが混ざっていないか**読むだけ** | `PRODUCTION_READ_ALLOW=yes-i-am-only-reading` |
| `npm run db:dump` | 控えを取る | `BACKUP_ALLOW_PRODUCTION=yes-i-am-taking-a-backup` |
| `npm run db:restore-verify` | 控えを新しいDBへ戻して突き合わせる | （本番には向けられません） |
| `npm run check:db` | 全部の道具が本番で止まるかを点検する | 不要 |

**合図（環境変数）が全部バラバラなのは、わざとです。**
1つ覚えて使い回せてしまうと、「読むだけのつもり」で書く道具を動かせてしまいます。

---

## 13. 確定していないこと（埋めるまで本番運用しない）

**推測で埋めていません。不明は不明と書きます。**

| # | 項目 | 状態 |
|---|---|---|
| 13-1 | いまの契約プラン | **未確認**（`turso plan show` が答えを返さない） |
| 13-2 | このアカウントで PITR が実際に何日ぶん効くか | **未確認**（プランが未確認のため） |
| 13-3 | 控えの保管先・暗号化の方法 | **未決**（本人が決める） |
| 13-4 | メール送信会社の契約と DKIM/SPF/DMARC | **未** |
| 13-5 | 決済会社の審査結果 | **未**（断定しないこと。契約形態で変わります） |
| 13-6 | Vercel 本番の `CONTACT_WEBHOOK_URL` が入っているか | **未確認**（第14章） |

---

## 14. 別件だが、先に確かめたいこと

`app/api/contact/route.ts` は、`CONTACT_WEBHOOK_URL` が入っていないとき、
本番では **503 を返して「ただいまフォームからの受付ができません」** と出します
（嘘をつかない作りにしてあるため）。

**いま os.morika.work には Google 広告でお金をかけて人を集めています。**
もしこの変数が入っていないと、**相談が1件も届かないまま広告費だけが出ます。**

確かめ方は次のどちらかです。**どちらも本人の許可が要ります。**

- Vercel の画面で `CONTACT_WEBHOOK_URL` があるかを見る（安全）
- 本番のフォームを実際に送る → **本物の営業リードが1件できるので、やりません**

---

**この文書の確認日：2026-09-07**
Turso の価格・保持期間・コマンドは向こうの都合で変わります。
実行する日に、必ずもう一度、一次情報を見てください。
