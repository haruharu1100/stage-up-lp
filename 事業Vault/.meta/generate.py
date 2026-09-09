#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""事業Vault 生成スクリプト（再生成可能）。
プロジェクト定義を1か所に集約し、ホーム/カテゴリMOC/各プロジェクトノート/索引/日次/テンプレを吐き出す。
新しいプロジェクトが増えたら PROJECTS に1行足して python3 .meta/generate.py を実行するだけ。"""
import os, datetime

VAULT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TODAY = "2026-08-07"

# (title, folder, category, status, priority, summary, next_action)
PROJECTS = [
 # 💰 本業・収益直結
 ("通信アフィリLP運用（本業）", "affiliate/", "本業", "運用中", "最高",
  "通信ジャンルのアフィリLPを data/*.json から一括生成し affiliate/lp/ に出力して運用する本業システム。B2B提案LPとは完全別系統。", "流入経路（Shorts・診断・レビューブログ）を束ねてCV最大化。数値をこのVaultで週次追跡。"),
 ("通信まるごと診断アプリ", "affiliate/shindan.html", "本業", "運用中", "高",
  "補助金診断UXを通信に転用した診断型リード獲得LP。設問に答えると最適プランを提示しアフィリへ誘導。", "回答完了率とアフィリ遷移率を計測。"),
 ("レビューブログ（月10万PV目標）", "gorogoro-growth/", "本業", "保留", "高",
  "集客本体は Cloudflare 静的サイト review.gorogorogacha.com。gorogoro-growth はブログ自動成長エージェント（定期実行の指示書）。", "ブロッカー: GA未接続 / cron要承認。まずGA接続と定期実行の承認を取る。"),
 ("YouTube Shorts自動化（通信流入）", "youtube_shorts/", "本業", "運用中", "高",
  "通信LPへのオーガニック流入装置。Phase1完了。月30万円規模の流入を想定。", "投稿本数と流入→CVを追跡。Phase2の伸ばし方を検討。"),
 ("補助金ショート自動化", "youtube_auto_upload/", "本業", "開発中", "中",
  "補助金営業ショート動画の完全自動生成・投稿。立場は相談窓口・安全表現必須。", "自動生成→投稿パイプの安定化。安全表現チェックの徹底。"),

 # 🃏 トレカ・EC・せどり
 ("ごろごろガチャ（オリパEC）", "gorogorogacha-引き渡し用/", "トレカ・EC", "運用中", "高",
  "トレカ・オリパEC「ゴロゴロ」。有名オリパサイトに倣った構成。", "在庫/演出/集客の各施策を回す。"),
 ("ごろごろガチャ インフラ/SSL", "gorogorogacha-引き渡し用/", "トレカ・EC", "運用中", "中",
  "gorogorogacha.com のDNS。2026-07-08にNSをCloudflareへ移管。EC/wwwはAWS直結・blogのみProxiedでSSL化。", "証明書・DNSの死活監視。"),
 ("ごろごろガチャ 集客/SEO", "gorogoro-growth/", "トレカ・EC", "施策中", "中",
  "GMO広告打合せ由来。Yahoo!広告中心＋ユーザーサイトにコラム連載でSEO/LLMO/GEO対策。", "広告×自然検索×AI検索で継続流入を作る。"),
 ("ブログ→Instagram/Threads自動投稿", "blog-to-social/", "トレカ・EC", "開発中", "中",
  "blog.gorogorogacha.com の新着記事を検知し、Claude(claude-sonnet-4-6)でカルーセル構成8〜10枚＋キャプション＋Threads本文を生成→Playwrightで1080×1350のPNG化(ブランド黒×金)→Cloudflare R2へアップロード→Instagram/Threadsへ自動投稿する集客システム。1日1回cron・人手ゼロ設計。長期トークンは50日で自動更新。TypeScript+Node実装。RSS(https://blog.gorogorogacha.com/?feed=rss2)とClaudeキーは設定済み。画像置き場はR2ではなくブログのメディア機能を流用(既存のブログ認証を再利用・新規アカウント不要)に変更しアップロードも実機確認済み。--dry-run(画像10枚生成)＋アップロードまで動作確認済み。npm run checkで接続状況を一覧表示。重複投稿はstate/posted.jsonで防止、IG成功/Threads失敗の部分再投稿にも対応。", "残るはInstagram/Threadsの接続のみ(ユーザー側の手作業)=①Meta開発者アプリ(META_APP_ID/SECRET)②Instagramビジネス長期トークン(IG_USER_ID/IG_ACCESS_TOKEN)③Threadsトークン(THREADS_USER_ID/ACCESS_TOKEN)。取得値を blog-to-social/.env に入れれば本投稿→cron登録で無人運用に入る。取得手順は blog-to-social/README.md。"),
 ("ジャンル別ガチャ量産（8サイト）", "sneaker-gacha/", "トレカ・EC", "本番公開準備中", "高",
  "ゴロゴロを複製しスニーカー/ハイブランド/時計/アクセ/ワンピ/遊戯王/ゲーム/家電の8サイト量産。運営はREMERCI株式会社(大阪府和泉市阪本町376-161/代表よこたはるき)で全サイト共通。1号=キクソラ(sneaker-gacha/)は実データ72品(Travis Scott AJ1等)を投入済み・商品「スニーカー319チャレンジ」270pt×55,000口・還元率88.8%に調整済。管理画面(/admin)は見やすさ優先で白基調(light)＋赤アクセントに調整済み(2026-07-30)。", "【AWS再利用の答え=はい】既存AWSはkicksluck一式が適用済(tfstate有・52リソース稼働: EC2 i-05058f/ALB/ECR kicksluck/app/S3/Secrets/WAF/毎日スナップショット・acct382975714945)。sneaker-gachaは同名リソース設計→applyは名前衝突するのでやらない。★再利用=Dockerイメージをビルド→既存ECRへpush→既存EC2でkicksluck-redeployだけ(新規インフラ・二重課金なし)。実デプロイ/課金GOはユーザー承認ゲート(まだ公開しない)。HTTPS/独自ドメインはACM証明書ARN+domain_nameをtfvars追記→applyの追加のみ。自動運用6段=⑤設計100%超で自動停止・⑥現在98%超を毎晩3時±10分に90%以下まで運営回収(return-guard.js・server.js起動時にscheduleNightly稼働)。①〜④はsneaker-gacha/pipeline/に実装・検証済(依存ゼロ・完全ローカル): ①generate-spreadsheet.js(還元率≤90%保証のCSV自動生成)②import-to-site.js(下書き/公開予約publish_atで取込)③make-thumbnail.js(1080角サムネをqlmanageでPNG化・qlはmac専用)④x-post.js(OAuth1.0a依存ゼロ・既定ドライラン・実投稿は専用Xキー+承認+--live)＋run-daily.jsで①→③→②→④一気通貫。残=X実投稿の有効化(キクソラ専用Xキー待ち)・本番へのパイプライン接続(要承認)・残り7サイト横展開。"),
 ("カード相場トラッカー", "card-tracker/", "トレカ・EC", "運用中", "高",
  "スニダンのポケカ/ワンピカ単品相場を毎日CSV記録（ウォッチリスト方式・依存ゼロ）。週次でシステムガチャ用相場を自動更新。", "週次自動更新の死活確認。1桁誤り=1億損失を常に警戒し検証必須。"),
 ("買取＆販売表メーカー", "card-tracker/table/", "トレカ・EC", "運用中", "中",
  "スニダン相場＋画像から買取/販売表を1枚のPNG画像で自動生成（Xに貼れる）。", "テンプレの見栄え改善。"),
 ("ガチャ宣伝しゃべるショート", "gacha-promo/", "トレカ・EC", "開発中", "中",
  "ごろごろガチャのキャラ1枚絵がしゃべる縦型宣伝ショートをAI自動生成（口パク/VOICEVOX）。", "品質要求が厳しい。静止絵＋簡易描画はNG、アニメ風に動く高品質を出す。"),
 ("ガチャ演出動画（販売用）", "gacha-enshutsu/", "トレカ・EC", "開発中", "中",
  "ガチャ演出アニメ20秒(見せ場5)を商品として販売。Claude指示文→ユーザー手作業(ChatGPT/renoise)→Claude最終編集。宝探し「ココホレ1等」演出動画を制作(掘る→宝箱がギィーと開く→金色バースト→プチュン=パチンコ風フリーズ→虹色「1等」が宝箱からにゅっと出て高画質画像でフィニッシュ)。素材/中間物=~/Downloads/_bgm_build、完成映像=~/Downloads/ココホレ1等_BGMなし.mp4。★BGM(音楽)はAIが付けずユーザー本人がテンポを合わせて付ける方針(AIが付けたBGMはテンポずれで不採用)。参考: audiostock5曲(1410407=イントロ/1395645=アクセント/400076=クレッシェンド/1402357=一撃/75515=勝利)で参照動画806844553の構成を再現した版も作成済。", "★Higgsfield MCPで演出映像を生成したい(現状この環境に未接続・レジストリにも無し→接続情報が届いたら設定する)。BGMのテンポ合わせは本人が実施。見せ場の質を上げて単価UP。"),
 ("reseller-radar（せどり価格巡回）", "reseller-radar/", "トレカ・EC", "運用中", "高",
  "Next.js 14 + libsql のせどり向け価格巡回アプリ。Render常駐＋毎日cron巡回。アクティブ開発中の代表アプリ。", "テストモード(常時Pro)の扱いを整理。巡回精度と通知の改善。"),
 ("Amazon物販まるごと自動化", "amazon-auto-seller/", "トレカ・EC", "開発中", "中",
  "リサーチ〜商品ページ〜紹介動画〜広告を全自動化し「せどりはもう古い」で代行サービスとして売る。", "代行サービスとしての提供形態を固める。"),
 ("買取まるごと自動化（GAS）", "kaitori-system/", "トレカ・EC", "運用中", "中",
  "買取依頼書の写真をAIが読み取りGoogleスプレッドシートに自動記入・お礼電話リスト化・日報自動生成するGASアプリ。", "読取精度の確認。"),
 ("kicksluck（スニーカーEC）", "kicksluck/", "トレカ・EC", "要確認", "低",
  "スニーカー系プロジェクト。card-tracker のGoogleサービスアカウント認証情報(.env)の置き場でもある。本番公開前チェックリストあり。", "正体と現状を要確認。"),
 ("X自動投稿（ゴロゴロ・GAS）", "x-auto-poster/", "トレカ・EC", "運用中", "低",
  "ゴロゴロ X自動投稿システム（GAS: config/generate/image）。", "投稿頻度と内容の最適化。"),

 # 🎬 動画自動化
 ("長尺ミステリー動画", "mystery_video/", "動画", "開発中", "中",
  "未解決事件解説型(横型)のAI半自動生成。フィクション固定・台本/音声/映像の3段、全自動化目標。", "ポップ重視・高品質。常設チラ見せ文字は嫌う。Pexels継続・BGMはJamendo。"),
 ("ずんだもん解説動画", "zunda_video/", "動画", "開発中", "中",
  "ずんだもん×四国めたんの掛け合い解説。VOICEVOX立ち絵＋AI背景、話者ハイライト演出。", "話者切替演出の磨き込み。"),
 ("雑学チャンネル（横型・完全自動）", "trivia-channel/", "動画", "開発中", "中",
  "「知ると“そうだったのか”」な雑学の横型3-6分動画を完全自動生成・投稿。Claude台本→ElevenLabs→OpenAIサムネ→Remotion→YouTube。", "投稿の完全自動化を安定運用へ。"),
 ("パルクールアニメ量産", "parkour-anime/", "動画", "開発中", "低",
  "Mixamoモーション→Blenderで動画素材自動化→Seedanceでアニメ化しYouTube投稿する量産システム。", "量産パイプの安定化。"),
 ("リアクションニュース動画", "reaction-news/", "動画", "開発中", "低",
  "3D/ピクサー風キャラがスマホを見て驚くニュース系縦型ショートをAI自動生成（ai_news風テロップ／口パク無しでカメラ演出）。", "テロップ演出の質。"),
 ("紙芝居型アニメコント", "anime-konto/", "動画", "運用中", "低",
  "横型YouTube向けコント。喋る人だけ口パク＋顔アップ切替＋下字幕。第1話コンビニ完成済み。", "第2話以降の量産。"),
 ("AIダンス生成アプリ", "ai-dance/", "動画", "開発中", "低",
  "人物画像＋参照動画→動きを反映した動画を生成するWebアプリ。Next.js+Replicate(mimic-motion)、生成はクラウド側。", "生成品質と速度の確認。"),
 ("YouTubeライブ配信（VTuber型）", "youtube-live-vtuber/", "動画", "開発中", "低",
  "自分の声→高木さんボイスにリアルタイム変換＋お姉さん顔で動くYouTube生配信。声はFish TTS→RVC→w-okada。", "リアルタイム変換の遅延・安定性。"),
 ("LINEマンガ自動制作", "line-manga/", "動画", "開発中", "低",
  "LINEマンガ 縦読み恋愛漫画 自動制作システム（引き継ぎ書あり）。", "自動制作パイプの確認。"),
 ("歴史アニメ", "history-anime/", "動画", "要確認", "低",
  "歴史アニメ動画系プロジェクト（詳細未確認）。", "正体と現状を要確認。"),
 ("ai-fal-video", "ai-fal-video/", "動画", "要確認", "低",
  "fal.ai 系の動画生成プロジェクト（詳細未確認）。", "正体と現状を要確認。"),

 # 🤖 AIツール・アプリ・SNS
 ("AIスタジオ（画像・動画生成）", "ai-studio/", "AIツール", "開発中", "中",
  "日本語の指示文から画像/動画をボタン1つで作るローカル生成システム。ComfyUIをエンジンに流用。", "UIと生成安定性。"),
 ("AI美女インフルエンサー量産", "ai-influencer/", "AIツール", "開発中", "中",
  "実在しないAI美女の写真をローカル無料で量産（ComfyUI+SDXL+IPAdapter FaceID）。顔固定が核心。", "顔固定の再現性。"),
 ("SNS自動投稿エンジン", "sns-auto-poster/", "AIツール", "開発中", "中",
  "X/Insta/Threadsへオリジナル投稿を自動化する集客エンジン。丸パクリ/IP偽装は不採用。方針確定=X課金回避で『AI下書き→コピペ手動投稿(無料)』、Insta/Threadsは無料の公式Graph APIで自動投稿。接続キーはdata/credentials.json(0600)に保存し画面に実値は出さない。", "【今の実接続状況】保存済みキーはX(x_main)のみ＝Insta/Threadsは連携プログラム(threads_client.py/instagram_client.py)は完成済みだが公式連携キー・アカウント未登録＝まだ繋がっていない。次アクション: Insta/Threadsの公式OAuth連携キーを取得し登録(鍵の入力はセキュリティ上ご本人の操作)。"),
 ("AIコンパニオンアプリ", "ai-companion-app/", "AIツール", "計画中", "中",
  "女性AIキャラと毎日会話するiOS課金アプリ。RN+Supabase+RevenueCat。設計書一式作成済み・コード未着手。", "実装着手の判断。"),
 ("AI客ロープレ練習システム", "roleplay-trainer/", "AIツール", "公開中（販売準備）", "中",
  "買取・営業スタッフがAI客とリアルタイム音声で接客練習しAIが自動採点する研修システム。公開URL=https://roleplay-trainer-liard.vercel.app。テキストMVPから刷新: 会話=OpenAI Realtime(gpt-realtime・応答約0.3秒・自動ターン検出)、頭脳=Groq(llama-3.3-70b)、声=ElevenLabs Flash、採点=Claude。100種超のAI客＋態度6種、信用度/警戒度メーターが会話中に変動、減点方式の自動採点、カメラ表情採点、キャラ立ち絵の口パク(管理画面から画像アップロード)。Next.js+Supabase+Vercel。ココナラで構築代行として販売予定(¥49,800〜、モニター¥19,800〜)。Realtimeの利用料は約¥20〜35/分・買い手アカウント従量。", "ココナラ出品(タイトル/内容/カテゴリ=営業・セールス設定済)。おばあちゃん/青年/少女のキャラ画像追加(おじいちゃんは用意済)。30秒デモ動画。買取専門特化版の訴求。同方式をai-call-system(電話営業)へ横展開。"),
 ("営業支援AIコールシステム", "ai-call-system/", "AIツール", "開発中", "中",
  "同意取得済み顧客だけに架電するTwilio×OpenAI×Supabaseの営業支援AIコール。NGリスト最優先。MVP実装済み。", "NGリスト運用と架電品質。"),
 ("顔差し替え（フェイススワップ）", "realtime-face/", "AIツール", "運用中", "低",
  "録画動画の顔をキャラ顔に差し替えるオフライン高画質ツール（ダブルクリック起動）。", "画質の維持。"),
 ("LP自動制作オーケストレーター", "lp-ai-orchestrator/", "AIツール", "開発中", "中",
  "Claude×OpenAIで売れるLPを自動生成。plan/build/review/autoの4モード。", "生成LPの品質評価。"),
 ("AI漫画Studio", "ai-manga-studio/", "AIツール", "開発中", "低",
  "AI漫画Studio。漫画制作支援ツール（詳細READMEあり）。", "現状の到達点を要確認。"),
 ("AI業務改善パートナー", "ai-gyomu-kaizen/", "AIツール", "要確認", "低",
  "AI業務改善パートナー（詳細未確認）。", "正体と現状を要確認。"),
 ("Shopify運営オペレーター", "shopify-claude-operator/", "AIツール", "要確認", "低",
  "Shopify × Claude 運営オペレーター。ECの運営自動化系（詳細未確認）。", "正体と現状を要確認。"),
 ("リアルタイム音声チャット", "realtime-voice-chat/", "AIツール", "要確認", "低",
  "リアルタイム音声チャット系（詳細未確認）。", "正体と現状を要確認。"),
 ("Stable Diffusion環境", "stable-diffusion/", "AIツール", "環境", "低",
  "画像生成のローカル環境（各生成系プロジェクトの土台）。", "各プロジェクトから流用。"),

 # 🏢 STAGE UP・その他サイト・業務
 ("トレリア広告運用（代行）", "-", "STAGE UP・その他", "停止", "高",
  "先方（treria.com）のために自分のガチャ用ディスプレイ広告アカウントで代行運用していたLINEヤフー広告。2026-07-28にアカウント（ＲＥＭＥＲＣＩ株式会社／ルートMCC 1002817771）がヤフーに「取引停止」にされていたと判明（広告取扱基本規定 第19条1項18号＝本人確認できない）。設定問題ではなくアカウント停止が配信ゼロの真因。詳細は本ノート参照。", "平日朝いちにヤフーサポートへ連絡し本人確認でアカウント復旧を要請。困難なら先方の正規アカウントへ出稿を切替。"),
 ("STAGE UP 法人営業LP（ルート）", ".", "STAGE UP・その他", "運用中", "高",
  "Vercelにデプロイされる法人営業LP本体。api/auth.js のBasic認証で /admin と _proposals/<slug>.html を保護。vercel.json がルーティングの中枢。", "新規企業は ACCOUNTS にslug追加＋_proposals/<slug>.html を作りpushで自動デプロイ。"),
 ("写真から商品ラベル登録＋せどり相場ツール（GAS）", "photo-label-system/", "トレカ・EC", "運用中", "高",
  "写真をAIが読み取り型番/商品名/メーカー名をスプレッドシートに追加し1枚4面ラベルで印刷するGASアプリ。加えて『せどりサポートツール』を搭載＝写真→型番/商品名を判別→Keepa連携でAmazonのコンディション別価格(新品/中古ほぼ新品/非常に良い/良い/可)・出品数・直近1ヶ月の販売個数(合計)・売れ筋ランクを画面内表示。Keepa APIキー設定済み・実データ稼働中。複数Googleアカウント(k.tkya27等)で利用可・商品履歴/利用記録あり。", "このツール自体を商品として販売する方針。販売は月額(サブスク)推奨=追加なし版 月1,980〜3,980円/追加あり版 月4,980〜7,980円(プライスター月5,280円が競合)。次フェーズ: Amazonセラー連携(SP-API)でプライスター相当=仕入/販売価格管理・赤字ストッパー(下限死守)・自動追随を段階実装。まず設計フェーズ。"),
 ("健康ブログ（WordPress）", "health-blog/", "STAGE UP・その他", "運用中", "低",
  "健康ジャンルのWordPressブログ。", "運用継続。"),
 ("復縁占いラボ（占いLP）", "fukuen-lab/", "STAGE UP・その他", "運用中", "低",
  "復縁占いラボのLP。Google Tag Assistant 計測手順あり。", "計測とCV確認。"),
 ("BLASTS公式LINE Bot", "line-bot/", "STAGE UP・その他", "要確認", "低",
  "BLASTS 公式LINE 自動返信Bot（詳細仕様書あり）。", "稼働状況を要確認。"),
 ("Gmailチェッカー", "gmail-checker/", "STAGE UP・その他", "要確認", "低",
  "Gmail監視/通知系ツール（詳細未確認）。", "正体と現状を要確認。"),
 ("AI法人サイト", "ai-corp-site/", "STAGE UP・その他", "要確認", "低",
  "index.html ベースの静的な法人サイト（詳細未確認）。", "正体と現状を要確認。"),
 ("fg-dream（Cloudflare）", "fg-dream/", "STAGE UP・その他", "要確認", "低",
  "Cloudflare Workers/Pages プロジェクト（wrangler.toml・cron-worker等）。", "正体と現状を要確認。"),
 ("fgdream-renewal", "fgdream-renewal/", "STAGE UP・その他", "要確認", "低",
  "fg-dream のリニューアル版と思われるLP（index.html）。", "正体と現状を要確認。"),
 ("MORIKA AI会社スターターキット／構築代行", "morika/", "AIツール", "公開中（販売中）", "中",
  "『1人の事業を15人のAI社員で回す仕組み』を売る事業。①スターターキット(全33ファイル・15職種の役割定義＋権限5段階＋記録の型。Obsidianで開くとダッシュボード表示)をBOOTHで3,980円販売(公開URL=https://ai-kit2026.booth.pm/items/8644188)。②同じ仕組みの構築代行(30万円〜)。景表法に触れる誇大表現は使わずランサーズ等へ販路拡大の方針。市場調査メモも同フォルダ(morika/research)。", "サムネのPNG書き出しと、公開中のBOOTH/note本文を最新(AI社員15人・全33ファイル・Obsidian対応)へ差し替え。ココナラ/ランサーズ出品。構築代行の実績づくり。"),

 # 🔬 検証・実験
 ("AI金融取引 検証土台", "trading-system/", "検証", "検証中", "中",
  "暗号資産のバックテスト/リスク管理土台。Claude×Codex分担、実発注は意図的に未実装。", "バックテスト整備。実発注は当面入れない。"),
 ("Steam向けゲーム", "steam-game/", "検証", "開発中", "低",
  "Steam配布を目指す生き残りバトル(Vampire Survivors風)。HTML5+Canvasで制作しアプリ化予定。", "ゲームループの完成度。"),
 ("silhouette-cad", "silhouette-cad/", "検証", "要確認", "低",
  "Silhouette CAD（切削/カット系CADツール・詳細未確認）。", "正体と現状を要確認。"),
]

# 小規模/アセット/未分類（ノートは作らず索引だけに載せる）
MINOR = [
 ("gacha-code", "ガチャ開発用のAI会社Vault(company-vault)。15職種のAI社員＋権限5段階＋記録の型＋Obsidianダッシュボードを実適用したガチャ開発の頭脳。"),
 ("gacha-system-plan", "ガチャ開発の計画・起動指示文（ドキュメント）"),
 ("cocohoreone", "Kicksluck関連の公開前チェック（要確認）"),
 ("kawanone", "水シミュレーション/CG系（要確認）"),
 ("oikaze-style-demo", "追い風スタイルのLPデモ（index.html）"),
 ("reseller-radar-lp", "reseller-radar のLP（index.html）"),
 ("tagiron-memo", "タギロン系のメモ/ツール（要確認）"),
 ("treria", "詳細未確認"),
 ("chrome-toolbar-extension", "Chromeツールバー拡張（要確認）"),
 ("automation", "insightsレポート/サムネ等の自動化置き場（要確認）"),
 ("blog-images", "ブログ用画像アセット"),
 ("_proposals", "STAGE UP 企業別提案LP（auth保護）"),
 ("_sheets", "STAGE UP 営業スプレッドシート同期データ"),
 ("api", "STAGE UP ルートのサーバーレス関数（auth.js等）"),
 ("scripts", "営業リスト生成・LPビルド・GAS同期スクリプト群"),
 ("data", "アフィリLP生成元データ(*.json)"),
]

CATEGORY_ORDER = [
 ("💰 本業・収益直結", "本業"),
 ("🃏 トレカ・EC・せどり", "トレカ・EC"),
 ("🎬 動画自動化", "動画"),
 ("🤖 AIツール・アプリ・SNS", "AIツール"),
 ("🏢 STAGE UP・その他サイト・業務", "STAGE UP・その他"),
 ("🔬 検証・実験", "検証"),
]

STATUS_EMOJI = {"運用中":"🟢","施策中":"🟢","開発中":"🟡","計画中":"🔵","検証中":"🔵","保留":"🟠","要確認":"⚪️","環境":"⚙️","停止":"🚨"}
PRIORITY_EMOJI = {"最高":"🔥","高":"⭐️","中":"・","低":""}

def w(path, text):
    full = os.path.join(VAULT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(text)

def note_filename(title):
    return title.replace("/", "／") + ".md"

# ---- プロジェクトノート ----
for title, folder, cat, status, prio, summary, nexta in PROJECTS:
    cat_moc = next(m for m,c in CATEGORY_ORDER if c==cat)
    tags = f"[project, {cat}]"
    body = f"""---
title: {title}
category: {cat}
status: {status}
priority: {prio}
path: {folder}
tags: {tags}
updated: {TODAY}
---

# {title}

> [!info] ステータス {STATUS_EMOJI.get(status,'')} **{status}** ／ 優先度 {PRIORITY_EMOJI.get(prio,'')} {prio} ／ 分類 [[{cat_moc}]]

## 概要
{summary}

## 場所
`{folder}`

## 次のアクション
- [ ] {nexta}

## メモ・ログ
- {TODAY} Vaultに登録。

## 関連
- 分類MOC: [[{cat_moc}]]
- [[🏠 ホーム]] / [[🗺️ 全プロジェクト索引]]
"""
    # 手動で詳細を書き込んだノート（frontmatter に manual: true）は上書きしない
    note_path = os.path.join(VAULT, "プロジェクト", note_filename(title))
    if os.path.exists(note_path):
        with open(note_path, encoding="utf-8") as _f:
            if "manual: true" in _f.read():
                continue
    w(f"プロジェクト/{note_filename(title)}", body)

# ---- カテゴリMOC ----
for moc_title, cat in CATEGORY_ORDER:
    rows = ["| 状 | プロジェクト | 優先 | 次のアクション |","|:--:|---|:--:|---|"]
    for title, folder, c, status, prio, summary, nexta in PROJECTS:
        if c!=cat: continue
        rows.append(f"| {STATUS_EMOJI.get(status,'')} | [[{title}]] | {prio} | {nexta} |")
    body = f"""---
title: {moc_title}
tags: [MOC]
updated: {TODAY}
---

# {moc_title}

このカテゴリのプロジェクト一覧。状=🟢運用/🟡開発/🔵計画/🟠保留/⚪️要確認。

{chr(10).join(rows)}

---
[[🏠 ホーム]] / [[🗺️ 全プロジェクト索引]]
"""
    w(f"MOC/{note_filename(moc_title)}", body)

# ---- ホーム ----
counts = {}
for _,_,c,status,_,_,_ in PROJECTS:
    counts[status] = counts.get(status,0)+1
moc_links = "\n".join(f"- [[{m}]]（{sum(1 for p in PROJECTS if p[2]==c)}件）" for m,c in CATEGORY_ORDER)
# 優先タスク（優先度=最高/高 の次アクション）
prio_rows = ["| 優先 | プロジェクト | 次のアクション |","|:--:|---|---|"]
for title, folder, c, status, prio, summary, nexta in PROJECTS:
    if prio in ("最高","高"):
        prio_rows.append(f"| {PRIORITY_EMOJI.get(prio,'')}{prio} | [[{title}]] | {nexta} |")
home = f"""---
title: 🏠 ホーム
tags: [home]
updated: {TODAY}
---

# 🏠 事業コマンドセンター

STAGE UP 個人事業ワークスペースの司令塔。各トップレベルフォルダ＝独立プロジェクト。
返信・報告はすべて日本語・非技術者向け・結果だけ、が全体ルール。

## 🎯 ゴール
月収100万円達成（3〜6ヶ月想定）。本業＝通信アフィリ。→ [[📊 収益ダッシュボード]]

## 🗂 カテゴリ（Map of Content）
{moc_links}

全体を一覧で見る → [[🗺️ 全プロジェクト索引]]

## 🔥 いま優先で進めること（優先度 高以上）
{chr(10).join(prio_rows)}

## 📊 ステータス集計
{" / ".join(f"{STATUS_EMOJI.get(k,'')}{k} {v}" for k,v in sorted(counts.items(), key=lambda x:-x[1]))}
（プロジェクトノート {len(PROJECTS)}件 ＋ 小規模/資産 {len(MINOR)}件）

## 🗓 今日
- [[日次/{TODAY}]]

---
> グラフビュー（左メニューの輪っかアイコン）を開くと、全プロジェクトの繋がりが俯瞰できます。
"""
w("🏠 ホーム.md", home)

# ---- 収益ダッシュボード ----
rev = f"""---
title: 📊 収益ダッシュボード
tags: [dashboard, 収益]
updated: {TODAY}
---

# 📊 収益ダッシュボード

## ゴール
- **月収100万円**（想定期間 3〜6ヶ月）。本業＝[[通信アフィリLP運用（本業）]]。

## 収益ドライバー（本命）
| 事業 | 役割 | 状態 |
|---|---|:--:|
| [[通信アフィリLP運用（本業）]] | 収益の柱 | 🟢 |
| [[通信まるごと診断アプリ]] | リード獲得 | 🟢 |
| [[レビューブログ（月10万PV目標）]] | 集客(SEO) | 🟠 |
| [[YouTube Shorts自動化（通信流入）]] | 集客(動画) | 🟢 |
| [[ごろごろガチャ（オリパEC）]] | EC売上 | 🟢 |

## 今月の数字（手入力で更新）
| 指標 | 値 | メモ |
|---|--:|---|
| アフィリ確定報酬 |  |  |
| 診断アプリ 遷移率 |  |  |
| Shorts 流入数 |  |  |
| ガチャEC 売上 |  |  |

> 数字は実データで確認してから記入する（推測で書かない）。
"""
w("📊 収益ダッシュボード.md", rev)

# ---- 全プロジェクト索引 ----
idx = ["---","title: 🗺️ 全プロジェクト索引","tags: [index]","updated: "+TODAY,"---","","# 🗺️ 全プロジェクト索引","","全トップレベルフォルダの一覧（このワークスペースは各フォルダ＝独立プロジェクト）。",""]
idx.append("## プロジェクト")
idx.append("| 状 | プロジェクト | パス | 分類 | 優先 |")
idx.append("|:--:|---|---|---|:--:|")
for title, folder, cat, status, prio, summary, nexta in sorted(PROJECTS, key=lambda p:(p[2],p[4])):
    idx.append(f"| {STATUS_EMOJI.get(status,'')} | [[{title}]] | `{folder}` | {cat} | {prio} |")
idx.append("")
idx.append("## 小規模・ドキュメント・共通資産")
idx.append("| フォルダ | 内容 |")
idx.append("|---|---|")
for folder, desc in MINOR:
    idx.append(f"| `{folder}/` | {desc} |")
idx.append("")
idx.append("---\n[[🏠 ホーム]]")
w("🗺️ 全プロジェクト索引.md", "\n".join(idx))

# ---- 日次ノート ----
daily = f"""---
title: {TODAY}
tags: [daily]
---

# {TODAY}（日次）

## 今日やること
- [ ]

## 進捗・気づき
-

## 明日へ
-

---
[[🏠 ホーム]]
"""
w(f"日次/{TODAY}.md", daily)

# ---- テンプレート ----
w("テンプレート/プロジェクトテンプレート.md", """---
title:
category:
status: 計画中
priority: 中
path:
tags: [project]
updated:
---

#

> [!info] ステータス ⚪️ 計画中 ／ 優先度 中

## 概要

## 場所
``

## 次のアクション
- [ ]

## メモ・ログ

## 関連
- [[🏠 ホーム]]
""")
w("テンプレート/日次テンプレート.md", """---
tags: [daily]
---

# （日次）

## 今日やること
- [ ]

## 進捗・気づき
-

## 明日へ
-

---
[[🏠 ホーム]]
""")

print(f"生成完了: プロジェクト {len(PROJECTS)}件 / MOC {len(CATEGORY_ORDER)}件 / 索引・ホーム・収益・日次・テンプレ")
