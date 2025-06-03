import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import dotenv from "dotenv";
import cron from "node-cron";

dotenv.config();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);
const app = express();
const PORT = process.env.PORT || 3000;

let members = [];
let labKey = "×";
let expKey = "×";

cron.schedule("0 4 * * *", () => {
  members = members.map(m => ({ ...m, status: "学外" }));
  labKey = "×";
  expKey = "×";
});

app.use((req, res, next) => {
  req.path === "/webhook" ? next() : express.json()(req, res, next);
});

app.post("/webhook", middleware(config), async (req, res) => {
  try {
    const events = req.body.events;

    for (const event of events) {
      const userId = event.source.userId;
      let user = members.find(m => m.userId === userId);

      if (event.type === "message" && event.message.type === "text") {
        const name = event.message.text.trim();
        if (!user) {
          user = { name, userId, status: "学外" };
          members.push(user);
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `はじめまして！\n「${name}」として登録したよ！`
          });
        }
      }

      if (event.type === "postback") {
        if (!user) continue;
        const data = event.postback.data;

        if (data.startsWith("btn:status")) {
          console.log(`🔘 ステータス変更 (${user.name})`);
          const allStatuses = ["研究室", "実験室", "学内", "学外"];
          const next = allStatuses.find(s => s !== user.status);
          if (next) user.status = next;

        } else if (data.startsWith("btn:lab")) {
          const num = parseInt(data.replace("btn:lab", ""), 10);
          console.log(`🔘 鍵状態変更 (${num}) (${user.name})`);

          if ([1, 2].includes(num)) labKey = getNextStatus(labKey);
          if ([3, 4].includes(num)) expKey = getNextStatus(expKey);
          if ([5, 6].includes(num)) {
            labKey = getNextStatus(labKey);
            expKey = getNextStatus(expKey);
          }

        } else if (data === "btn:detail") {
          console.log(`🔘 在室状況確認 (${user.name})`);
          const msg = createRoomMessage();
          console.log(`📋 在室:\n${msg}`);
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: msg
          });
        }
      }

      // 共通処理
      updateKeyStatus();

      const richMenuId = getRichMenuId(
        user?.status,
        labKey,
        expKey,
        members.some(m => m.status === "研究室"),
        members.some(m => m.status === "実験室"),
        members.some(m => m.status === "学内")
      );

      if (user && richMenuId) {
        await client.linkRichMenuToUser(user.userId, richMenuId).catch(console.error);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("💥 Webhookエラー:", err);
    res.sendStatus(500);
  }
});

function updateKeyStatus() {
  const inLab = members.some(m => m.status === "研究室");
  const inExp = members.some(m => m.status === "実験室");
  labKey = inLab ? "〇" : "△";
  expKey = inExp ? "〇" : "△";
}

function getNextStatus(current) {
  const states = ["〇", "△", "×"];
  return states[(states.indexOf(current) + 1) % states.length];
}

function createRoomMessage() {
  const groupBy = status => members.filter(m => m.status === status);
  const lab = groupBy("研究室");
  const exp = groupBy("実験室");
  const campus = groupBy("学内");

  let msg = "";
  if (lab.length) msg += `研究室\n${lab.map(m => `・${m.name}`).join("\n")}\n\n`;
  if (exp.length) msg += `実験室\n${exp.map(m => `・${m.name}`).join("\n")}\n\n`;
  if (campus.length) msg += `学内\n${campus.map(m => `・${m.name}`).join("\n")}`;

  return msg.trim() || "誰もいないみたい…";
}

function getRichMenuId(status, lab, exp, inLab, inExp, inCampus) {
  if (!status) return null;
  const filename = `${status}_${lab}_${exp}_${inLab ? 1 : 0}_${inExp ? 1 : 0}_${inCampus ? 1 : 0}.png`;
  return richMenuMapping[filename];
}

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

// サーバー起動
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
