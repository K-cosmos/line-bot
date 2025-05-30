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
  members = members.map(m => ({ ...m, status: "学外" }));
  labKeyStatus = "×";
  expKeyStatus = "×";
});

// webhookだけ express.json()を使わないようにする！
app.use((req, res, next) => {
  if (req.path === "/webhook") {
    next(); // webhookはmiddlewareに任せる
  } else {
    express.json()(req, res, next); // それ以外はJSONパースする
  }
});

// webhook受信
// 既存のコードをベースに、以下のように大量にログを足してみる！

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
          currentUser = { name: userMessage, userId, status: "学内" };
          members.push(currentUser);

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `はじめまして！\n「${userMessage}」として登録したよ！`,
          });
        }

        const inLab = members.filter(m => m.status === "研究室");
        const inExp = members.filter(m => m.status === "実験室");
        const inCampus = members.filter(m => m.status === "学内");

        // 鍵の状態を更新
        labKeyStatus = inLab.length > 0 ? "〇" : "△";
        expKeyStatus = inExp.length > 0 ? "〇" : "△";

        const roomStatusMessage =
          `研究室\n${inLab.length > 0 ? inLab.map(m => `・${m.name}`).join("\n") : "（誰もいない）"}\n\n` +
          `実験室\n${inExp.length > 0 ? inExp.map(m => `・${m.name}`).join("\n") : "（誰もいない）"}\n\n` +
          `学内\n${inCampus.length > 0 ? inCampus.map(m => `・${m.name}`).join("\n") : "（誰もいない）"}`;

        const richMenuId = getRichMenuId(
          currentUser.status,
          labKeyStatus,
          expKeyStatus,
          inLab.length > 0,
          inExp.length > 0,
          inCampus.length > 0
        );

        if (richMenuId) {
          try {
            await client.linkRichMenuToUser(userId, richMenuId);
          } catch (linkError) {
            console.error("⚠️ リッチメニューリンク失敗:", linkError);
          }
        } else {
          console.warn("⚠️ リッチメニューIDが見つからなかったよ");
        }

        const replyText = `現在の状況だよ！\n\n${roomStatusMessage}`;

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: replyText,
        });
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("💥 Webhook処理でエラー:", error);
    res.sendStatus(500);
  }
});

// 事前にアップロード済みのリッチメニューID一覧（ファイル名に合わせたキーで管理）
const richMenuIdMap = {
  "学内_×_×_0_0_1": "richmenu-22508470c3c2310e77d861160d6ed885",
  "学内_×_〇_0_1_1": "richmenu-88a99e9ba9d1844682b6c73aa4d4c5d2",
  "学内_△_△_0_0_1": "richmenu-9d111f17f995637b5f77083f54f1c7df",
  "学内_△_〇_0_1_1": "richmenu-b970e9ec1e45f058f58e36d266ddcce9",
  "学内_〇_×_1_0_1": "richmenu-d746feab30b0ad2710fd9ef11f25d6a8",
  "学内_〇_△_1_0_1": "richmenu-3e69a591c91d77ff43872a4210a1a186",
  "学内_〇_〇_1_1_1": "richmenu-71982997385193983fa4a14f73b11341",
  "学外_×_×_0_0_0": "richmenu-82b5ddf49babafd555ba0f570999ba67",
  "学外_×_×_0_0_1": "richmenu-189dd30b5107086a9224744a238578d5",
  "学外_×_〇_0_1_0": "richmenu-e9e41f676a8666e0b90528b987cd3a15",
  "学外_×_〇_0_1_1": "richmenu-39f861067e719a07d90af74d818ffc73",
  "学外_△_△_0_0_0": "richmenu-eef686a9cae38f0f0bf7265628455e7a",
  "学外_△_〇_0_1_0": "richmenu-2da181caa645de445c2f4b0adcfb1f3b",
  "学外_△_〇_0_1_1": "richmenu-53afbc5dad60cfd4f296ffacec58cadf",
  "学外_〇_×_1_0_0": "richmenu-3940419dca1c35632644ad6cf8034286",
  "学外_〇_×_1_0_1": "richmenu-fa49f87ad347b80d53f9890ba4e2824c",
  "学外_〇_△_1_0_0": "richmenu-6651b17148c6af7336e16f299802176a",
  "学外_〇_△_1_0_1": "richmenu-0cdff27048bb380af3d8e1c61c0e5213",
  "学外_〇_〇_1_1_0": "richmenu-10c46ccf43ff7a6fbb6d6ac264a587ef",
  "学外_〇_〇_1_1_1": "richmenu-e1c444ea65a7888c6c2b2173c695e1e3",
  "実験室_×_〇_0_1_0": "richmenu-ccdab58bada5fb35fa1a0e27e017d51b",
  "実験室_×_〇_0_1_1": "richmenu-e20f675a679b4820ce8b9c33f57345da",
  "実験室_△_〇_0_1_0": "richmenu-eef54bf8700bdafe38d077bf849ba63f",
  "実験室_△_〇_0_1_1": "richmenu-ee4e9ab423213752d9445b0fd2105bfd",
  "実験室_〇_〇_1_1_0": "richmenu-c6405577fdd646288d3606a8c35a572e",
  "実験室_〇_〇_1_1_1": "richmenu-5ccdac123091330806e1dc10bb01a9fe",
  "研究室_〇_×_1_0_0": "richmenu-5db4a6140e95c45617f76e2c7d39f228",
  "研究室_〇_×_1_0_1": "richmenu-8c3fea54d2053b6aa95e83c4dc2691df",
  "研究室_〇_△_1_0_0": "richmenu-da54ff92d39e69b0bbeea6b1a17c205f",
  "研究室_〇_△_1_0_1": "richmenu-6639d26055b0d99997a15a3042c0adfd",
  "研究室_〇_〇_1_1_0": "richmenu-3444d2a86934f0e294eb4f9324f96729",
  "研究室_〇_〇_1_1_1": "richmenu-5ccdac123091330806e1dc10bb01a9fe",
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
