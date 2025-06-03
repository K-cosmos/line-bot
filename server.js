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
          currentUser = { name: userMessage, userId, status: "学外" };
          members.push(currentUser);
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `はじめまして!\n「${userMessage}」として登録したよ!`
          });
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
          console.log(`🔘 ボタン押下: ステータス変更 (${currentUser.name})`);
          const statuses = ["研究室", "実験室", "学内", "学外"];
          const nextStatuses = statuses.filter(s => s !== currentUser.status);
          currentUser.status = nextStatuses[0];

        } else if (data.startsWith("btn:lab")) {
          const num = parseInt(data.replace("btn:lab", ""), 10);
          console.log(`🔘 ボタン押下: 鍵変更ボタン(${num}) (${currentUser.name})`);

          if ([1, 2].includes(num)) {
            labKeyStatus = getNextKeyStatus(labKeyStatus);
          } else if ([3, 4].includes(num)) {
            expKeyStatus = getNextKeyStatus(expKeyStatus);
          } else if ([5, 6].includes(num)) {
            labKeyStatus = getNextKeyStatus(labKeyStatus);
            expKeyStatus = getNextKeyStatus(expKeyStatus);
          }

        } else if (data === "btn:detail") {
          console.log(`🔘 ボタン押下: 在室状況確認 (${currentUser.name})`);
          const roomStatusMessage = createRoomStatusMessage();
          console.log(`在室状況メッセージ: \n${roomStatusMessage}`);

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: roomStatusMessage
          });
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
// Rich menu ID mapping
const richMenuMapping = {
  "Firstmenu.png": "richmenu-ffa1e8b916b73c0c441656ccf7c945d2",
  "学内_×_×_0_0_1.png": "richmenu-c82283b71178f0dc4757869c382deb71",
  "学内_×_〇_0_1_1.png": "richmenu-bb08b1ac8a41ccb1aad8d9d2764c7fa4",
  "学内_△_△_0_0_1.png": "richmenu-fe9e762c582bff779d32cddfc9c320b4",
  "学内_△_〇_0_1_1.png": "richmenu-29654e9d4cc267bc7f28b80ca52883c4",
  "学内_〇_×_1_0_1.png": "richmenu-6250cd4a5dde0517afa84cc8211cc521",
  "学内_〇_△_1_0_1.png": "richmenu-f466b6c246d8d13b1e09ee3a771776bb",
  "学内_〇_〇_1_1_1.png": "richmenu-b7fdb6505b94c502a756ab9a638bd6ff",
  "学外_×_×_0_0_0.png": "richmenu-8b6b88a23d313427a7bd422efce6ceb3",
  "学外_×_×_0_0_1.png": "richmenu-c365028833875700339edbfcbd6d34a1",
  "学外_×_〇_0_1_0.png": "richmenu-7ad7099b649528dd4e3cfbef4f91f24c",
  "学外_×_〇_0_1_1.png": "richmenu-5e4ad3023aeb3419bd40c6ee75454779",
  "学外_△_△_0_0_0.png": "richmenu-418668f833bee1ae7d7849a2e9b3d304",
  "学外_△_〇_0_1_0.png": "richmenu-3d18871f6d0bd4b7d4e3b2e1df03a6d8",
  "学外_△_〇_0_1_1.png": "richmenu-e0d875debf27f3bcedc42ae5d2a2eba8",
  "学外_〇_×_1_0_0.png": "richmenu-c0b41b9976515984fa8cda775e48cd01",
  "学外_〇_×_1_0_1.png": "richmenu-377fb4e9107eeaf3d2bf92d5e255aed1",
  "学外_〇_△_1_0_0.png": "richmenu-009a667136810fcdceb3f1ea3a929839",
  "学外_〇_△_1_0_1.png": "richmenu-0adf70c59bc191c6b4f3225d9ddf7c9c",
  "学外_〇_〇_1_1_0.png": "richmenu-59c91b5ab19d7f90c47ae7c30e7d085a",
  "学外_〇_〇_1_1_1.png": "richmenu-09067973db5ae5ff79060d5e03fd0f93",
  "実験室_×_〇_0_1_0.png": "richmenu-567cbbe08b7cc649a889d9007a1a8bb1",
  "実験室_×_〇_0_1_1.png": "richmenu-f69ed980570ec194fdaa01ba756b90ec",
  "実験室_△_〇_0_1_0.png": "richmenu-a41b864bd3dd947f5ee27333934ce8ab",
  "実験室_△_〇_0_1_1.png": "richmenu-818232f0ae68bfdf3857e1c7858567b5",
  "実験室_〇_〇_1_1_0.png": "richmenu-35f1e40c0fb87d36854466e1bbd1fd68",
  "実験室_〇_〇_1_1_1.png": "richmenu-96468795b44d76c0ec1a1b994efd1c5e",
  "研究室_〇_×_1_0_0.png": "richmenu-a4ec26894edf98a8c1540c9130e71e74",
  "研究室_〇_×_1_0_1.png": "richmenu-82d560f099ce7fcafdd6b2a2336f35dd",
  "研究室_〇_△_1_0_0.png": "richmenu-0785cbdef0d3f0ae16915253dc75aacf",
  "研究室_〇_△_1_0_1.png": "richmenu-261297f9bbe1d4760077fede78165951",
  "研究室_〇_〇_1_1_0.png": "richmenu-c116e9896619786e8f0951e64abb3b13",
  "研究室_〇_〇_1_1_1.png": "richmenu-6c9110ac69cc6552a7a9e9ec2183df17"
};

function getRichMenuId(status, labKey, expKey, hasLabMembers, hasExpMembers, hasCampusMembers) {Add commentMore actions
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
