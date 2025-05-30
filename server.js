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
            console.log("✅ リッチメニューリンク結果:", result);
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
  "学内_×_×_0_0_1": "richmenu-f229124815cee13f8c676b93947cc834",
  "学内_×_〇_0_1_1": "richmenu-2a99f2423e8cce3933b42403a4fcb87b",
  "学内_△_〇_0_1_1": "richmenu-64d322126e8af713d407dc3db59bed93",
  "学内_〇_×_1_0_1": "richmenu-8e64afc6c445654cb3139edf996115eb",
  "学内_〇_△_1_0_1": "richmenu-46186237f10808b56eec6984ff38debb",
  "学内_〇_〇_1_1_1": "richmenu-8d5537c373c96493feefcf2934644f9f",
  "学外_×_×_0_0_0": "richmenu-0ff93b541f01c6543f840d3ee81625af",
  "学外_×_×_0_0_1": "richmenu-7052dd57fd2f06671fc516f4ecc56f9f",
  "学外_×_〇_0_1_0": "richmenu-36678a5c01ceec382478b55d1683c131",
  "学外_×_〇_0_1_1": "richmenu-209a01bc52578877093e7302983fde08",
  "学外_△_〇_0_1_0": "richmenu-f674ab4d267420ad8674acfc236dbbe1",
  "学外_△_〇_0_1_1": "richmenu-eb094b3279a63344d4f2842a3803672c",
  "学外_〇_×_1_0_0": "richmenu-f9b0c67c5c5bb8215642ab86fa5953c0",
  "学外_〇_×_1_0_1": "richmenu-b17918119acd7302f11d10ec2c8b3835",
  "学外_〇_△_1_0_0": "richmenu-c1dd2c4666dc23a4aef7c4d4ce9f0192",
  "学外_〇_△_1_0_1": "richmenu-a1144b77da8995709fd3aebbb75f0650",
  "学外_〇_〇_1_1_0": "richmenu-32b2789faa513151ee012fadbd22fe23",
  "学外_〇_〇_1_1_1": "richmenu-a8077677ef002d2b935a079687fe4858",
  "実験室_×_〇_0_1_0": "richmenu-ec329d03ef96929d3e1217c1c271e21a",
  "実験室_×_〇_0_1_1": "richmenu-c4b9379e2a16d67713aabfafdf186fdc",
  "実験室_△_〇_0_1_0": "richmenu-83b0ea8a149c6d15336ae004e80c8e4d",
  "実験室_△_〇_0_1_1": "richmenu-73ef09c4f5e5752fd60fc248966d5d2d",
  "実験室_〇_〇_1_1_0": "richmenu-c0c23fd15cf7768a537971ed1a367f98",
  "実験室_〇_〇_1_1_1": "richmenu-2f5611c8f4e846164084c4423f2618c0",
  "研究室_〇_×_1_0_0": "richmenu-4a8a7da927011ff75a4f774b7a7e3fc4",
  "研究室_〇_×_1_0_1": "richmenu-ae7f3f5d0616826220aebd400b9f5be7",
  "研究室_〇_△_1_0_0": "richmenu-eb080994dbe0e18e643ef83693ae69f6",
  "研究室_〇_△_1_0_1": "richmenu-16982464a4d312b73d7b8453727c8fea",
  "研究室_〇_〇_1_1_0": "richmenu-f37040facc6275d71355ad68ca722193",
  "研究室_〇_〇_1_1_1": "richmenu-6126017730c234bd854142fea71a6c4f",
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
