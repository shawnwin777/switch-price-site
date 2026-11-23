import Link from "next/link";
import { COUNTRY_MAP, eshopUrl } from "@/lib/countries";
import { formatRaw } from "@/lib/format";
import { getCachedNsoFx } from "@/lib/cached-data";
import {
  NSO_CHECK_DATE,
  NSO_PLANS,
  nsoCheapest,
  nsoSortedRows,
  nsoTwd,
  type NsoPlanKey,
} from "@/lib/nso-prices";

export const metadata = {
  title: "NSO 會員跨區比價｜Shawn Game Studio",
};

// 匯率要即時抓（每小時快取），頁面 force-dynamic 才不會在建置時
// 把匯率寫死；價格表本身仍是靜態查證價目。
export const dynamic = "force-dynamic";

/** NSO 會員跨區比價表（靜態查證價目，v1）。
 *  價格查核日期見 lib/nso-prices.ts（NSO_CHECK_DATE）；NSO 價格很少變動
 *  （通常一年一次），先用靜態表，兌換券已停售、僅列最後販售價。
 *  匯率 2026-11-23 起改即時：伺服器端抓 open.er-api.com，每小時快取
 *  一次（lib/cached-data.ts 的 getCachedNsoFx），抓不到退回靜態快照。
 *  查不到的格子顯示「未查到」，絕對不編價格。 */
export default async function NsoPage() {
  const fx = await getCachedNsoFx();
  const perUsd = fx.perUsd;
  const rows = nsoSortedRows(perUsd);
  const cheapest: Record<string, string | null> = {};
  for (const p of NSO_PLANS) {
    cheapest[p.key] = nsoCheapest(p.key, perUsd)?.code ?? null;
  }
  cheapest.voucher = nsoCheapest("voucher", perUsd)?.code ?? null;

  return (
    <>
      <h1 className="page-title">
        NSO 會員<span>跨區比價</span>
      </h1>
      <p className="muted">
        35 國 Nintendo Switch Online 會員價目：一般會員 30 天／90 天／12 個月、
        擴充包個人／家庭 12 個月、家庭會員 12 個月，以及已停售的遊戲兌換券（2
        張組）最後販售價。價格查核日期 {NSO_CHECK_DATE}。
      </p>
      <p className="muted">
        各品項最便宜：一般 30 天{" "}
        <b>{cheapestLabel("m1")}</b>、一般 90 天 <b>{cheapestLabel("m3")}</b>、
        一般 12 個月 <b>{cheapestLabel("y12")}</b>、家庭 12 個月{" "}
        <b>{cheapestLabel("fam12")}</b>、擴充個人 12 個月{" "}
        <b>{cheapestLabel("exp12")}</b>、擴充家庭 12 個月{" "}
        <b>{cheapestLabel("expFam12")}</b>、兌換券最後販售價{" "}
        <b>{cheapestLabel("voucher")}</b>。
      </p>
      <div className="nso-notice">
        <b>⚠️ 任天堂遊戲兌換券已停售，買不到了。</b>
        任天堂於 2026 年 1 月 30 日 23:59
        起停止販售兌換券；已購買的兌換券自購買日起 12 個月內有效，最晚用到
        2027 年 1 月 30 日。兌換券不適用 Nintendo Switch 2 專用遊戲。
        下表「兌換券」一欄僅列最後販售價供參考。
      </div>
      <div className="price-table-wrap">
        <table className="price-table">
          <thead>
            <tr>
              <th>國家</th>
              {NSO_PLANS.map((p) => (
                <th key={p.key} className="num">
                  {p.label}
                </th>
              ))}
              <th className="num">兌換券 2 張（已停售）</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const country = COUNTRY_MAP[row.code];
              return (
                <tr key={row.code} className={row.code === "TW" ? "tw-row" : undefined}>
                  <td>
                    <a
                      href={eshopUrl(row.code)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {country?.name ?? row.code}
                    </a>
                  </td>
                  {NSO_PLANS.map((p) => {
                    const local = row.prices[p.key];
                    if (local == null) {
                      return (
                        <td key={p.key} className="num unknown">
                          未查到
                        </td>
                      );
                    }
                    const twd = nsoTwd(local, row.currency, perUsd);
                    const isBest = cheapest[p.key] === row.code;
                    return (
                      <td
                        key={p.key}
                        className={`num${isBest ? " cheapest-cell" : ""}`}
                      >
                        {formatRaw(local, row.currency)}
                        {row.currency !== "TWD" && (
                          <span className="twd-sub">約 NT$ {twd.toLocaleString("zh-Hant-TW")}</span>
                        )}
                        {isBest && <span className="best-tag">👑 最便宜</span>}
                      </td>
                    );
                  })}
                  <td className={`num${cheapest.voucher === row.code ? " cheapest-cell" : ""}`}>
                    {row.voucher === "not-sold" ? (
                      <span className="unknown">未販售</span>
                    ) : typeof row.voucher === "number" ? (
                      <>
                        {formatRaw(row.voucher, row.currency)}
                        {row.currency !== "TWD" && (
                          <span className="twd-sub">
                            約 NT$ {nsoTwd(row.voucher, row.currency, perUsd).toLocaleString("zh-Hant-TW")}
                          </span>
                        )}
                        {row.voucherNote && (
                          <span className="twd-sub">{row.voucherNote}</span>
                        )}
                        {cheapest.voucher === row.code && (
                          <span className="best-tag">👑 最便宜</span>
                        )}
                      </>
                    ) : (
                      <span className="unknown">未查到</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        換算台幣：匯率{fx.live ? `即時更新 ${fx.date}` : `快照 ${fx.date}（即時抓取失敗，顯示快照）`}
        （{fx.source}），僅供比較；
        實際扣款以當地幣別為準，跨區購買前請以任天堂官方頁面為準。
        家庭會員最多 8 個 Nintendo Account 共用（不必同一戶籍）；切換帳號地區與海外付款可能受限。
      </p>
      <p className="muted">
        價格來源：Bulbapedia「Nintendo Switch Online」價目（2025-11-18）為底；
        2026 年已證實調價的國家以新價為準——韓國 2026-07-01 漲價、巴西 2026-03
        降價、墨西哥／秘魯／智利／哥倫比亞／阿根廷 2026 年調價（詳見
        lib/nso-prices.ts 檔頭註解）。兌換券停售資訊見任天堂支援 FAQ。
      </p>
      <p>
        <Link href="/home">← 回首頁</Link>
      </p>
    </>
  );

  function cheapestLabel(plan: NsoPlanKey | "voucher"): string {
    const code = cheapest[plan];
    if (!code) return "—";
    const row = rows.find((r) => r.code === code);
    const name = COUNTRY_MAP[code]?.name ?? code;
    if (!row) return name;
    const local =
      plan === "voucher"
        ? typeof row.voucher === "number"
          ? row.voucher
          : null
        : row.prices[plan] ?? null;
    if (local == null) return name;
    if (row.currency === "TWD") return `${name} NT$ ${local}`;
    return `${name} 約 NT$ ${nsoTwd(local, row.currency, perUsd).toLocaleString("zh-Hant-TW")}`;
  }
}
