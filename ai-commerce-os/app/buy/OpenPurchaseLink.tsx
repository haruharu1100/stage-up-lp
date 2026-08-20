'use client';

import { useState, useTransition } from 'react';
import { openPurchasePageAction } from '../actions';

/**
 * 「購入ページを開く」（ユーザー指示2 4 14 15）。
 *
 * 【AIはこのURLに触らない】
 * ページを開くのは、人が押した普通のリンクである。
 * このシステムがやるのは「押された」という記録だけ。
 * 注文も決済もログインもしない。買うかどうかは、開いた先で人が決める。
 *
 * 【リンクを組み立てない】
 * `href` は取得元データに実際に入っていたURLをそのまま渡す。
 * ここで文字列をつなげてURLを作ることは絶対にしない（作れば存在しないページへ人を送る）。
 */
export default function OpenPurchaseLink({
  listingKey, url, canOpen, blockedReason,
}: {
  listingKey: string;
  url: string;
  canOpen: boolean;
  blockedReason: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const [ng, setNg] = useState(false);

  if (!canOpen) {
    return <span className="badge skip" title={blockedReason}>開けません</span>;
  }

  return (
    <>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          // 記録は裏で走らせる。リンクの遷移そのものは止めない
          //（止めるとブラウザに新しいタブを塞がれる）。
          const fd = new FormData();
          fd.set('listing_key', listingKey);
          start(async () => {
            const r = await openPurchasePageAction(null, fd);
            setNg(!r.ok);
            setMsg(r.message);
          });
        }}
      >
        購入ページを開く
      </a>
      {pending && <span className="small muted"> 記録中…</span>}
      {msg && <div className={`small ${ng ? 'neg' : 'muted'}`}>{msg}</div>}
    </>
  );
}
