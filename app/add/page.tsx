"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { ADMIN_EMAIL, isAdminEmail } from "@/lib/admin";

// 手動新增遊戲。封面用手把圖示佔位 /covers/placeholder.svg，
// 目前填的價格就是歷史低價（historical_low_twd = 價格，價格列 is_historical_low = true）。
// 寫入目前直接走 Supabase client（需登入；RLS 政策由資料組 / 登入組設定，
// 若登入組之後改走 POST /api/games，改 submitGame() 即可）。
function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || `manual-${Date.now()}`;
}

export default function AddGamePage() {
  const router = useRouter();
  const [titleZh, setTitleZh] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [genre, setGenre] = useState("");
  const [publisher, setPublisher] = useState("");
  const [platform, setPlatform] = useState("Switch");
  const [productType, setProductType] = useState("game");
  const [hasDemo, setHasDemo] = useState("0");
  const [price, setPrice] = useState("");
  const [country, setCountry] = useState("TW");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doneSlug, setDoneSlug] = useState("");
  // null = 還在確認權限；只有管理員帳號能看到表單。
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    db.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push("/login?next=/add");
        return;
      }
      setIsAdmin(isAdminEmail(user.email));
    });
  }, [router]);

  async function submitGame(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDoneSlug("");
    const priceNum = Number(price);
    if (!titleZh.trim()) {
      setError("請填中文遊戲名。");
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError("請填有效的目前價格（台幣，整數）。");
      return;
    }
    setBusy(true);
    try {
      const db = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user) {
        router.push("/login?next=/add");
        return;
      }
      if (!isAdminEmail(user.email)) {
        setError("只有網站管理員可以新增遊戲。");
        return;
      }
      let slug = slugify(titleEn.trim() || titleZh.trim());
      const { data: existing } = await db
        .from("games")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (existing) slug = `${slug}-${Date.now().toString().slice(-6)}`;

      const { data: game, error: gErr } = await db
        .from("games")
        .insert({
          cover_url: "/covers/placeholder.svg",
          created_by: user.id,
          genre: genre.trim() || null,
          has_demo: Number(hasDemo),
          historical_low_twd: Math.round(priceNum),
          is_manual: true,
          platform,
          product_type: productType,
          publisher: publisher.trim() || null,
          slug,
          title_en: titleEn.trim() || null,
          title_zh: titleZh.trim(),
        })
        .select("id, slug")
        .single();
      if (gErr || !game) throw new Error(gErr?.message ?? "新增遊戲失敗");

      const { error: pErr } = await db.from("prices").insert({
        country,
        country_name: country === "TW" ? "台灣" : country,
        currency: country === "TW" ? "TWD" : "TWD",
        discount_pct: null,
        effective_raw: Math.round(priceNum),
        game_id: (game as { id: string }).id,
        is_historical_low: true,
        price_twd: Math.round(priceNum),
        regular_raw: Math.round(priceNum),
        sale_end: null,
      });
      if (pErr) throw new Error(`遊戲已建立，但價格寫入失敗：${pErr.message}`);
      setDoneSlug((game as { slug: string }).slug);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "新增失敗，請稍後再試。"
      );
    } finally {
      setBusy(false);
    }
  }

  if (isAdmin === null) {
    return (
      <div className="narrow">
        <h1>➕ 新增遊戲</h1>
        <p className="muted">確認權限中…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="narrow">
        <h1>➕ 新增遊戲</h1>
        <div className="form-error">
          只有網站管理員（{ADMIN_EMAIL}）可以新增遊戲。
        </div>
        <p>
          <Link href="/">回首頁 →</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="narrow">
      <h1>➕ 新增遊戲</h1>
      <p className="muted">
        手動加入資料庫還沒有的遊戲。封面先用手把圖示佔位，之後可由資料組補上真實封面。
        你填的目前價格會直接被記錄為歷史低價。
      </p>
      <form onSubmit={submitGame}>
        <label className="field-label" htmlFor="title-zh">
          中文遊戲名 *
        </label>
        <input
          id="title-zh"
          className="input"
          value={titleZh}
          onChange={(e) => setTitleZh(e.target.value)}
          placeholder="例如：薩爾達傳說 曠野之息"
          required
        />
        <label className="field-label" htmlFor="title-en">
          英文遊戲名（用來產生網址 slug）
        </label>
        <input
          id="title-en"
          className="input"
          value={titleEn}
          onChange={(e) => setTitleEn(e.target.value)}
          placeholder="例如：Breath of the Wild"
        />
        <label className="field-label" htmlFor="genre">
          類型
        </label>
        <input
          id="genre"
          className="input"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          placeholder="例如：動作冒險"
        />
        <label className="field-label" htmlFor="publisher">
          發行商
        </label>
        <input
          id="publisher"
          className="input"
          value={publisher}
          onChange={(e) => setPublisher(e.target.value)}
          placeholder="例如：任天堂"
        />
        <label className="field-label" htmlFor="platform">
          主機
        </label>
        <select
          id="platform"
          className="input"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          <option value="Switch">Switch</option>
          <option value="Switch 2">Switch 2</option>
        </select>
        <label className="field-label" htmlFor="product-type">
          商品類型
        </label>
        <select
          id="product-type"
          className="input"
          value={productType}
          onChange={(e) => setProductType(e.target.value)}
        >
          <option value="game">遊戲本體</option>
          <option value="dlc">追加內容</option>
          <option value="bundle">組合包</option>
        </select>
        <label className="field-label" htmlFor="has-demo">
          試玩類型
        </label>
        <select
          id="has-demo"
          className="input"
          value={hasDemo}
          onChange={(e) => setHasDemo(e.target.value)}
        >
          <option value="0">無試玩</option>
          <option value="1">免費 Demo</option>
          <option value="2">免費試玩</option>
          <option value="3">NSO 限時試玩</option>
        </select>
        <label className="field-label" htmlFor="price">
          目前價格（台幣 NT$）* — 將同時記為歷史低價
        </label>
        <input
          id="price"
          className="input"
          type="number"
          min={1}
          step={1}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="例如：1790"
          required
        />
        <label className="field-label" htmlFor="country">
          這個價格是哪一國
        </label>
        <select
          id="country"
          className="input"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          <option value="TW">台灣（TWD）</option>
          <option value="JP">日本（JPY，以台幣金額計）</option>
          <option value="US">美國（USD，以台幣金額計）</option>
        </select>
        <p className="muted">
          目前只支援先記一國價格；其他國家價格由每日自動更新補上。
        </p>
        <p>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "新增中…" : "新增遊戲"}
          </button>
        </p>
        {error && <div className="form-error">⚠️ {error}</div>}
        {doneSlug && (
          <div className="form-ok">
            ✅ 已新增！<Link href={`/games/${doneSlug}`}>去看這款遊戲 →</Link>
          </div>
        )}
      </form>
    </div>
  );
}
