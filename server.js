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
app.post("/webhook", middleware(config), async (req, res) => {
  try {
    const events = req.body.events;

    for (const event of events) {
      const userId = event.source.userId;

      if (event.type === "message" && event.message.type === "text") {
        const userMessage = event.message.text.trim();
        let currentUser = members.find(m => m.userId === userId);

        // 初回登録
        if (!currentUser) {
          currentUser = { name: userMessage, userId, status: "学内" };
          members.push(currentUser);
        }

        // 鍵の状態更新
        updateKeyStatus();

        // リッチメニュー更新
        const richMenuId = getRichMenuId(
          currentUser.status,
          labKeyStatus,
          expKeyStatus,
          members.some(m => m.status === "研究室"),
          members.some(m => m.status === "実験室"),
          members.some(m => m.status === "学内")
        );

        if (richMenuId) {
          await client.linkRichMenuToUser(userId, richMenuId).catch(console.error);
        }

      } else if (event.type === "postback") {
        const data = event.postback.data;
        let currentUser = members.find(m => m.userId === userId);

        if (!currentUser) continue; // 未登録ならスルー

        if (data.startsWith("btn:status")) {
          const statuses = ["研究室", "実験室", "学内", "学外"];
          const nextStatuses = statuses.filter(s => s !== currentUser.status);
          currentUser.status = nextStatuses[0];

        } else if (data.startsWith("btn:lab")) {
          const num = parseInt(data.replace("btn:lab", ""), 10);
          if ([1, 2].includes(num)) {
            labKeyStatus = getNextKeyStatus(labKeyStatus);
          } else if ([3, 4].includes(num)) {
            expKeyStatus = getNextKeyStatus(expKeyStatus);
          } else if ([5, 6].includes(num)) {
            labKeyStatus = getNextKeyStatus(labKeyStatus);
            expKeyStatus = getNextKeyStatus(expKeyStatus);
          }

        } else if (data === "btn:detail") {
          // 在室状況返信（実際に送信はしない）
          const roomStatusMessage = createRoomStatusMessage();
          console.log(`在室状況メッセージ: \n${roomStatusMessage}`);
        }

        // 鍵の状態更新
        updateKeyStatus();

        // リッチメニュー更新
        const richMenuId = getRichMenuId(
          currentUser.status,
          labKeyStatus,
          expKeyStatus,
          members.some(m => m.status === "研究室"),
          members.some(m => m.status === "実験室"),
          members.some(m => m.status === "学内")
        );

        if (richMenuId) {
          await client.linkRichMenuToUser(userId, richMenuId).catch(console.error);
        }
      }
    }

    res.sendStatus(200); // すべてのレスポンスはここでまとめる
  } catch (error) {
    console.error("💥 Webhook処理でエラー:", error);
    res.sendStatus(500);
  }
});

// 鍵の状態更新
function updateKeyStatus() {
  const inLab = members.some(m => m.status === "研究室");
  const inExp = members.some(m => m.status === "実験室");
  labKeyStatus = inLab ? "〇" : "△";
  expKeyStatus = inExp ? "〇" : "△";
}

// 鍵の状態切り替え
function getNextKeyStatus(current) {
  const statuses = ["〇", "△", "×"];
  const idx = statuses.indexOf(current);
  return statuses[(idx + 1) % statuses.length];
}

// 在室状況メッセージ生成
function createRoomStatusMessage() {
  const inLab = members.filter(m => m.status === "研究室");
  const inExp = members.filter(m => m.status === "実験室");
  const inCampus = members.filter(m => m.status === "学内");

  let message = "";
  if (inLab.length > 0) {
    message += `研究室\n${inLab.map(m => `・${m.name}`).join("\n")}\n\n`;
  }
  if (inExp.length > 0) {
    message += `実験室\n${inExp.map(m => `・${m.name}`).join("\n")}\n\n`;
  }
  if (inCampus.length > 0) {
    message += `学内\n${inCampus.map(m => `・${m.name}`).join("\n")}`;
  }
  return message.trim() || "誰もいないみたい…";
}

// 事前にアップロード済みのリッチメニューID一覧
const richMenuIdMap = {
  // （ここは元の通り！省略）
};

function getRichMenuId(status, labKey, expKey, hasLabMembers, hasExpMembers, hasCampusMembers) {
  const labNumFlag = hasLabMembers ? 1 : 0;
  const expNumFlag = hasExpMembers ? 1 : 0;
  const campusNumFlag = hasCampusMembers ? 1 : 0;
  const key = `${status}_${labKey}_${expKey}_${labNumFlag}_${expNumFlag}_${campusNumFlag}`;
  return richMenuIdMap[key];
}

// サーバー起動
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
