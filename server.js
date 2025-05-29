import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import dotenv from "dotenv";
import cron from "node-cron";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// LINE Bot設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

// メンバー管理配列
let members = [];

// 部屋の鍵状態（全体で共通管理）
let labKeyStatus = "×";
let expKeyStatus = "×";

// 4時に全員のステータスと鍵状態を初期化するcronジョブ
cron.schedule("0 4 * * *", () => {
  console.log("🔄 毎日4時にステータスと鍵をリセットするよ！");
  members = members.map(m => ({
    ...m,
    status: "学外",
  }));
  labKeyStatus = "×";
  expKeyStatus = "×";
});

// LINE webhook受信
app.post("/webhook", middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      const userMessage = event.message.text.trim();

      let currentUser = members.find(m => m.userId === userId);

       // 初期リッチメニュー（デフォルト画像）
        const defaultAlias = "richmenu_学外_×_×_0_0_0";
        try {
          await client.linkRichMenuToUser(userId, defaultAlias);
        } catch (err) {
          console.error("❌ 初期リッチメニューのリンクでエラー:", err);
        }
      
      // 初回メッセージなら名前として登録
      if (!currentUser) {
        currentUser = {
          name: userMessage,
          userId: userId,
          status: "学外",
        };
        members.push(currentUser);

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `はじめまして！「${userMessage}」として登録したよ！`,
        });
        continue;
      }

      // 以降は在室状況表示
      const inLab = members.filter(m => m.status === "研究室");
      const inExp = members.filter(m => m.status === "実験室");
      const inCampus = members.filter(m => m.status === "学内");

      // 🔑 鍵状態（全体）を決定
      labKeyStatus = inLab.length > 0 ? "〇" : "△";
      expKeyStatus = inExp.length > 0 ? "〇" : "△";

      // 在室状況メッセージ
      const roomStatusMessage =
        `研究室\n${inLab.map(m => `・${m.name}`).join("\n") || "（誰もいない）"}\n\n` +
        `実験室\n${inExp.map(m => `・${m.name}`).join("\n") || "（誰もいない）"}\n\n` +
        `学内\n${inCampus.map(m => `・${m.name}`).join("\n") || "（誰もいない）"}`;

      // リッチメニュー決定
      const richMenuAlias = getRichMenuAlias(
        currentUser.status,
        labKeyStatus,
        expKeyStatus,
        inLab.length > 0,
        inExp.length > 0,
        inCampus.length > 0
      );

      // ユーザーにリッチメニューをリンク
      try {
        await client.linkRichMenuToUser(userId, richMenuAlias);
      } catch (err) {
        console.error("❌ リッチメニューのリンクでエラー:", err);
      }

      // 返事
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: `やあ、${currentUser.name}！\nリッチメニューで選択してね！`,
      });
    }
  }
  res.send("ok");
});

// expressのjsonパーサー
app.use(express.json());

// リッチメニューエイリアス名を決める関数
function getRichMenuAlias(status, keyLab, keyExp, hasLab, hasExp, hasCampus) {
  const labStatus = hasLab ? "1" : "0";
  const expStatus = hasExp ? "1" : "0";
  const campusStatus = hasCampus ? "1" : "0";
  return `richmenu_${status}_${keyLab}_${keyExp}_${labStatus}_${expStatus}_${campusStatus}`;
}

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
