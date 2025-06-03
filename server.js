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
  "学内_×_×_0_0_1": "richmenu-15ce30a7ecc7bf800c4fca450ce83084",
  "学内_×_〇_0_1_1": "richmenu-8d962f3efab91d7b4bec76c2e9d958fe",
  "学内_△_△_0_0_1": "richmenu-f944312f4eaa39ec1288fbe12157cd9e",
  "学内_△_〇_0_1_1": "richmenu-7e6b9b4f574bcf0625dd022d2ce091b3",
  "学内_〇_×_1_0_1": "richmenu-1d21ea6116ae8f26f31805e235c7173c",
  "学内_〇_△_1_0_1": "richmenu-e7c87bcdabec58de11d930452de55698",
  "学内_〇_〇_1_1_1": "richmenu-ea6843efbfee3a4d536d73c815fc9001",
  "学外_×_×_0_0_0": "richmenu-7c3c3027a380e4c30569277e33c586fa",
  "学外_×_×_0_0_1": "richmenu-f4f32d5bd47351da92ae2e02c8ed2901",
  "学外_×_〇_0_1_0": "richmenu-fadd0444cffa165ad766a288dc41423e",
  "学外_×_〇_0_1_1": "richmenu-a94dec6eb3a4f83cbc5b3af0e90dd401",
  "学外_△_△_0_0_0": "richmenu-c06816dfe745840dfaddd46fd4fffed6",
  "学外_△_〇_0_1_0": "richmenu-7713a488de7b5121f5ba3c7db7ce71ea",
  "学外_△_〇_0_1_1": "richmenu-0474580446db580e6f5bb5a0bf1fda62",
  "学外_〇_×_1_0_0": "richmenu-042c2377f915f5068f6d60e6163d0856",
  "学外_〇_×_1_0_1": "richmenu-320950096fa668d7e6ba039ef9f40961",
  "学外_〇_△_1_0_0": "richmenu-cd55258f18e50f41f1509af9cf962b6f",
  "学外_〇_△_1_0_1": "richmenu-f04ab53f2e1f7151db49f48fde2c73d3",
  "学外_〇_〇_1_1_0": "richmenu-3b6e636d69fa078e1c42ab642724ae2f",
  "学外_〇_〇_1_1_1": "richmenu-9100bfa7f6f335ce5a8155cfb43aff6b",
  "実験室_×_〇_0_1_0": "richmenu-e38c41763db4f4de300ada08e77708dc",
  "実験室_×_〇_0_1_1": "richmenu-1f6cbb5e2c126f443d6198e5ad5fd047",
  "実験室_△_〇_0_1_0": "richmenu-ad7a90953ba7eab8519920a0400d4aa1",
  "実験室_△_〇_0_1_1": "richmenu-91561b9bc0ec826a6dbc4d8eda36eeb9",
  "実験室_〇_〇_1_1_0": "richmenu-f109c212001220725c28768e51903e52",
  "実験室_〇_〇_1_1_1": "richmenu-694502a138b6eb2dbcb13e294e2ac635",
  "研究室_〇_×_1_0_0": "richmenu-dc03de43e7dc2587878d7416cd2fdff3",
  "研究室_〇_×_1_0_1": "richmenu-18ac79a10bd2555102151ed9c63d10be",
  "研究室_〇_△_1_0_0": "richmenu-4cafa0c7eaea73f70e33eaf2645e2243",
  "研究室_〇_△_1_0_1": "richmenu-c916fd9ecbf0e55b0d2b1d5d319f5028",
  "研究室_〇_〇_1_1_0": "richmenu-5cecd6310f5c63799dbaf056a0ecd0fa",
  "研究室_〇_〇_1_1_1": "richmenu-4c087237cdf1ef9ed7879ba63d45a183",
};

// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
