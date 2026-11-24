"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { safeNext } from "@/lib/safe-next";

// 登入頁本體：Google / Discord 按鈕走 Supabase Auth OAuth。
// 實際登入流程（callback、session refresh）由登入組接：
// 按鈕回跳到 /auth/callback（登入組實作），這裡只負責發起 OAuth。
export default function LoginClient() {
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/home";

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    db.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function signIn(provider: "google" | "discord") {
    setBusy(provider);
    setError("");
    try {
      const db = createSupabaseBrowserClient();
      // 登入後返回頁寫進 cookie（spc-next），不再放 redirectTo 的 ?next=：
      // 實測 ?next= 會在 Supabase／Google 來回中被弄丟（/switch-price 登入
      // 後仍跳回 /home），cookie 不走 OAuth 參數，callback 改從 cookie 讀。
      document.cookie = `spc-next=${encodeURIComponent(safeNext(next))}; path=/; max-age=600; SameSite=Lax`;
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await db.auth.signInWithOAuth({
        options: { redirectTo },
        provider,
      });
      if (error) throw error;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "登入失敗，請稍後再試。"
      );
      setBusy(null);
    }
  }

  async function signOut() {
    const db = createSupabaseBrowserClient();
    await db.auth.signOut();
    setEmail(null);
  }

  return (
    <div className="narrow">
      <h1>🔐 登入</h1>

      <div className="notice-box">
        <h3>🔒 關於你的資料 — 請先看這段</h3>
        <p>
          登入<strong>只用來做收藏</strong>（收藏遊戲、按讚、留言）。
        </p>
        <p>
          本站<strong>不收集任何 Gmail 或 Discord 資料</strong>，也不會存取你的信箱、好友名單或伺服器內容；登入只向
          Google / Discord 確認「你是誰」，除此之外<strong>不存其他資料</strong>。
        </p>
        <p>
          我們只會記錄：你的帳號識別碼（用來對應收藏）、你收藏了哪些遊戲、你按了哪些讚、你寫了哪些留言。
        </p>
      </div>

      {email ? (
        <>
          <p>
            你目前已登入：<b>{email}</b>
          </p>
          <p>
            <button type="button" className="btn" onClick={signOut}>
              登出
            </button>
          </p>
        </>
      ) : (
        <div className="login-btns">
          <div className="login-alert" role="alert">
            ⚠️ 目前僅支援 Switch 比價
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => signIn("google")}
            disabled={busy !== null}
          >
            {busy === "google" ? "跳轉中…" : "使用 Google 登入"}
          </button>
          <button
            type="button"
            className="btn btn-pink"
            onClick={() => signIn("discord")}
            disabled={busy !== null}
          >
            {busy === "discord" ? "跳轉中…" : "使用 Discord 登入"}
          </button>
          <p className="muted">
            登入後即可收藏遊戲、按讚、留言，並在首頁看到「你收藏的遊戲正在特價」的提醒。
          </p>
        </div>
      )}
      {error && <div className="form-error">⚠️ {error}</div>}
    </div>
  );
}
