import Link from "next/link";
import {
  MEMBERSHIP_CHECK_DATE,
  MEMBERSHIP_SERVICES,
  PS_PROMO_END,
  type MembershipPlan,
} from "@/lib/membership-plans";

export const metadata = {
  title: "會員方案｜Shawn Game Studio",
};

/** 會員方案頁（/membership，2026-11-23 新增，靜態頁、不抓 API）。
 *  PS Plus 與 Xbox Game Pass 放在同一頁，但各自呈現、不做兩家對比表
 *  （shawn：盡可能把各自差異寫上，讓玩家自己看，省得麻煩）。
 *  價目見 lib/membership-plans.ts：來源是 shawn 傳的兩張官方商店截圖
 *  （2026-11-23），權益已用官方頁面再核對過一次；PS 12 個月優惠價
 *  至 2026/11/30（Black Friday），頁面有標註。 */
export default function MembershipPage() {
  return (
    <>
      <h1 className="page-title">
        🎫 會員<span>方案</span>
      </h1>
      <p className="muted">
        PlayStation Plus 與 Xbox Game Pass 的台灣方案價目：各級距的價格、
        遊戲數與權益，各自列出、不做兩家對比，玩家自己看。價格查核日期{" "}
        {MEMBERSHIP_CHECK_DATE}；PS Plus 12 個月方案優惠價至 {PS_PROMO_END}。
      </p>

      {MEMBERSHIP_SERVICES.map((service) => (
        <section
          key={service.id}
          className={`membership-section membership-${service.id}`}
          aria-label={service.title}
        >
          <h2 className="membership-title">{service.title}</h2>
          <p className="muted">{service.subtitle}</p>
          <div className="plan-grid">
            {service.plans.map((plan) => (
              <PlanCard key={plan.name} plan={plan} />
            ))}
          </div>
          {service.notes.map((note) => (
            <p key={note} className="muted">
              {note}
            </p>
          ))}
          <p className="muted">
            官方頁面：{" "}
            <a href={service.officialUrl} target="_blank" rel="noreferrer">
              {service.officialLabel} →
            </a>
          </p>
        </section>
      ))}

      <p className="muted">
        價目來源：PlayStation／Xbox 官方商店截圖（{MEMBERSHIP_CHECK_DATE}），
        權益以官方頁面為準；實際價格與內容以商店頁面為準，方案內容會隨時間調整。
      </p>
      <p>
        <Link href="/">← 回首頁</Link>
      </p>
    </>
  );
}

function PlanCard({ plan }: { plan: MembershipPlan }) {
  return (
    <article
      className={`plan-card${plan.highlight ? " plan-card-highlight" : ""}`}
    >
      <h3 className="plan-name">
        {plan.name}
        {plan.highlight && (
          <span className="plan-tag">{plan.highlight}</span>
        )}
      </h3>
      <p className="plan-tagline">{plan.tagline}</p>
      <p className="plan-monthly">
        約 NT$ {plan.monthlyApprox.toLocaleString("zh-Hant-TW")}／月
      </p>
      <ul className="plan-prices">
        {plan.prices.map((p) => (
          <li key={p.months} className="plan-price-row">
            <span>
              {p.months} 個月一期：NT${" "}
              {p.price.toLocaleString("zh-Hant-TW")}
            </span>
            {p.original != null && (
              <span className="plan-orig">
                原價 NT$ {p.original.toLocaleString("zh-Hant-TW")}
              </span>
            )}
            {p.savePct != null && (
              <span className="plan-save">省 {p.savePct}%</span>
            )}
            {p.months === 12 && (
              <span className="plan-promo">優惠至 {PS_PROMO_END}</span>
            )}
          </li>
        ))}
      </ul>
      <ul className="plan-benefits">
        {plan.benefits.map((b) => (
          <li key={b.label} className={b.included ? "yes" : "no"}>
            {b.included ? "✓" : "✗"} {b.label}
            {b.note ? <span className="plan-note">（{b.note}）</span> : null}
          </li>
        ))}
      </ul>
    </article>
  );
}
