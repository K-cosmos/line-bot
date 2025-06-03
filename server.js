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

const DEFAULT_RICHMENU_ID = "richmenu-ea3798e4868613c347c660c9354ee59f";

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

      // 🎯 Postback処理
      if (event.type === "postback") {
        if (!user) continue;
        const data = event.postback.data;
      
        if (data.startsWith("status")) {
          const allStatuses = ["研究室", "実験室", "学内", "学外"];
          const otherStatuses = allStatuses.filter(s => s !== user.status);
          const index = parseInt(data.replace("status", ""), 10) - 1;
          user.status = otherStatuses[index] || user.status;
      
        } else if (data.startsWith("key")) {
          const num = parseInt(data.replace("key", ""), 10);
          if (num === 1 || num === 2) {
            labKey = getNextStatus(labKey);
          } else if (num === 3 || num === 4) {
            expKey = getNextStatus(expKey);
          } else if (num === 5 || num === 6) {
            labKey = getNextStatus(labKey);
            expKey = getNextStatus(expKey);
          }
      
        } else if (data === "detail") {
          const msg = createRoomMessage();
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: msg
          });
        }
      }

      updateKeyStatus();

      const targetRichMenuId = user
        ? getRichMenuId(
            user.status,
            labKey,
            expKey,
            members.some(m => m.status === "研究室"),
            members.some(m => m.status === "実験室"),
            members.some(m => m.status === "学内")
          )
        : DEFAULT_RICHMENU_ID;

      const currentRichMenu = await client.getRichMenuIdOfUser(userId).catch(() => null);
      if (targetRichMenuId && currentRichMenu !== targetRichMenuId) {
        await client.linkRichMenuToUser(userId, targetRichMenuId).catch(console.error);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("\uD83D\uDCA5 Webhookエラー:", err);
    res.sendStatus(500);
  }
});

function updateKeyStatus() {
  const inLab = members.some(m => m.status === "研究室");
  const inExp = members.some(m => m.status === "実験室");
  labKey = inLab ? "〇" : "△";
  expKey = inExp ? "〇" : "△";
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
  const filename = `${status}_${lab}_${exp}_${inLab ? 1 : 0}_${inExp ? 1 : 0}_${inCampus ? 1 : 0}`;
  console.log(filename)
  return richMenuMapping[filename];
}

// 鍵の状態を〇→×→△→〇の順に切り替える関数
function getNextStatus(current) {
  if (current === "〇") return "×";
  if (current === "×") return "△";
  return "〇";
}

const richMenuMapping = {
  "学内_×_×_0_0_1": "richmenu-bab5a02a2c6a790b55ef4329a1666fd7",
  "学内_×_〇_0_1_1": "richmenu-8ee4bf347c26c250a5a922a1bd624d90",
  "学内_△_△_0_0_1": "richmenu-7e552506bd080277a3c992bb2f733c9b",
  "学内_△_〇_0_1_1": "richmenu-069ff8e979d30f152799e57a8451cf38",
  "学内_〇_×_1_0_1": "richmenu-230946e672a99bd9a2b20e7b0d2bccbb",
  "学内_〇_△_1_0_1": "richmenu-9d2ce3b6d7c56215cfcd38faef1705a8",
  "学内_〇_〇_1_1_1": "richmenu-d88895dd50c4f99c07084d4940a694b5",
  "学外_×_×_0_0_0": "richmenu-b13d531ccb0048aadb744afacb7da2b0",
  "学外_×_×_0_0_1": "richmenu-2e665e5879e2e9c468ec87088d81a9d5",
  "学外_×_〇_0_1_0": "richmenu-49f2731b78bb1bef12eb67e985c0ab2b",
  "学外_×_〇_0_1_1": "richmenu-2e9177949b94861a8545d1b7154bfc0a",
  "学外_△_△_0_0_0": "richmenu-e0f93527af83349e79383356c1c8d994",
  "学外_△_〇_0_1_0": "richmenu-18f3b31ade5ea5c87245482b68be19c9",
  "学外_△_〇_0_1_1": "richmenu-c69022f1da787f4a51b19eabb7deebf3",
  "学外_〇_×_1_0_0": "richmenu-c02377b13518a651b48cb8b7f52c501b",
  "学外_〇_×_1_0_1": "richmenu-ceb622771a1dd8f24554623d6157bc9b",
  "学外_〇_△_1_0_0": "richmenu-d7b1c20db563435ffa96632dbcc0e366",
  "学外_〇_△_1_0_1": "richmenu-be614f3c60fbb0648b11b42254f92d35",
  "学外_〇_〇_1_1_0": "richmenu-a681e214904cb0b1b8a8c017137ddf33",
  "学外_〇_〇_1_1_1": "richmenu-b69d37a00cc52df764059ef406651b95",
  "実験室_×_〇_0_1_0": "richmenu-2308ff334e84a40f222e02bbf3877db9",
  "実験室_×_〇_0_1_1": "richmenu-1b7f64b1be3f274b84157c7a84ba9fba",
  "実験室_△_〇_0_1_0": "richmenu-ed1685534b72ff455eef58eca0edcffb",
  "実験室_△_〇_0_1_1": "richmenu-dbdf75ce81f20b7bf60de3e1df108790",
  "実験室_〇_〇_1_1_0": "richmenu-bce91c73685fedd3616997e9a119cb8d",
  "実験室_〇_〇_1_1_1": "richmenu-9c9943534b31f847daf54f2f2289a4bf",
  "研究室_〇_×_1_0_0": "richmenu-fa027d186921875dd31b8fc1fc7a9443",
  "研究室_〇_×_1_0_1": "richmenu-84e4ffe9eec9bbb11adb46b9b446f05b",
  "研究室_〇_△_1_0_0": "richmenu-465f33c1762592b5a6c7b66d1c68e3c5",
  "研究室_〇_△_1_0_1": "richmenu-f4abc4c4dc93ac6a7634424d3f7c7fc6",
  "研究室_〇_〇_1_1_0": "richmenu-d7043d89c69d0759342dff7992dd0d0f",
  "研究室_〇_〇_1_1_1": "richmenu-7ea73be65c4c0b549a9b54d94fa0ddf2",
};

// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
