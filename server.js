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
  "学内_×_×_0_0_1": "richmenu-3956f6ab34466a234f2b0e11319cfdc2",
  "学内_×_〇_0_1_1": "richmenu-8f6a2ababc85062d34839ae6706107d8",
  "学内_△_△_0_0_1": "richmenu-8b9640e1b9243b0e992bbf2b2986bfc6",
  "学内_△_〇_0_1_1": "richmenu-c526a60bc5261201a2716681099d718e",
  "学内_〇_×_1_0_1": "richmenu-54c7e1c8a65a7f1aaaddfa87da741081",
  "学内_〇_△_1_0_1": "richmenu-38cbff7ce7c1f0045bb4ed83b192c130",
  "学内_〇_〇_1_1_1": "richmenu-9a95b1266e83367e0dedbf96d46dc815",
  "学外_×_×_0_0_0": "richmenu-c00b124a08e587667dd3731c593d5cbb",
  "学外_×_×_0_0_1": "richmenu-24edd0daf2f646982a4cce684457940a",
  "学外_×_〇_0_1_0": "richmenu-abed3cd72d398c7e1a1de09844fd54cd",
  "学外_×_〇_0_1_1": "richmenu-86d92a84cac36e06dc163b79db2e201e",
  "学外_△_△_0_0_0": "richmenu-07fd65f69a974979a3d59bd2c766cfc7",
  "学外_△_〇_0_1_0": "richmenu-79877f87f67e066fb7b1fc2865e02fbf",
  "学外_△_〇_0_1_1": "richmenu-a54c3e010ae3432ab298331bfd662666",
  "学外_〇_×_1_0_0": "richmenu-a7f145eb18d42f02367a647b9590b766",
  "学外_〇_×_1_0_1": "richmenu-20535ba195589ea3a64abd4a5aeb666a",
  "学外_〇_△_1_0_0": "richmenu-bf31e34ee01831bca4edcc1c9976364e",
  "学外_〇_△_1_0_1": "richmenu-3637469fd0c04f7dd6da838fa8fe3abf",
  "学外_〇_〇_1_1_0": "richmenu-97c530d9053bcb734d424d185288b543",
  "学外_〇_〇_1_1_1": "richmenu-d81dca0e667200fd6315988320bd249a",
  "実験室_×_〇_0_1_0": "richmenu-a290b40294541ebb44fd83baf97e42a9",
  "実験室_×_〇_0_1_1": "richmenu-b2a75df1fedd99d7b49aefbcdd0f40a0",
  "実験室_△_〇_0_1_0": "richmenu-f331687455f8f3cf6ea92416e868f5f5",
  "実験室_△_〇_0_1_1": "richmenu-a541d53c8ae786192df154fa925b5f3d",
  "実験室_〇_〇_1_1_0": "richmenu-bee873de6214261a0a505f4055cc5fa4",
  "実験室_〇_〇_1_1_1": "richmenu-b71fac52870c97fce8489fd81aba51a0",
  "研究室_〇_×_1_0_0": "richmenu-fee14fdb936de68bb1869f1750c7bb27",
  "研究室_〇_×_1_0_1": "richmenu-3ca8db30b3644b2b07b75947deb3f2f8",
  "研究室_〇_△_1_0_0": "richmenu-df4cbb36e9e1eb301ca414c904455ccf",
  "研究室_〇_△_1_0_1": "richmenu-b3771a119f43fc4dd9e8d00293e750f1",
  "研究室_〇_〇_1_1_0": "richmenu-fad2096419f2f59afbc66d350e9986cf",
  "研究室_〇_〇_1_1_1": "richmenu-21ad68d95c5eddaa6667f7b20e18e82b",
};

// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
