"use client";

import { useRouter } from "next/navigation";
import { COUNTRIES } from "@/lib/countries";

/** 國家篩選：選某個國家，只顯示目前最低價在該國的遊戲。
 *  （只有 page + country 兩個參數，換國家時直接回第 1 頁。）
 *  basePath：/near-low 與 /historical-low 共用，預設 /near-low。 */
export default function NearLowCountryFilter({
  country,
  basePath = "/near-low",
}: {
  country?: string;
  basePath?: string;
}) {
  const router = useRouter();

  function onChange(next: string) {
    router.push(next ? `${basePath}?country=${next}` : basePath);
  }

  return (
    <div className="filter-row">
      <label className="muted" htmlFor="near-low-country">
        最低價國家：
      </label>
      <select
        id="near-low-country"
        className="input"
        style={{ width: "auto" }}
        value={country ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label="國家"
      >
        <option value="">全部國家</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
