'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Vincent, 2026-09-07: "把 SOA 放成一个单独的2级标题,然后把 TAB/TAC/TAO分成
// 3个不同的3级标题,数据分开" — /billing/soa used to be the one combined
// TAB+TAC+TAO view; it's now split into /billing/soa/tab, /tac, /tao (see
// Sidebar.tsx and ./_components.tsx). This bare route stays only so an old
// bookmark/link doesn't 404 — it redirects straight to the TAB book.
export default function SoaRedirectPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/billing/soa/tab'); }, [router]);
  return null;
}
