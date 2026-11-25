import Link from "next/link";

export const metadata = {
  title: "網站使用條款｜Shawn Game Studio",
};

export default function TermsPage() {
  return (
    <div className="narrow">
      <h1>📜 網站使用條款</h1>
      <p className="muted">最後更新：2026-11-26｜使用本站即表示你同意以下條款。</p>

      <h2>一、服務內容</h2>
      <p>
        Shawn Game Studio 提供遊戲比價服務：Switch 跨區比價、PC
        與家機特價、NSO 會員跨區比價、歷史低價查詢，以及會員收藏、按讚與留言功能。本站為免費服務。
      </p>

      <h2>二、非官方聲明</h2>
      <p>
        本站為非官方網站，與任天堂、索尼互動娛樂、微軟、Valve、Epic
        Games 無關，亦未經其授權或認可。Nintendo Switch、PlayStation、Xbox、Steam、Epic
        Games 等名稱與商標屬各權利人所有。
      </p>

      <h2>三、價格與資料免責</h2>
      <p>
        價格與特價資訊取自各官方商店公開資料，僅供參考，實際價格以商店頁面為準。牆面匯率以當天
        08:00 台北時間快照為準，NSO
        比價頁匯率為即時抓取（每小時快取）。本站不保證資料即時、完整或無錯誤，購買前請以官方商店頁面確認。
      </p>

      <h2>四、使用者行為規範</h2>
      <p>
        留言區規則：<strong>嚴禁攻擊其他玩家</strong>。不得洗版、張貼惡意連結、廣告、違法或侵權內容。留言內容由發表者自負責任。違反者可能被限制留言或封鎖帳號；被檢舉的留言本站得逕行刪除。
      </p>

      <h2>五、智慧財產與侵權通報</h2>
      <p>
        遊戲名稱、價格等事實性資訊用於商品識別與比價；封面圖片來源為各官方商店
        CDN、IGDB 等（來源標示於頁尾）。如果你認為本站內容侵害你的權利，請透過
        <Link href="/home">本站聯絡管道</Link>
        （首頁「關於我」的 Instagram／Threads／Discord）提出通報，說明侵權內容與連結，本站收到後會儘速處理（移除或修正）。
      </p>

      <h2>六、帳號與個人資料</h2>
      <p>
        本站登入僅使用 Google／Discord 第三方登入，個人資料的處理方式詳見
        <Link href="/privacy">隱私權政策</Link>。
      </p>

      <h2>七、服務變更與終止</h2>
      <p>本站得隨時調整、暫停或終止部分或全部服務，恕不另行通知。</p>

      <h2>八、準據法</h2>
      <p>本條款以中華民國法律為準據法。</p>
    </div>
  );
}
