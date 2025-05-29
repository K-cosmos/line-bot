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
          try {
            await client.linkRichMenuToUser(userId, "学外_×_×_0_0_0");
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

        if (richMenuId) {
          try {
            await client.linkRichMenuToUser(userId, richMenuId);
          } catch (err) {
            console.warn("⚠️ リッチメニューリンク失敗:", err.message);
          }
        } else {
          console.warn("⚠️ リッチメニューIDが見つからない:", currentUser.status, labKeyStatus, expKeyStatus);
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
  "学内_×_×_0_0_1": "richmenu-3f4973eb885745abe8b657038840807d",
  "学内_×_〇_0_1_1": "richmenu-f107561573b990ea1903700cbeae369c",
  "学内_△_〇_0_1_1": "richmenu-f80c00c53b53a169174d4e9f2e256aed",
  "学内_〇_×_1_0_1": "richmenu-5834c72ae54f11f6588971ffceda8cb5",
  "学内_〇_△_1_0_1": "richmenu-a0729adfa0df131bb3bc07ee0e44af1e",
  "学内_〇_〇_1_1_1": "richmenu-571c99897e070a456cccd7c65b77f46c",
  "学外_×_×_0_0_0": "richmenu-b870c904759bf5848b05d89153b45c26",
  "学外_×_×_0_0_1": "richmenu-8457a7312c4970a6041d80f2683ef153",
  "学外_×_〇_0_1_0": "richmenu-d2ab604268331e474ec8c5e0b72c2fb8",
  "学外_×_〇_0_1_1": "richmenu-4b56a2084109e62907cd2df3405227dd",
  "学外_△_〇_0_1_0": "richmenu-637076fe55ea1c590cf569d3ab84e1fc",
  "学外_△_〇_0_1_1": "richmenu-cc8b60509f726e1fd9878e652cbe826c",
  "学外_〇_×_1_0_0": "richmenu-639ff3d2cc9b9d8936d055d06c73db3d",
  "学外_〇_×_1_0_1": "richmenu-a1d2a0e7bd9341bafa7ebeced4326789",
  "学外_〇_△_1_0_0": "richmenu-6291a7536e7cd50b040d3c9251de3737",
  "学外_〇_△_1_0_1": "richmenu-7f34f80d757f5d5a34fad69944e233a8",
  "学外_〇_〇_1_1_0": "richmenu-79222214c61dcb6c4a0376c0a4ba71f8",
  "学外_〇_〇_1_1_1": "richmenu-d3454376deb7384b5ea9d5e98724c5ee",
  "実験室_×_〇_0_1_0": "richmenu-1505d578e3014cc8e921a192bf441d21",
  "実験室_×_〇_0_1_1": "richmenu-6955e2117d4e8ba357bde66ed8279676",
  "実験室_△_〇_0_1_0": "richmenu-504880fe9ea1eb81d1d4f2f26b21bafc",
  "実験室_△_〇_0_1_1": "richmenu-10a036742265a25e900b771535445cad",
  "実験室_〇_〇_1_1_0": "richmenu-83ae01ab52b57207037603cc304e5762",
  "実験室_〇_〇_1_1_1": "richmenu-ea9d0866f8d3061e0cd2fba9ae098bb0",
  "研究室_〇_×_1_0_0": "richmenu-d65736cf090e9d4fe033d2d53443ce53",
  "研究室_〇_×_1_0_1": "richmenu-a08d80aac2a3d6e18b640505442048f7",
  "研究室_〇_△_1_0_0": "richmenu-432c0841011141e43a32213b210fddda",
  "研究室_〇_△_1_0_1": "richmenu-b22a449b906572c80ac4a898f9b76108",
  "研究室_〇_〇_1_1_0": "richmenu-ad26ff19cd30ef795ef99c36b42423c9",
  "研究室_〇_〇_1_1_1": "richmenu-73a7e28f6168b962074bc6dc2b854078",
};

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
