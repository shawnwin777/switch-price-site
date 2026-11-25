import {
  MEMBERSHIP_CHECK_DATE,
  MEMBERSHIP_SERVICES,
  type MembershipPlan,
  type MembershipService,
} from "@/lib/membership-plans";

/** 單一服務的方案價目區（檔名沿用 MembershipTabs.tsx，內容已改）：
 *  2026-11-23 13:55 shawn 要會員方案移進 /console；14:00 他再定：
 *  家機頁只留四個分頁 XBOX 家機／XGP 家機／PlayStation／PS Plus，
 *  會員方案不再單獨成頁，改放進 XGP 家機（Game Pass）與 PS Plus
 *  兩個分頁裡（新進遊戲在上、方案價目在下）；/deals 的 PC Game Pass
 *  分頁也共用這裡（serviceId="game-pass"）。
 *  價目是靜態表（lib/membership-plans.ts），變動時手動改那裡；
 *  兩家各自呈現、不做對比表（shawn：讓玩家自己看，省得麻煩）。 */
export default function MembershipServiceSection({
  serviceId,
}: {
  serviceId: MembershipService["id"];
}) {
  const service =
    MEMBERSHIP_SERVICES.find((s) => s.id === serviceId) ??
    MEMBERSHIP_SERVICES[0];

  return (
    <section
      className={`membership-section membership-${service.id}`}
      aria-label={`${service.title}方案價目`}
    >
      <h2 className="membership-title">{service.title}方案價目</h2>
      <p className="muted">{service.subtitle}</p>
      <p className="muted">價格查核日期 {MEMBERSHIP_CHECK_DATE}。</p>
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
      <p className="muted">
        價目來源：PlayStation／Xbox 官方商店截圖（
        {MEMBERSHIP_CHECK_DATE}），權益以官方頁面為準；實際價格與內容以商店頁面為準，方案內容會隨時間調整。
      </p>
    </section>
  );
}

function PlanCard({ plan }: { plan: MembershipPlan }) {
  return (
    <article
      className={`plan-card${plan.highlight ? " plan-card-highlight" : ""}`}
    >
      <h3 className="plan-name">
        {plan.name}
        {plan.highlight && <span className="plan-tag">{plan.highlight}</span>}
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
