"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { isAdminEmail } from "@/lib/admin";

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
        <Link href="/" className="logo" aria-label="SHAWN GAME STUDIO 首頁">
          <Image
            src="/sgs-logo.png"
            alt="SHAWN GAME STUDIO"
            width={2172}
            height={724}
            priority
          />
        </Link>
        <nav className="nav">
          <Link href="/">首頁</Link>
          <Link href="/deals">PC遊戲特價</Link>
          <Link href="/console">家機特價</Link>
          <Link href="/membership">會員方案</Link>
          <Link href="/taiwan">台灣完整目錄</Link>
          <Link href="/ranking">收藏排行</Link>
          {email && isAdminEmail(email) && <Link href="/add">新增遊戲</Link>}
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
