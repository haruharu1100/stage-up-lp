import { notFound } from 'next/navigation';
import { parseJson } from '@/lib/db/client';
import { getProductDetail } from '@/lib/db/queries';
import { SCORE_LABEL, SCORE_MAX, SOURCE_TYPE_LABEL, type ScoreBreakdown, type SourceType } from '@/lib/types';
import { jstDateTime, pct, yen } from '@/lib/format';
import MasterImageForm from '@/components/MasterImageForm';
import SalesResultForm from '@/components/SalesResultForm';

export const dynamic = 'force-dynamic';

export default async function ProductPage({ params }: { params: { id: string } }) {
  const d = await getProductDetail(params.id);
  if (!d) notFound();

  const p = d.product;
  const breakdown = parseJson<ScoreBreakdown | null>(d.candidate?.score_breakdown, null);
  const assumptions = parseJson<string[]>(d.profit?.assumptions, []);
  const bullets = parseJson<string[]>(d.listing?.bullet_points, []);
  const searchTerms = parseJson<string[]>(d.listing?.search_terms, []);
  const differentiation = parseJson<string[]>(d.listing?.differentiation, []);
  const adAngles = parseJson<string[]>(d.listing?.ad_angles, []);
  const validation = parseJson<{ ok?: boolean; issues?: { severity: string; message: string }[] }>(
    d.listing?.validation,
    {},
  );
  const video = d.video;
  const storyboard = parseJson<{ cut: number; visual: string; camera: string; onScreenText: string }[]>(
    video?.storyboard,
    [],
  );
  const narration = parseJson<string[]>(video?.narration, []);
  const telop = parseJson<string[]>(video?.telop, []);

  const ra = d.reviewAnalysis;

  return (
    <main className="wrap">
      <p className="small">
        <a href="/">← 候補一覧へ戻る</a>
      </p>

      <div className="card">
        <h2 style={{ fontSize: 20 }}>{String(p.title)}</h2>
        <p className="desc">
          {p.brand ? `${p.brand} ／ ` : ''}
          {p.category || 'カテゴリ不明'}
          {p.asin ? ` ／ ASIN ${p.asin}` : ''}
        </p>
        {d.candidate && (
          <div style={{ fontSize: 28, fontWeight: 800 }}>
            {Math.round(Number(d.candidate.score_total))}
            <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> / 100点</span>
          </div>
        )}
        {d.candidate?.reason && <p className="small" style={{ marginTop: 6 }}>{String(d.candidate.reason)}</p>}
      </div>

      <div className="grid2">
        <div className="card">
          <h2>採点の内訳</h2>
          <p className="desc">どこで点を取ったかです。</p>
          {breakdown ? (
            <div>
              {(Object.keys(SCORE_MAX) as (keyof ScoreBreakdown)[]).map((k) => {
                const got = Number(breakdown[k] ?? 0);
                const max = SCORE_MAX[k];
                return (
                  <div key={k} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>{SCORE_LABEL[k]}</span>
                      <span className="muted">
                        {got.toFixed(1)} / {max}
                      </span>
                    </div>
                    <div className="bar">
                      <span style={{ width: `${Math.max(0, Math.min(100, (got / max) * 100))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="muted">まだ採点されていません。</div>
          )}
        </div>

        <div className="card">
          <h2>お金の計算</h2>
          <p className="desc">日本のAmazon手数料をもとにした想定です。実際の仕入価格で変わります。</p>
          {d.profit ? (
            <>
              <dl className="kv">
                <dt>販売価格</dt>
                <dd>{yen(d.profit.sell_price_jpy)}</dd>
                <dt>仕入価格</dt>
                <dd>{yen(d.profit.supplier_price_jpy)}</dd>
                <dt>納品送料</dt>
                <dd>{yen(d.profit.inbound_shipping_jpy)}</dd>
                <dt>販売手数料</dt>
                <dd>
                  {yen(d.profit.referral_fee_jpy)}（{pct(d.profit.referral_fee_rate, 0)}）
                </dd>
                <dt>FBA配送料</dt>
                <dd>
                  {yen(d.profit.fba_fee_jpy)}（{String(d.profit.fba_size_tier || '')}）
                </dd>
                <dt>在庫保管料</dt>
                <dd>{yen(d.profit.storage_fee_jpy)}</dd>
                <dt>想定広告費</dt>
                <dd>{yen(d.profit.ad_cost_jpy)}</dd>
                <dt>返品ロス</dt>
                <dd>{yen(d.profit.return_loss_jpy)}</dd>
                <dt>想定利益</dt>
                <dd className={Number(d.profit.profit_jpy) >= 0 ? 'pos' : 'neg'}>
                  <strong>{yen(d.profit.profit_jpy)}（{pct(d.profit.profit_rate)}）</strong>
                </dd>
                <dt>損益分岐価格</dt>
                <dd>{yen(d.profit.breakeven_price_jpy)}</dd>
              </dl>
              {assumptions.length > 0 && (
                <>
                  <p className="small muted" style={{ marginTop: 12, marginBottom: 4 }}>前提としたこと</p>
                  <ul className="plain small muted">
                    {assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <div className="muted">まだ計算されていません。</div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>市場のようす</h2>
        {d.market ? (
          <dl className="kv">
            <dt>取得元</dt>
            <dd>
              {String(d.market.source)}（{jstDateTime(d.market.fetched_at as string)}）
            </dd>
            <dt>価格</dt>
            <dd>{yen(d.market.price_jpy)}</dd>
            <dt>ランキング</dt>
            <dd>
              {d.market.bsr ? `${Number(d.market.bsr).toLocaleString()}位` : '—'} {d.market.bsr_category || ''}
            </dd>
            <dt>評価 / レビュー</dt>
            <dd>
              {d.market.rating ?? '—'} ／ {d.market.review_count?.toLocaleString?.() ?? '—'}件
            </dd>
            <dt>販売者数</dt>
            <dd>
              {d.market.seller_count ?? '—'}（うちFBA {d.market.fba_seller_count ?? '—'}）
              {Number(d.market.is_amazon_selling) === 1 ? ' ／ Amazon本体あり' : ''}
            </dd>
            <dt>月間販売見込</dt>
            <dd>{d.market.monthly_sales_est ? `${Number(d.market.monthly_sales_est).toLocaleString()}個` : '—'}</dd>
          </dl>
        ) : (
          <div className="muted">市場データがありません。</div>
        )}
        {d.competitors.length > 0 && (
          <div className="scroll" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th className="l">競合</th>
                  <th>価格</th>
                  <th>評価</th>
                  <th>レビュー</th>
                  <th>画像</th>
                  <th>動画</th>
                  <th className="l">弱点</th>
                </tr>
              </thead>
              <tbody>
                {d.competitors.map((c) => (
                  <tr key={String(c.id)}>
                    <td className="l title">{String(c.competitor_title || c.competitor_asin || '—')}</td>
                    <td>{yen(c.price_jpy)}</td>
                    <td>{c.rating ?? '—'}</td>
                    <td>{c.review_count ?? '—'}</td>
                    <td>{c.image_count ?? '—'}</td>
                    <td>{Number(c.has_video) === 1 ? 'あり' : 'なし'}</td>
                    <td className="l title">{parseJson<string[]>(c.listing_weakness, []).join('、') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>レビュー分析</h2>
        <p className="desc">
          買う理由・不満・改善余地です。
          {ra && (
            <>
              {' '}
              元にしたレビュー{Number(ra.review_sample_size ?? 0)}件（{String(ra.source || '')}）／ 確からしさ：
              <span className={`badge ${ra.confidence === 'low' ? 'warn' : 'done'}`}>
                {ra.confidence === 'high' ? '高い' : ra.confidence === 'medium' ? 'ふつう' : '低い'}
              </span>
            </>
          )}
        </p>
        {ra ? (
          <>
            {ra.confidence === 'low' && (
              <div className="notice warn">
                レビューの数が少ないか、動作確認用のサンプルです。この分析は参考程度にしてください。
              </div>
            )}
            <p>{String(ra.summary || '')}</p>
            <div className="grid2" style={{ marginTop: 12 }}>
              <ListBlock title="買う理由" items={parseJson<string[]>(ra.purchase_reasons, [])} />
              <ListBlock title="ほめられている点" items={parseJson<string[]>(ra.praise_points, [])} />
              <ListBlock title="不満" items={parseJson<string[]>(ra.complaints, [])} />
              <ListBlock title="改善してほしいこと" items={parseJson<string[]>(ra.improvement_requests, [])} />
              <ListBlock title="使われ方" items={parseJson<string[]>(ra.use_cases, [])} />
              <ListBlock title="競合との差" items={parseJson<string[]>(ra.competitor_gap, [])} />
            </div>
          </>
        ) : (
          <div className="muted">まだ分析されていません。</div>
        )}
      </div>

      <div className="card">
        <h2>商品ページ案</h2>
        <p className="desc">そのままAmazonの出品データになる文章です。</p>
        {d.listing ? (
          <>
            <dl className="kv">
              <dt>出品のしかた</dt>
              <dd>
                {String(d.listing.strategy) === 'existing_asin'
                  ? `既存の商品ページに出す（相乗り／${d.listing.existing_asin || ''}）`
                  : '新規に商品ページを作る'}
              </dd>
              <dt>状態</dt>
              <dd>{String(d.listing.status) === 'ready' ? '出品準備OK' : '下書き'}</dd>
            </dl>
            <p className="small muted" style={{ marginTop: 14, marginBottom: 4 }}>タイトル</p>
            <p>{String(d.listing.title || '')}</p>
            <p className="small muted" style={{ marginTop: 14, marginBottom: 4 }}>箇条書き</p>
            <ul className="plain">
              {bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            <p className="small muted" style={{ marginTop: 14, marginBottom: 4 }}>商品説明</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{String(d.listing.description || '')}</p>
            <div className="grid2" style={{ marginTop: 14 }}>
              <ListBlock title="検索キーワード" items={searchTerms} />
              <ListBlock title="他社との違い" items={differentiation} />
              <ListBlock title="広告の切り口" items={adAngles} />
            </div>
            {validation.issues && validation.issues.length > 0 && (
              <div className="notice warn" style={{ marginTop: 16 }}>
                <strong>出品データの確認結果</strong>
                <ul className="plain">
                  {validation.issues.map((i, idx) => (
                    <li key={idx}>
                      [{i.severity === 'ERROR' ? '要修正' : '注意'}] {i.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="muted">まだ作られていません。</div>
        )}
      </div>

      <div className="card">
        <h2>元画像（MASTER PRODUCT IMAGE）</h2>
        <p className="desc">
          商品ページ画像は<strong>必ずこの元画像をもとに</strong>作ります。元画像が無いとAIは画像を1枚も作りません。
        </p>
        {d.masterImages.length > 0 ? (
          <div className="imgs" style={{ marginBottom: 18 }}>
            {d.masterImages.map((m) => (
              <figure key={String(m.id)}>
                <img src={`/api/files/${m.file_path}`} alt="元画像" />
                <figcaption>
                  {SOURCE_TYPE_LABEL[String(m.rights_source) as SourceType] || String(m.rights_source)}
                  <br />
                  権利者：{String(m.rights_holder || '—')}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="notice warn">
            元画像がまだ登録されていません。自社撮影・メーカー提供などの画像を1枚登録してください。
          </div>
        )}
        <MasterImageForm productId={params.id} />
      </div>

      <div className="card">
        <h2>商品ページ画像</h2>
        {d.images.length === 0 ? (
          <div className="muted">まだありません。</div>
        ) : (
          <div className="imgs">
            {d.images.map((img) => (
              <figure key={String(img.id)}>
                {img.file_path ? (
                  <img src={`/api/files/${img.file_path}`} alt={String(img.purpose || '')} />
                ) : (
                  <div style={{ padding: 20, fontSize: 12 }} className="muted">
                    画像なし（{String(img.blocked_reason || img.status)}）
                  </div>
                )}
                <figcaption>
                  {String(img.slot)}枚目：{String(img.purpose || '')}
                  <br />
                  <span className={`badge ${img.status === 'generated' ? 'done' : 'warn'}`}>
                    {img.status === 'generated' ? '生成済み' : img.status === 'blocked' ? '未生成' : String(img.status)}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>紹介動画の企画</h2>
        {video ? (
          <>
            <p className="desc">
              {Number(video.duration_sec || 0)}秒 ／ 状態：
              {video.status === 'generated' ? '動画まで生成済み' : '構成と絵コンテまで（動画生成は未設定）'}
            </p>
            {video.file_path && (
              <video src={`/api/files/${video.file_path}`} controls style={{ width: '100%', maxWidth: 420, borderRadius: 8 }} />
            )}
            {storyboard.length > 0 && (
              <div className="scroll" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>カット</th>
                      <th className="l">映像</th>
                      <th className="l">カメラ</th>
                      <th className="l">画面の文字</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storyboard.map((s) => (
                      <tr key={s.cut}>
                        <td>{s.cut}</td>
                        <td className="l title">{s.visual}</td>
                        <td className="l title">{s.camera}</td>
                        <td className="l title">{s.onScreenText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid2" style={{ marginTop: 14 }}>
              <ListBlock title="ナレーション" items={narration} />
              <ListBlock title="テロップ" items={telop} />
            </div>
          </>
        ) : (
          <div className="muted">まだありません。</div>
        )}
      </div>

      <div className="card">
        <h2>販売できるかの確認（コンプライアンス）</h2>
        <p className="desc">1つでも「停止」があると、Amazonへの自動出品は止まります。</p>
        {d.complianceItems.length === 0 ? (
          <div className="muted">まだ確認されていません。</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="l">区分</th>
                  <th className="l">確認したこと</th>
                  <th className="l">結果</th>
                  <th className="l">内容</th>
                </tr>
              </thead>
              <tbody>
                {d.complianceItems.map((c, i) => (
                  <tr key={i}>
                    <td className="l">{c.category}</td>
                    <td className="l">{c.check}</td>
                    <td className="l">
                      <span className={`badge ${c.passed ? 'done' : c.severity === 'blocking' ? 'error' : 'warn'}`}>
                        {c.passed ? 'OK' : c.severity === 'blocking' ? '停止' : '注意'}
                      </span>
                    </td>
                    <td className="l title">
                      {c.detail}
                      {c.law ? `（${c.law}）` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Amazonへの送信</h2>
        {d.publishJobs.length === 0 ? (
          <div className="muted">まだありません。</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="l">日時</th>
                  <th className="l">モード</th>
                  <th className="l">結果</th>
                  <th className="l">備考</th>
                </tr>
              </thead>
              <tbody>
                {d.publishJobs.map((j) => (
                  <tr key={String(j.id)}>
                    <td className="l">{jstDateTime(j.created_at as string)}</td>
                    <td className="l">{String(j.mode)}</td>
                    <td className="l">
                      <span className={`badge ${j.status === 'success' ? 'done' : j.status === 'error' ? 'error' : 'idle'}`}>
                        {j.status === 'skipped' ? '送信していません' : String(j.status)}
                      </span>
                    </td>
                    <td className="l title">{String(j.error || '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>実際の売上を入れる（AIを賢くする）</h2>
        <p className="desc">
          売れた結果を入れると、AIの予測とのズレを記録します。実績が5件たまると、採点の重みを自動で調整します。
        </p>
        {d.salesResults.length > 0 && (
          <div className="scroll" style={{ marginBottom: 16 }}>
            <table>
              <thead>
                <tr>
                  <th className="l">期間</th>
                  <th>売上</th>
                  <th>個数</th>
                  <th>利益</th>
                  <th>利益率</th>
                  <th>広告費</th>
                </tr>
              </thead>
              <tbody>
                {d.salesResults.map((s) => (
                  <tr key={String(s.id)}>
                    <td className="l">
                      {String(s.period_start || '—')} 〜 {String(s.period_end || '—')}
                    </td>
                    <td>{yen(s.revenue_jpy)}</td>
                    <td>{s.units_sold ?? '—'}</td>
                    <td>{yen(s.profit_jpy)}</td>
                    <td>{pct(s.profit_rate)}</td>
                    <td>{yen(s.ad_spend_jpy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <SalesResultForm productId={params.id} />
      </div>
    </main>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="small muted" style={{ marginBottom: 4 }}>{title}</p>
      <ul className="plain">
        {items.map((v, i) => (
          <li key={i}>{v}</li>
        ))}
      </ul>
    </div>
  );
}
