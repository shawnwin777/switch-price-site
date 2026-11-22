import Link from "next/link";
import { getTwPublicCatalog, getTwPublicPrices } from "@/lib/tw-official-public";
import styles from "./taiwan.module.css";

export const dynamic = "force-dynamic";
type Params = { [key: string]: string | string[] | undefined };
const first = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;
const PAGE_SIZE = 24;
function urlFor(q: string, platform: string, page: number) {
  const s = new URLSearchParams();
  if (q) s.set("q",q);
  if (platform) s.set("platform",platform);
  if (page > 1) s.set("page",String(page));
  return "/taiwan" + (s.size ? "?" + s.toString() : "");
}
function priceLabel(p: Awaited<ReturnType<typeof getTwPublicPrices>>[string] | undefined) {
  if (!p) return "價格暫時無法取得";
  if (p.salesStatus === "preorder") return "預購";
  if (p.salesStatus === "unreleased") return "尚未發售";
  if (p.salesStatus === "sales_termination") return "已停售";
  if (p.salesStatus !== "onsale") return "目前無在售價格";
  if (p.effective === null) return "目前價格未公開";
  if (p.currency && p.currency !== "TWD")
    return p.currency + " " + new Intl.NumberFormat("zh-TW").format(p.effective);
  return new Intl.NumberFormat("zh-TW", {
    style:"currency",currency:"TWD",maximumFractionDigits:0,
  }).format(p.effective);
}

export default async function TaiwanOfficialPage({searchParams}: {searchParams:Params}) {
  const q = (first(searchParams.q) ?? "").trim().slice(0,100);
  const platform = (first(searchParams.platform) ?? "").trim();
  const allowed = ["","Nintendo Switch","Nintendo Switch 2","Nintendo Switch 2 Edition"];
  const currentPlatform = allowed.includes(platform) ? platform : "";
  const requested = Number.parseInt(first(searchParams.page) ?? "1",10);
  let catalog: Awaited<ReturnType<typeof getTwPublicCatalog>>=[];
  let catalogError: string | null = null;
  try { catalog=await getTwPublicCatalog(); }
  catch { catalogError="台灣任天堂官方目錄暫時無法讀取，請稍後再試。既有跨區比價不受影響。"; }
  const keyword=q.normalize("NFKC").toLowerCase();
  const filtered=catalog.filter(x=>
    (!currentPlatform || x.hardwareCategory===currentPlatform) &&
    (!keyword || (x.title+" "+(x.publisher??"")+" "+x.nsuid).normalize("NFKC").toLowerCase().includes(keyword))
  );
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const page=Number.isFinite(requested)?Math.min(Math.max(requested,1),totalPages):1;
  const items=filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  let prices:Awaited<ReturnType<typeof getTwPublicPrices>>={};
  let priceError=false;
  try { prices=await getTwPublicPrices(items.map(x=>x.nsuid)); }
  catch { priceError=true; }
  return <section className={styles.root}>
    <div className={styles.hero}>
      <p className={styles.eyebrow}>台灣官方商品目錄</p>
      <h1>台灣 Nintendo Switch／Switch 2</h1>
      <p>直接比對台灣任天堂官方 NSUID、商品名稱與官方圖片；每個商品可查看最近取得的台灣價格。</p>
      <p className={styles.note}>這是官方軟體目錄，並非完整 DLC／Bundle 清單；目錄筆數也不等於目前在售的獨立遊戲數。價格以 Nintendo eShop 實際結帳為準。</p>
    </div>
    <form method="GET" action="/taiwan" className={styles.filters}>
      <input name="q" type="search" placeholder="搜尋遊戲名稱、發行商或 NSUID" defaultValue={q} maxLength={100} aria-label="搜尋台灣官方商品"/>
      <select name="platform" defaultValue={currentPlatform} aria-label="平台類型">
        <option value="">全部平台</option>
        <option value="Nintendo Switch">Nintendo Switch</option>
        <option value="Nintendo Switch 2">Nintendo Switch 2</option>
        <option value="Nintendo Switch 2 Edition">Switch 2 Edition</option>
      </select>
      <button type="submit">查詢</button>
    </form>
    {catalogError ? <p role="alert" className={styles.warning}>{catalogError}</p> : <>
      <div className={styles.stats}>
        <strong>{filtered.length.toLocaleString("zh-TW")}</strong> 筆符合條件的官方 NSUID
        {priceError ? <span> · 台灣價格服務暫時無法查詢</span> : <span> · 價格每 10 分鐘更新快取</span>}
      </div>
      {items.length ? <div className={styles.grid}>
        {items.map(x=><article className={styles.card} key={x.nsuid}>
          <div className={styles.imageWrap}>
            {x.imageUrl ? <img src={x.imageUrl} alt={x.title} loading="lazy" referrerPolicy="no-referrer"/> :
              <div className={styles.noImage}>暫無官方圖片</div>}
          </div>
          <div className={styles.content}>
            <div className={styles.platform}>{x.hardwareCategory??"Nintendo Switch"}</div>
            <h2 title={x.title}>{x.title}</h2>
            <div className={styles.publisher}>{x.publisher??"發行商未列出"}</div>
            <div className={styles.price}>{priceLabel(prices[x.nsuid])}</div>
            <div className={styles.nsuid}>NSUID：{x.nsuid}</div>
          </div>
        </article>)}
      </div>: <p className={styles.warning}>沒有找到符合條件的商品。</p>}
      <div className={styles.pagination}>
        {page>1?<Link href={urlFor(q,currentPlatform,page-1)}>上一頁</Link>:<span>上一頁</span>}
        <span>第 {page} / {totalPages} 頁</span>
        {page<totalPages?<Link href={urlFor(q,currentPlatform,page+1)}>下一頁</Link>:<span>下一頁</span>}
      </div>
    </>}
    <p className={styles.bottom}>若要查看全球價格、收藏與史低，請前往 <Link href="/">Switch 跨區比價首頁</Link>。台灣 DLC 的獨立商品關聯正在安全驗證中。</p>
  </section>;
}
