"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

export default function SiteHeader() {
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    db.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    const db = createSupabaseBrowserClient();
    await db.auth.signOut();
    setEmail(null);
    router.refresh();
  }

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="logo">
          <b>Switch</b> 遊戲<span>比價</span>
        </Link>
        <nav className="nav">
          <Link href="/">首頁</Link>
          <Link href="/ranking">收藏排行</Link>
          <Link href="/add">新增遊戲</Link>
          {email ? (
            <>
              <span className="user-chip">{email}</span>
              <button type="button" className="btn" onClick={signOut}>
                登出
              </button>
            </>
          ) : (
            <Link href="/login">登入</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
