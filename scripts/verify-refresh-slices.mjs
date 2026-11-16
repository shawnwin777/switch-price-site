// 切片數學單元驗算（開發用，不連 Supabase、不連網路）。
// 用法：node scripts/verify-refresh-slices.mjs
// 做法：把 lib/refresh-slices.ts（含 lib/nintendo.ts、lib/countries.ts）
// 編譯到 /tmp 後 require，再用獨立實作（Intl 台北日期）交叉比對：
//   1. 全部切片的範圍覆蓋 [0, total)、無重疊、無遺漏
//   2. 連續 slices 天輪轉恰好每片一次、下一天回到起點
//   3. cycleCompleteDateKey 那天的切片是最後一片，隔天回到第 0 片
//   4. nextSlice / clampSliceSize 邊界
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const outDir = mkdtempSync(join(tmpdir(), "refresh-slice-check-"));
execSync(
  `npx tsc lib/refresh-slices.ts lib/nintendo.ts lib/countries.ts ` +
    `--outDir ${outDir} --module commonjs --target es2022 --skipLibCheck`,
  { cwd: new URL("..", import.meta.url).pathname, stdio: "pipe" }
);
const require = createRequire(import.meta.url);
const S = require(join(outDir, "refresh-slices.js"));

// 獨立實作：台北日期 day-of-year（不用被測程式碼）
function taipeiKey(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
function doyIndependent(d) {
  const [y, m, day] = taipeiKey(d).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, day) - Date.UTC(y, 0, 1)) / 86400000);
}

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

// 1. 切片覆蓋：多種總數 × 多種片大小
for (const total of [0, 1, 32, 400, 401, 800, 1000, 3000, 5000, 10045]) {
  for (const size of [50, 300, 400, 500, 1000]) {
    const slices = S.sliceCount(total, size);
    const seen = new Array(total).fill(0);
    let covered = 0;
    for (let s = 0; s < slices; s++) {
      const { offset, count } = S.sliceRange(s, slices, total, size);
      for (let i = offset; i < offset + count; i++) seen[i]++;
      covered += count;
    }
    const ok = covered === total && seen.every((n) => n === 1);
    check(`覆蓋 total=${total} size=${size} → slices=${slices}`, ok, `covered=${covered}/${total}`);
  }
}

// 2. 輪轉：固定總數，連續 slices 天每片恰一次、下一天回到起點
for (const total of [32, 1000, 3000, 5000, 10045]) {
  const slices = S.sliceCount(total, 400);
  // 從 2027-01-01（台北）起連續 slices+1 天
  const start = new Date("2026-12-31T16:00:00Z"); // = 2027-01-01 台北
  const seq = [];
  for (let d = 0; d <= slices; d++) {
    const date = new Date(start.getTime() + d * 86400000);
    seq.push(S.rotationSlice(date, total, 400).slice);
    // 交叉比對 dayOfYear
    if (S.dayOfYearTaipei(date) !== doyIndependent(date)) {
      check(`dayOfYear 一致 total=${total} day=${d}`, false);
    }
  }
  const firstCycle = seq.slice(0, slices);
  const eachOnce = new Set(firstCycle).size === slices;
  const wraps = seq[slices] === seq[0];
  check(`輪轉 total=${total} slices=${slices}：${slices} 天每片一次、隔天回到起點`, eachOnce && wraps,
    `seq頭=${firstCycle.slice(0, 4).join(",")}… 隔天=${seq[slices]} 起點=${seq[0]}`);
}

// 3. cycleCompleteDateKey：那天是本輪最後一片，隔天是第 0 片
for (const total of [1000, 3000, 5000]) {
  const slices = S.sliceCount(total, 400);
  for (const iso of ["2027-04-10T16:00:00Z", "2027-02-28T16:00:00Z", "2028-02-28T16:00:00Z"]) {
    const date = new Date(iso);
    const endKey = S.cycleCompleteDateKey(date, total, 400);
    const endDate = new Date(endKey + "T04:00:00Z"); // 當天台北中午 12:00（勿用 T16:00Z，那是隔天台北 00:00）
    const endSlice = S.rotationSlice(endDate, total, 400).slice;
    const nextSlice = S.rotationSlice(new Date(endDate.getTime() + 86400000), total, 400).slice;
    check(`完整輪日期 total=${total} ${taipeiKey(date)} → ${endKey} 是最後一片、隔天回 0`,
      endSlice === slices - 1 && nextSlice === 0, `endSlice=${endSlice}/${slices - 1} next=${nextSlice}`);
  }
}

// 4. nextSlice / clamp 邊界
check("nextSlice 包回 0", S.nextSlice(7, 8) === 0 && S.nextSlice(2, 8) === 3);
check("nextSlice 單片恆為 0", S.nextSlice(0, 1) === 0);
check("clampSliceSize 邊界", S.clampSliceSize(10) === 50 && S.clampSliceSize(5000) === 1000 &&
  S.clampSliceSize(NaN) === 400 && S.clampSliceSize(400) === 400);
check("sliceCount(0)=1", S.sliceCount(0, 400) === 1);
check("rotationSlice 與 dayOfYear 一致（2026-11-16 台北）",
  S.rotationSlice(new Date("2026-11-16T00:00:00+08:00"), 3000, 400).slice ===
    doyIndependent(new Date("2026-11-16T00:00:00+08:00")) % S.sliceCount(3000, 400));

// 5. 實例：今天（台北 2026-11-16）3000 款的輪轉狀態
const today = new Date();
const st = S.rotationSlice(today, 3000, 400);
console.log(`\n實例：今天台北 ${taipeiKey(today)}，3000 款 / 每片 400 → slices=${S.sliceCount(3000, 400)}，` +
  `今天第 ${st.slice} 片，下一片 ${S.nextSlice(st.slice, S.sliceCount(3000, 400))}，` +
  `本輪跑完日 ${S.cycleCompleteDateKey(today, 3000, 400)}`);

if (failures > 0) { console.error(`\n${failures} 項失敗`); process.exit(1); }
console.log("\n全部驗算通過");
