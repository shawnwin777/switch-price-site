import Link from "next/link";
import snapshot from "../../../public/data/tw-addons.json";
import styles from "../taiwan.module.css";

type Addon={
  nsuid:string;title:string|null;imageUrl:string|null;
  addonType:"dlc_candidate"|"bundle_candidate";salesStatus:string;
  effective:number|null;regular:number|null;currency:string|null;
  saleEnd:string|null;parentVerified:boolean;
};
type Catalog={complete:boolean;generatedAt:string|null;twPriceCheckedAt:string|null;
  counts:{total:number;named:number;withImage:number;dlcCandidates:number;bundleCandidates:number};
  items:Addon[]};
type Params={[key:string]:string|string[]|undefined};
const val=(x:string|string[]|undefined)=>Array.isArray(x)?x[0]??"":x??"";
const PAGE_SIZE=30;
function link(q:string,type:string,page:number){
  const p=new URLSearchParams();
  if(q)p.set("q",q);if(type)p.set("type",type);if(page>1)p.set("page",String(page));
  return "/taiwan/addons"+(p.size?"?"+p.toString():"");
}
function money(v:number|null,currency:string|null){
  if(v==null)return "台灣價格未公開";
  if(currency==="TWD")return "NT$"+new Intl.NumberFormat("zh-TW").format(v);
  return (currency??"") + " " + new Intl.NumberFormat("zh-TW").format(v);
}
export const metadata={title:"台灣 DLC、組合包資料｜Shawn Game Studio"};
export default function TaiwanAddonsPage({searchParams}:{searchParams:Params}){
  const data=snapshot as unknown as Catalog;
  const q=val(searchParams.q).trim().slice(0,100);
  const type=val(searchParams.type);
  const category=type==="7005"||type==="7007"?type:"";
  const keyword=q.normalize("NFKC").toLowerCase();
  const list=(data.items??[]).filter(x=>
    (!category||x.nsuid.startsWith(category)) &&
    (!keyword||(x.nsuid+" "+(x.title??"")).normalize("NFKC").toLowerCase().includes(keyword))
  );
  const pages=Math.max(1,Math.ceil(list.length/PAGE_SIZE));
  const rawPage=Number.parseInt(val(searchParams.page)||"1",10);
  const page=Number.isFinite(rawPage)?Math.max(1,Math.min(rawPage,pages)):1;
  const items=list.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  const scannedAt=data.twPriceCheckedAt?new Date(data.twPriceCheckedAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false}):null;
  return <section className={styles.root}>
    <div className={styles.hero}>
      <p className={styles.eyebrow}>台灣 Nintendo eShop · 追加內容</p>
      <h1>台灣 DLC／組合包商品目錄</h1>
      <p>以台灣任天堂價格 API 確認在售的商品 NSUID。可搜尋追加內容、組合包及升級相關商品的編號與名稱。</p>
      <p className={styles.note}>
        重要：這份清單僅涵蓋歷史已發現並重新確認的商品，不能當作台灣所有 DLC。
        7005、7007 是商品編號區間，不保證個別商品類型；
        名稱與封面部分使用香港 TitleDB 的相同 NSUID 資料，<strong>尚未確認母遊戲配對</strong>。
      </p>
      <p className={styles.note}>最近台灣價格驗證：{scannedAt??"尚未開始"}（台北時間）</p>
      <p><Link href="/taiwan">返回台灣遊戲本體目錄</Link></p>
    </div>
    {!data.complete ? <p role="alert" className={styles.warning}>正在建立首次經過驗證的台灣 DLC 商品索引，尚未公開未驗證價格。</p> : <>
      <div className={styles.stats}>
        <strong>{data.counts.total.toLocaleString("zh-TW")}</strong> 筆台灣在售商品（已具名 {data.counts.named.toLocaleString("zh-TW")} 筆，有圖片 {data.counts.withImage.toLocaleString("zh-TW")} 筆）
      </div>
      <form method="GET" action="/taiwan/addons" className={styles.filters}>
        <input name="q" defaultValue={q} type="search" maxLength={100} placeholder="搜尋追加內容名稱或 NSUID" aria-label="搜尋台灣追加內容"/>
        <select name="type" defaultValue={category} aria-label="商品編號區間">
          <option value="">全部追加內容</option>
          <option value="7005">7005：DLC 候選</option>
          <option value="7007">7007：組合包等候選</option>
        </select>
        <button type="submit">查詢</button>
      </form>
      {items.length ? <div className={styles.grid}>
        {items.map(x=><article key={x.nsuid} className={styles.card}>
          <div className={styles.imageWrap}>
            {x.imageUrl?<img src={x.imageUrl} alt={x.title??"追加內容圖片"} loading="lazy" referrerPolicy="no-referrer"/>:
              <div className={styles.noImage}>目前沒有已驗證圖片</div>}
          </div>
          <div className={styles.content}>
            <div className={styles.platform}>{x.addonType==="dlc_candidate"?"7005 · DLC 候選":"7007 · 組合包等候選"}</div>
            <h2>{x.title??"追加內容（名稱待確認）"}</h2>
            <div className={styles.publisher}>母遊戲關聯：尚未確認</div>
            <div className={styles.price}>{money(x.effective,x.currency)}</div>
            {x.regular!==null && x.effective!==null && x.regular>x.effective &&
              <div className={styles.note}>原價：{money(x.regular,x.currency)}</div>}
            <div className={styles.nsuid}>NSUID：{x.nsuid}</div>
          </div>
        </article>)}
      </div>:<p className={styles.warning}>沒有符合搜尋條件的商品。</p>}
      <div className={styles.pagination}>
        {page>1?<Link href={link(q,category,page-1)}>上一頁</Link>:<span>上一頁</span>}
        <span>第 {page} / {pages} 頁</span>
        {page<pages?<Link href={link(q,category,page+1)}>下一頁</Link>:<span>下一頁</span>}
      </div>
    </>}
    <p className={styles.bottom}>圖片與候選名稱資料來源：<a href="https://github.com/blawar/titledb" target="_blank" rel="noreferrer">TitleDB（MIT）</a>，圖片著作權屬各原權利人。本站與任天堂無關；售價以實際結帳為準。</p>
  </section>;
}
