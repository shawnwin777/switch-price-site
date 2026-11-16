"use client";

import { COUNTRIES, DEFAULT_VISIBLE_CODES } from "@/lib/countries";

// 35 國顯示 / 封鎖設定。封鎖清單存在 localStorage（key: spc-blocked-countries），
// 至少保留一個可見國家；封鎖的國家不會出現在卡片最低價、價格表與排行計算中。
export default function CountrySettings({
  blocked,
  onChange,
}: {
  blocked: string[];
  onChange: (blocked: string[]) => void;
}) {
  const blockedSet = new Set(blocked);
  const visibleCount = COUNTRIES.length - blocked.length;

  function toggle(code: string) {
    if (blockedSet.has(code)) {
      onChange(blocked.filter((c) => c !== code));
    } else {
      if (visibleCount <= 1) {
        alert("至少要保留一個可見國家。");
        return;
      }
      onChange([...blocked, code]);
    }
  }

  return (
    <details className="country-panel">
      <summary>
        🌍 國家顯示設定（{visibleCount} / {COUNTRIES.length} 國可見，點一下封鎖／取消封鎖）
      </summary>
      <p className="muted">
        封鎖沒有可用信用卡的地區，該國價格就不會出現在最低價與價格表裡。設定只存在這台裝置的瀏覽器（localStorage）。
      </p>
      <div className="country-actions">
        <button
          type="button"
          className="btn"
          onClick={() => onChange([])}
        >
          全部顯示
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            onChange(
              COUNTRIES.filter((c) => !DEFAULT_VISIBLE_CODES.includes(c.code)).map(
                (c) => c.code
              )
            )
          }
        >
          只留台／港
        </button>
      </div>
      <div className="country-grid">
        {COUNTRIES.map((c) => (
          <button
            key={c.code}
            type="button"
            className={`country-chip ${blockedSet.has(c.code) ? "blocked" : ""}`}
            onClick={() => toggle(c.code)}
            title={blockedSet.has(c.code) ? "已封鎖，點一下恢復顯示" : "點一下封鎖隱藏"}
          >
            {blockedSet.has(c.code) ? "🚫" : "✅"} {c.name}（{c.code}）
          </button>
        ))}
      </div>
    </details>
  );
}
