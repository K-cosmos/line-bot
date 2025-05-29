import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import cron from "node-cron";

// 環境変数読み込み
dotenv.config();

// LINE Bot設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);
const app = express();
const PORT = process.env.PORT || 3000;

// メンバーと鍵の状態
let members = [];
let labKeyStatus = "×";
let expKeyStatus = "×";

// 毎日4時にステータスと鍵をリセット
cron.schedule("0 4 * * *", () => {
  console.log("🔄 毎日4時にステータスと鍵をリセットするよ！");
  members = members.map(m => ({ ...m, status: "学外" }));
  labKeyStatus = "×";
  expKeyStatus = "×";
});

// webhook受信
app.post("/webhook", middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      const userMessage = event.message.text.trim();

      let currentUser = members.find(m => m.userId === userId);

      // 初期リッチメニューリンク
      const defaultAlias = "richmenu_学外_×_×_0_0_0";
      try {
        await client.linkRichMenuToUser(userId, defaultAlias);
      } catch (err) {
        console.error("❌ 初期リッチメニューリンクエラー:", err);
      }

      // 初回登録
      if (!currentUser) {
        currentUser = { name: userMessage, userId, status: "学外" };
        members.push(currentUser);
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `はじめまして！「${userMessage}」として登録したよ！`,
        });
        continue;
      }

      // ステータス表示処理
      const inLab = members.filter(m => m.status === "研究室");
      const inExp = members.filter(m => m.status === "実験室");
      const inCampus = members.filter(m => m.status === "学内");

      labKeyStatus = inLab.length > 0 ? "〇" : "△";
      expKeyStatus = inExp.length > 0 ? "〇" : "△";

      const roomStatusMessage =
        `研究室\n${inLab.map(m => `・${m.name}`).join("\n") || "（誰もいない）"}\n\n` +
        `実験室\n${inExp.map(m => `・${m.name}`).join("\n") || "（誰もいない）"}\n\n` +
        `学内\n${inCampus.map(m => `・${m.name}`).join("\n") || "（誰もいない）"}`;

      const richMenuAlias = getRichMenuAlias(
        currentUser.status,
        labKeyStatus,
        expKeyStatus,
        inLab.length > 0,
        inExp.length > 0,
        inCampus.length > 0
      );

      try {
        await client.linkRichMenuToUser(userId, richMenuAlias);
      } catch (err) {
        console.error("❌ リッチメニューリンクエラー:", err);
      }

      await client.replyMessage(event.replyToken, {
        type: "text",
        text: `やあ、${currentUser.name}！\nリッチメニューで選択してね！`,
      });
    }
  }

  res.send("ok");
});

// JSONパーサー
app.use(express.json());

// リッチメニューエイリアス名を決める関数
function getRichMenuAlias(status, keyLab, keyExp, hasLab, hasExp, hasCampus) {
  const lab = hasLab ? "1" : "0";
  const exp = hasExp ? "1" : "0";
  const campus = hasCampus ? "1" : "0";
  return `richmenu_${status}_${keyLab}_${keyExp}_${lab}_${exp}_${campus}`;
}

// ▼ おまけ：画像からリッチメニューを一括作成する関数
async function createAllRichMenus() {
  const imagesDir = "./Richmenu";
  const imageFiles = fs.readdirSync(imagesDir).filter(file => file.endsWith(".png"));

  for (const file of imageFiles) {
    const filePath = path.join(imagesDir, file);
    const richMenuConfig = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: `RichMenu for ${file}`,
      chatBarText: "メニューを開く",
      areas: [
        { bounds: { x: 0, y: 1280, width: 833, height: 128 }, action: { type: "postback", data: "btn:status1" } },
        { bounds: { x: 0, y: 1408, width: 833, height: 128 }, action: { type: "postback", data: "btn:status2" } },
        // 必要ならここに他のエリアを追加
      ]
    };

    try {
      const richMenuId = await client.createRichMenu(richMenuConfig);
      console.log(`✅ ${file} → RichMenu作成完了！ID: ${richMenuId}`);
      await client.setRichMenuImage(richMenuId, fs.createReadStream(filePath));
      console.log(`✅ ${file} → 画像アップロード完了！`);
      // await client.createRichMenuAlias(richMenuId, "richmenu_〇〇〇") も追加できるよ
    } catch (err) {
      console.error(`❌ ${file}でエラー:`, err);
    }
  }
}

// 必要なら手動で呼び出してね：createAllRichMenus();

// サーバー起動
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
