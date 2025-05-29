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
const imagesDir = "./Richmenu";

// メンバー情報と鍵の状態を管理
let members = [];
let labKeyStatus = "×";
let expKeyStatus = "×";

// 毎日4時にステータスと鍵をリセットするスケジュール
cron.schedule("0 4 * * *", () => {
  console.log("🔄 毎日4時にステータスと鍵をリセットするよ！");
  members = members.map(m => ({ ...m, status: "学外" }));
  labKeyStatus = "×";
  expKeyStatus = "×";
});

// webhook受信
app.post("/webhook", middleware(config), async (req, res) => {
  try {
    const events = req.body.events;

    for (const event of events) {
      if (event.type === "message" && event.message.type === "text") {
        const userId = event.source.userId;
        const userMessage = event.message.text.trim();

        let currentUser = members.find(m => m.userId === userId);

        // 初回登録
        if (!currentUser) {
          currentUser = { name: userMessage, userId, status: "学外" };
          members.push(currentUser);

          // 初期リッチメニューをリンク（もしあれば）
          try {
            await client.linkRichMenuToUser(userId, "richmenu_学外_×_×_0_0_0");
          } catch (err) {
            console.warn("⚠️ 初期リッチメニューリンク失敗:", err.message);
          }

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `はじめまして！「${userMessage}」として登録したよ！`,
          });
          continue; // 他の処理はしないで次イベントへ
        }

        // メンバーごとのステータスに応じてリッチメニューを切り替えるため、現在の状況を集計
        const inLab = members.filter(m => m.status === "研究室");
        const inExp = members.filter(m => m.status === "実験室");
        const inCampus = members.filter(m => m.status === "学内");

        // 鍵の状態を更新
        labKeyStatus = inLab.length > 0 ? "〇" : "△";
        expKeyStatus = inExp.length > 0 ? "〇" : "△";

        // メンバーの現在地リストをメッセージに
        const roomStatusMessage =
          `研究室\n${inLab.length > 0 ? inLab.map(m => `・${m.name}`).join("\n") : "（誰もいない）"}\n\n` +
          `実験室\n${inExp.length > 0 ? inExp.map(m => `・${m.name}`).join("\n") : "（誰もいない）"}\n\n` +
          `学内\n${inCampus.length > 0 ? inCampus.map(m => `・${m.name}`).join("\n") : "（誰もいない）"}`;

        // ユーザーに返信するテキストの例（必要に応じて変更してね）
        let replyText = `やあ、${currentUser.name}！\n現在のステータスは「${currentUser.status}」だよ。\n\n` +
                        roomStatusMessage + `\n\nリッチメニューで選択してね！`;

        // リッチメニューのエイリアスを決めてユーザーにリンク
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
          console.warn("⚠️ リッチメニューリンク失敗:", err.message);
        }

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: replyText,
        });
      }

      // POSTBACKイベントなどが来たらここで処理してもいいよ（必要なら）
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook処理でエラー:", error);
    res.sendStatus(500);
  }
});

// JSONパーサー（これWebhook前に書いとかないとダメ！）
app.use(express.json());

// リッチメニューエイリアス名を決める関数
function getRichMenuAlias(status, keyLab, keyExp, hasLab, hasExp, hasCampus) {
  const lab = hasLab ? "1" : "0";
  const exp = hasExp ? "1" : "0";
  const campus = hasCampus ? "1" : "0";
  return `richmenu_${status}_${keyLab}_${keyExp}_${lab}_${exp}_${campus}`;
}

// 画像ファイル名からリッチメニュー設定を返す関数（例）
function getRichMenuConfig(fileName) {
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: `RichMenu for ${fileName}`,
    chatBarText: "メニューを開く",
    areas: [
      { bounds: { x: 0, y: 1280, width: 833, height: 128 }, action: { type: "postback", data: "btn:status1" } },
      { bounds: { x: 0, y: 1408, width: 833, height: 128 }, action: { type: "postback", data: "btn:status2" } },
      // 必要に応じて追加してね
    ]
  };
}

// 画像フォルダの全リッチメニュー作成関数
async function createAllRichMenus() {
  const imageFiles = fs.readdirSync(imagesDir).filter(file => file.endsWith(".png"));

  for (const file of imageFiles) {
    const filePath = path.join(imagesDir, file);
    const richMenuConfig = getRichMenuConfig(file);

    try {
      const richMenuId = await client.createRichMenu(richMenuConfig);
      console.log(`✅ ${file} → RichMenu作成完了！ID: ${richMenuId}`);

      await client.setRichMenuImage(richMenuId, fs.createReadStream(filePath));
      console.log(`✅ ${file} → 画像アップロード完了！`);
    } catch (err) {
      console.error(`❌ ${file}でエラー:`, err);
    }
  }
}

// 単一リッチメニュー作成例（必要なら呼んで使ってね）
async function createRichMenu() {
  const richMenuAlias = "richmenu_研究室Botメニュー"; // 好きな名前に変更してね
  const richMenu = {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "研究室Botメニュー",
    chatBarText: "メニューを開く",
    areas: [
      { bounds: { x: 0, y: 1280, width: 833, height: 128 }, action: { type: "postback", data: "btn:status1" } },
      { bounds: { x: 0, y: 1408, width: 833, height: 128 }, action: { type: "postback", data: "btn:status2" } },
      { bounds: { x: 0, y: 1536, width: 833, height: 128 }, action: { type: "postback", data: "btn:status3" } },
      { bounds: { x: 833, y: 1280, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab1" } },
      { bounds: { x: 833, y: 1408, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab2" } },
      { bounds: { x: 833, y: 1536, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab3" } },
      { bounds: { x: 1666, y: 1280, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab4" } },
      { bounds: { x: 1666, y: 1408, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab5" } },
      { bounds: { x: 1666, y: 1536, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab6" } },
      { bounds: { x: 1666, y: 1664, width: 833, height: 128 }, action: { type: "postback", data: "btn:detail" } }
    ]
  };

  try {
    const richMenuId = await client.createRichMenu(richMenu);
    console.log("リッチメニュー作成完了！ID:", richMenuId);

    const imagePath = path.resolve("./richmenu.png");
    await client.setRichMenuImage(richMenuId, fs.createReadStream(imagePath));
    console.log("画像アップロード完了！");

    await client.createRichMenuAlias(richMenuId, richMenuAlias);
    console.log(`✅ ${richMenuAlias}をエイリアスに登録完了！`);
  } catch (err) {
    console.error("リッチメニュー作成エラー:", err);
  }
}

// 手動で呼ぶ場合
// createAllRichMenus();

// サーバー起動
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
