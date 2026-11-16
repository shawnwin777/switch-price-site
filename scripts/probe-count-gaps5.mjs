// scripts/probe-count-gaps5.mjs
// 第六輪（收尾小驗證）：
// 1. Solr 無 DLC 遊戲的價格欄位（星露谷）en/de 對照，看 BOTW 的 regular/lowest 差異是否來自 DLC。
// 2. NA Algolia 空查詢前 1000 筆的排序是否為人氣排序（popularityRank），以及第 901-1000 筆的 prefix 混合。
// 只用任天堂官方端點；節流 250-400ms。
// 用法：node scripts/probe-count-gaps5.mjs

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { generated_at: new Date().toISOString() };

async function main() {
  // 1. Solr：星露谷（無 DLC 的純遊戲本體）en / de 價格欄位
  console.log('== Solr 星露谷價格欄位 ==');
  for (const loc of ['en', 'de']) {
    const url = `https://search.nintendo-europe.com/${loc}/select?q=${encodeURIComponent('Stardew Valley')}&fq=type%3AGAME&rows=1&wt=json&fl=title,nsuid_txt,price_regular_f,price_lowest_f,price_sorting_f,price_has_discount_b,price_discount_percentage_f`;
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    const j = await res.json();
    await sleep(300);
    const d = (j.response?.docs || [])[0];
    out[`stardew_${loc}`] = d;
    console.log(`${loc}:`, JSON.stringify(d));
  }
  // 再取一款已知 GB 特價的遊戲，看 discount 欄位（用 Solr 搜尋 price_has_discount_b:true 的 GAME）
  const discUrl = 'https://search.nintendo-europe.com/en/select?q=*%3A*&fq=type%3AGAME&fq=nsuid_txt%3A*&fq=price_has_discount_b%3Atrue&rows=2&wt=json&fl=title,nsuid_txt,price_regular_f,price_lowest_f,price_sorting_f,price_has_discount_b,price_discount_percentage_f';
  const discRes = await fetch(discUrl, { headers: UA, signal: AbortSignal.timeout(30000) });
  const discJ = await discRes.json();
  await sleep(300);
  out.discountExamples = discJ.response?.docs;
  console.log('特價範例（en）：', JSON.stringify(discJ.response?.docs));
  console.log('特價 GAME 總數：', discJ.response?.numFound);
  out.discountCount = discJ.response?.numFound;

  // 2. NA Algolia：空查詢排序與尾段 prefix
  console.log('\n== NA Algolia 排序檢查 ==');
  const AM_APP = 'U3B6GR4UA3';
  const AM_KEY = 'a29c6927638bfd8cee23993e51e721c9';
  const algoliaQuery = async (index, params) => {
    const res = await fetch(`https://${AM_APP}-dsn.algolia.net/1/indexes/${index}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': AM_APP, 'X-Algolia-API-Key': AM_KEY },
      body: JSON.stringify({ params }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));
    await sleep(300);
    return data;
  };
  const first5 = await algoliaQuery('store_all_products_en_us', 'query=&hitsPerPage=5&page=0&filters=productType%3AGames');
  out.algoliaFirst5 = (first5.hits || []).map((h) => ({ title: h.title, nsuid: h.nsuid, popularityRank: h.popularityRank, trendingRank: h.trendingRank }));
  console.log('前 5 筆：', JSON.stringify(out.algoliaFirst5));
  const tail = await algoliaQuery('store_all_products_en_us', 'query=&hitsPerPage=100&page=9&filters=productType%3AGames');
  const tailHits = tail.hits || [];
  const pre = {};
  for (const h of tailHits) { const p = h.nsuid ? String(h.nsuid).slice(0, 4) : 'null'; pre[p] = (pre[p] || 0) + 1; }
  out.algoliaTail100Prefix = pre;
  out.algoliaTail100Ranks = tailHits.slice(0, 3).map((h) => ({ title: h.title, popularityRank: h.popularityRank }));
  console.log(`第 901-1000 筆（n=${tailHits.length}）：prefix ${JSON.stringify(pre)}，前 3 筆 rank：`, JSON.stringify(out.algoliaTail100Ranks));

  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/count-gaps5.json', JSON.stringify(out, null, 2));
  console.log('\n已寫 /tmp/count-gaps5.json');
}

main().catch((err) => { console.error(err); process.exit(1); });
