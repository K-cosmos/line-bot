import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import dotenv from "dotenv";
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
          const initialRichMenuId = richMenuIdMap["学外_×_×_0_0_0"];
          if (initialRichMenuId) {
            await client.linkRichMenuToUser(userId, initialRichMenuId);
          } else {
            console.warn("⚠️ 初期リッチメニューIDが見つからないよ！");
          }

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `はじめまして！\n「${userMessage}」として登録したよ！`,
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
        
        // webhook内のリッチメニューリンク部分の書き換え
        try {
          const richMenuId = getRichMenuId(
            currentUser.status,
            labKeyStatus,
            expKeyStatus,
            inLab.length > 0,
            inExp.length > 0,
            inCampus.length > 0
          );
        
          if (richMenuId) {
            await client.linkRichMenuToUser(userId, richMenuId);
          } else {
            console.warn("⚠️ リッチメニューIDが見つからない:", currentUser.status, labKeyStatus, expKeyStatus);
          }
        } catch (err) {
          console.warn("⚠️ リッチメニューリンク失敗:", err.message);
        }

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: replyText,
        });
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook処理でエラー:", error);
    res.sendStatus(500);
  }
});

// JSONパーサー（これWebhook前に書いとかないとダメ！）
app.use(express.json());

// 事前にアップロード済みのリッチメニューID一覧（ファイル名に合わせたキーで管理）
const richMenuIdMap = {
  "学内_×_×_0_0_1": "richmenu-032526b5a66e4916b8c1bd6edbf51d45",
  "学内_×_〇_0_1_1": "richmenu-d774a0ccf30ff35e998a3877d75561c9",
  "学内_△_〇_0_1_1": "richmenu-06201624557d24919c5849aea1df23e3",
  "学内_〇_×_1_0_1": "richmenu-d9e68b81dfd5422166896f274f21732f",
  "学内_〇_△_1_0_1": "richmenu-972a6ff304db0c9c1e36bb7342e2eb7c",
  "学内_〇_〇_1_1_1": "richmenu-1ba7cc0380d2a7b582b5f7930f7588f8",
  "学外_×_×_0_0_0": "richmenu-76caacb3bcdfb670ede63ec17b6661b7",
  "学外_×_×_0_0_1": "richmenu-9959ffe93763b859d2dca63a07eea1a0",
  "学外_×_〇_0_1_0": "richmenu-c4755d857e0c298b0bb48a2dc089ca35",
  "学外_×_〇_0_1_1": "richmenu-02f712db55bf74e7e5a4093b6f78abce",
  "学外_△_〇_0_1_0": "richmenu-a7438fc69c2c83ad05e22049bf01f312",
  "学外_△_〇_0_1_1": "richmenu-605be527c1574d8b4ca345b7378e0f57",
  "学外_〇_×_1_0_0": "richmenu-31ef49edab559547ce0c4ae2824e26de",
  "学外_〇_×_1_0_1": "richmenu-214d989ceef5e5901992053ede1aae3a",
  "学外_〇_△_1_0_0": "richmenu-a8934781a9dddb8e6e76a320eaf021e9",
  "学外_〇_△_1_0_1": "richmenu-f30cae1f34cfe82db0fbef150d0468d0",
  "学外_〇_〇_1_1_0": "richmenu-410a056269dfa5c008b3963126a1654b",
  "学外_〇_〇_1_1_1": "richmenu-85ab062f38eadaa28447f847442ab9dc",
  "実験室_×_〇_0_1_0": "richmenu-6c8fa67ce190d6e31e2c004fe8acc11b",
  "実験室_×_〇_0_1_1": "richmenu-074f0e1c80dfd6df0a6a3c0d2a9251fb",
  "実験室_△_〇_0_1_0": "richmenu-c59deb2dcee75992292408059d5cd094",
  "実験室_△_〇_0_1_1": "richmenu-b86e6abcb800dd2674518bb4fc867ad3",
  "実験室_〇_〇_1_1_0": "richmenu-f7791daa8a12ca6761e65c58b98b77e8",
  "実験室_〇_〇_1_1_1": "richmenu-4ad4d213cbcd3df760887c57dea19003",
  "研究室_〇_×_1_0_0": "richmenu-a73405adb8cf67ba114119525a0662d8",
  "研究室_〇_×_1_0_1": "richmenu-d0cdf8adeed38d4ace7dbd35b4e328b8",
  "研究室_〇_△_1_0_0": "richmenu-64e2444325557399f9c602903ecb604c",
  "研究室_〇_△_1_0_1": "richmenu-2d2dcac756392504f5339086b63b8683",
  "研究室_〇_〇_1_1_0": "richmenu-2cf9e4bd9786bdf1f22ccb5fa7cb96b6",
  "研究室_〇_〇_1_1_1": "richmenu-2aa60789a655269f5f9a66f85712d220",
};

function getRichMenuId(status, labKey, expKey, hasLabMembers, hasExpMembers, hasCampusMembers) {

  const labNumFlag = hasLabMembers ? 1 : 0;
  const expNumFlag = hasExpMembers ? 1 : 0;
  const campusNumFlag = hasCampusMembers ? 1 : 0;

  const key = `${status}_${labKey}_${expKey}_${labNumFlag}_${expNumFlag}_${campusNumFlag}`;

  return richMenuIdMap[key]; // 見つからなければundefinedを返す
}


// サーバー起動
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
