import Link from "next/link";

export const metadata = {
  title: "隱私權政策｜Shawn Game Studio",
};

export default function PrivacyPage() {
  return (
    <div className="narrow">
      <h1>🔒 隱私權政策</h1>
      <p className="muted">
        最後更新：2026-11-26｜本政策說明 Shawn Game Studio 如何處理你的個人資料。
      </p>

      <h2>一、我們蒐集哪些資料</h2>
      <p>
        本站提供 Google／Discord 第三方登入，僅為身分驗證、遊戲收藏、留言及相關會員功能使用。我們只會記錄：你的帳號識別碼（用來對應收藏）、你收藏了哪些遊戲、你按了哪些讚、你寫了哪些留言。
      </p>
      <p>
        本站<strong>不收集任何 Gmail 或 Discord 資料</strong>，也不會存取你的信箱、好友名單或伺服器內容；登入只向
        Google／Discord 確認「你是誰」，除此之外不存其他資料。
      </p>
      <p>
        本站不要求使用者額外提供個人資料，不會取得您的 Google／Discord
        密碼、私人郵件或聊天內容，亦不會販售個人資料。
      </p>

      <h2>二、蒐集目的與利用方式</h2>
      <p>
        蒐集目的為提供會員功能：身分驗證、遊戲收藏、按讚、留言。登入服務由第三方平台及
        Supabase 提供，僅處理維持網站功能所必要的帳號資訊及操作紀錄。
      </p>

      <h2>三、第三方服務</h2>
      <p>
        登入使用 Google／Discord 提供的 OAuth
        服務，資料儲存與帳號管理使用 Supabase。第三方服務的資料處理方式，依其各自的隱私權政策辦理。
      </p>

      <h2>四、Cookie 與瀏覽器儲存</h2>
      <p>
        本站使用 Cookie
        維持登入狀態（登入後返回原頁面的紀錄僅保留 10
        分鐘）。國家顯示設定存在你的瀏覽器（localStorage），並以 Cookie
        傳給伺服器，僅用於查詢當下要顯示的遊戲名單，不會存入資料庫。
      </p>

      <h2>五、資料保存期間</h2>
      <p>
        你的帳號資料與收藏、留言紀錄，在你使用本站期間保存；向我們提出刪除申請後，我們會刪除相關資料。
      </p>

      <h2>六、你的權利</h2>
      <p>
        如需查詢、更正或刪除帳號與相關資料，請透過
        <Link href="/about">本站聯絡管道</Link>
        （「關於我」頁面的 Instagram／Threads／Discord）提出申請。
      </p>

      <h2>七、政策變更</h2>
      <p>本政策如有修訂，將公告於本頁；修訂後繼續使用本站，即表示你同意修訂內容。</p>
    </div>
  );
}
