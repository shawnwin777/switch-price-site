// 35 個國家清單：用於首頁國家切換與封鎖隱藏。
// 種子資料（2026-11-15）有其中 32 國的價格；SG / MY / TH 目前尚無種子價格，
// 資料組補上價格後會自動出現在卡片與價格表（不需改前端）。
// eshop_url 為各區官方 eShop 首頁；未列出的以 nintendo.com 首頁代替。

export interface CountryInfo {
  code: string;
  name: string;
  currency: string;
  eshop_url: string;
}

export const COUNTRIES: CountryInfo[] = [
  { code: "TW", name: "台灣", currency: "TWD", eshop_url: "https://www.nintendo.com/zh-hant-tw/store/" },
  { code: "JP", name: "日本", currency: "JPY", eshop_url: "https://store-jp.nintendo.com/" },
  { code: "HK", name: "香港", currency: "HKD", eshop_url: "https://www.nintendo.com/zh-hant-hk/store/" },
  { code: "KR", name: "韓國", currency: "KRW", eshop_url: "https://store.nintendo.co.kr/" },
  { code: "US", name: "美國", currency: "USD", eshop_url: "https://www.nintendo.com/us/store/" },
  { code: "CA", name: "加拿大", currency: "CAD", eshop_url: "https://www.nintendo.com/en-ca/store/" },
  { code: "MX", name: "墨西哥", currency: "MXN", eshop_url: "https://www.nintendo.com/es-mx/store/" },
  { code: "BR", name: "巴西", currency: "BRL", eshop_url: "https://www.nintendo.com/pt-br/store/" },
  { code: "CL", name: "智利", currency: "CLP", eshop_url: "https://www.nintendo.com/es-cl/store/" },
  { code: "CO", name: "哥倫比亞", currency: "COP", eshop_url: "https://www.nintendo.com/es-co/store/" },
  { code: "AR", name: "阿根廷", currency: "ARS", eshop_url: "https://www.nintendo.com/es-ar/store/" },
  { code: "PE", name: "秘魯", currency: "PEN", eshop_url: "https://www.nintendo.com/es-pe/store/" },
  { code: "GB", name: "英國", currency: "GBP", eshop_url: "https://www.nintendo.com/en-gb/store/" },
  { code: "IE", name: "愛爾蘭", currency: "EUR", eshop_url: "https://www.nintendo.com/en-ie/store/" },
  { code: "DE", name: "德國", currency: "EUR", eshop_url: "https://www.nintendo.com/de-de/store/" },
  { code: "FR", name: "法國", currency: "EUR", eshop_url: "https://www.nintendo.com/fr-fr/store/" },
  { code: "ES", name: "西班牙", currency: "EUR", eshop_url: "https://www.nintendo.com/es-es/store/" },
  { code: "IT", name: "義大利", currency: "EUR", eshop_url: "https://www.nintendo.com/it-it/store/" },
  { code: "NL", name: "荷蘭", currency: "EUR", eshop_url: "https://www.nintendo.com/nl-nl/store/" },
  { code: "BE", name: "比利時", currency: "EUR", eshop_url: "https://www.nintendo.com/nl-be/store/" },
  { code: "AT", name: "奧地利", currency: "EUR", eshop_url: "https://www.nintendo.com/de-at/store/" },
  { code: "CH", name: "瑞士", currency: "CHF", eshop_url: "https://www.nintendo.com/de-ch/store/" },
  { code: "PT", name: "葡萄牙", currency: "EUR", eshop_url: "https://www.nintendo.com/pt-pt/store/" },
  { code: "PL", name: "波蘭", currency: "PLN", eshop_url: "https://www.nintendo.com/pl-pl/store/" },
  { code: "CZ", name: "捷克", currency: "CZK", eshop_url: "https://www.nintendo.com/cs-cz/store/" },
  { code: "DK", name: "丹麥", currency: "DKK", eshop_url: "https://www.nintendo.com/da-dk/store/" },
  { code: "FI", name: "芬蘭", currency: "EUR", eshop_url: "https://www.nintendo.com/fi-fi/store/" },
  { code: "SE", name: "瑞典", currency: "SEK", eshop_url: "https://www.nintendo.com/sv-se/store/" },
  { code: "NO", name: "挪威", currency: "NOK", eshop_url: "https://www.nintendo.com/nb-no/store/" },
  { code: "AU", name: "澳洲", currency: "AUD", eshop_url: "https://www.nintendo.com/en-au/store/" },
  { code: "NZ", name: "紐西蘭", currency: "NZD", eshop_url: "https://www.nintendo.com/en-nz/store/" },
  { code: "ZA", name: "南非", currency: "ZAR", eshop_url: "https://www.nintendo.com/en-za/store/" },
  { code: "SG", name: "新加坡", currency: "SGD", eshop_url: "https://www.nintendo.com/en-sg/store/" },
  { code: "MY", name: "馬來西亞", currency: "MYR", eshop_url: "https://www.nintendo.com/en-my/store/" },
  { code: "TH", name: "泰國", currency: "THB", eshop_url: "https://www.nintendo.com/en-th/store/" },
];

export const COUNTRY_MAP: Record<string, CountryInfo> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c])
);

/** 各區官方 eShop 首頁連結；未知國家回 nintendo.com 首頁。 */
export function eshopUrl(countryCode: string): string {
  return COUNTRY_MAP[countryCode]?.eshop_url ?? "https://www.nintendo.com/";
}

/** 試玩類型標籤。has_demo 對照：0 無試玩、1 免費 Demo、2 免費試玩（好友通行證等免費試玩）、3 NSO 限時試玩。 */
export const DEMO_LABELS: Record<number, string> = {
  0: "無試玩",
  1: "免費 Demo",
  2: "免費試玩",
  3: "NSO 限時試玩",
};

export function demoLabel(hasDemo: number | null | undefined): string {
  if (hasDemo == null) return "無試玩";
  return DEMO_LABELS[hasDemo] ?? "有試玩";
}

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  game: "遊戲本體",
  dlc: "追加內容",
  bundle: "組合包",
  subscription: "訂閱服務",
};

export function productTypeLabel(t: string | null | undefined): string {
  if (!t) return "遊戲";
  return PRODUCT_TYPE_LABELS[t] ?? t;
}
