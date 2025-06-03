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

      if (event.type === "postback") {
        if (!user) continue;
        const data = event.postback.data;

        if (data.startsWith("btn:status")) {
          const allStatuses = ["研究室", "実験室", "学内", "学外"];
          const nextStatuses = allStatuses.filter(s => s !== user.status);
          const index = parseInt(data.slice(-1), 10) - 1;
          if (nextStatuses[index]) user.status = nextStatuses[index];

        } else if (data.startsWith("btn:lab")) {
          const num = parseInt(data.replace("btn:lab", ""), 10);
          if ([1, 2].includes(num)) {
            const options = ["〇", "△", "×"].filter(v => v !== labKey);
            labKey = options[(num - 1) % options.length];
          }
          if ([3, 4].includes(num)) {
            const options = ["〇", "△", "×"].filter(v => v !== expKey);
            expKey = options[(num - 3) % options.length];
          }
          if ([5].includes(num)) {
            labKey = "△";
            expKey = "△";
          }
        } else if (data === "btn:detail") {
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

const richMenuMapping = {
  "学内_×_×_0_0_1": "richmenu-d36967e01144342dfbec53dd9aa69d61",
  "学内_×_〇_0_1_1": "richmenu-600af08a2f96082a4fb76afeb4474421",
  "学内_△_△_0_0_1": "richmenu-eaffb3dbd989088e8148c1d7b80ab471",
  "学内_△_〇_0_1_1": "richmenu-da9910f171a5a6eb567c0a4e5b29fdc8",
  "学内_〇_×_1_0_1": "richmenu-c2c2e3b4a9abe2a34c11b5bad572912b",
  "学内_〇_△_1_0_1": "richmenu-249f962726f4736e050a5faa66b67941",
  "学内_〇_〇_1_1_1": "richmenu-45efe1da3d8ac10cebc762de6ece9638",
  "学外_×_×_0_0_0": "richmenu-87b26f414a8a0d750c821dff46c3ae1c",
  "学外_×_×_0_0_1": "richmenu-31f2c3b28361a29c7464faa78cb6e90b",
  "学外_×_〇_0_1_0": "richmenu-4178964cd63a534a748f35bae2683795",
  "学外_×_〇_0_1_1": "richmenu-5da29a3fade6840af746985691ac79e7",
  "学外_△_△_0_0_0": "richmenu-26fdeb50ac1f38f8ed0af6974a5cc49d",
  "学外_△_〇_0_1_0": "richmenu-f77ed8c1638016534dd4726b71ed29c5",
  "学外_△_〇_0_1_1": "richmenu-ff1ea6eb06bbd4a72e4e208240ae04b6",
  "学外_〇_×_1_0_0": "richmenu-0c5d5c1aa4d0dca199baa3b03a92397f",
  "学外_〇_×_1_0_1": "richmenu-dd54a0b2b4c72d89f4f37739669cc344",
  "学外_〇_△_1_0_0": "richmenu-d10d4b89f519cb2f094180a1664eeffb",
  "学外_〇_△_1_0_1": "richmenu-daeb7873f76a756517ebc581fe3de9d9",
  "学外_〇_〇_1_1_0": "richmenu-9424a713a90da8bb15165469169082ca",
  "学外_〇_〇_1_1_1": "richmenu-39611d821b6c7b127f679386f9385035",
  "実験室_×_〇_0_1_0": "richmenu-1a4d10be6ad69276770bb04944983abf",
  "実験室_×_〇_0_1_1": "richmenu-cee780c2493bab7f9d69191154cb379a",
  "実験室_△_〇_0_1_0": "richmenu-ee52c36e89de7da4f1c8dd624868c6df",
  "実験室_△_〇_0_1_1": "richmenu-da51ec68e89b4ffb6dac5fecaed8eda5",
  "実験室_〇_〇_1_1_0": "richmenu-bc28133521f2b0982acdfdf3dcf77a39",
  "実験室_〇_〇_1_1_1": "richmenu-ca0a5e6dd6005d951530061abf4886cc",
  "研究室_〇_×_1_0_0": "richmenu-53df99bdb0bb0324b407d69ee4f77f54",
  "研究室_〇_×_1_0_1": "richmenu-5e9957eb88b8224082c54469b7b3a840",
  "研究室_〇_△_1_0_0": "richmenu-d5345a481a4652f0ec68b9058efc575b",
  "研究室_〇_△_1_0_1": "richmenu-bfdb9b90910ef521de6c4980f9d4efe5",
  "研究室_〇_〇_1_1_0": "richmenu-ed49ecedd07a9f81e493492d70bed7a6",
  "研究室_〇_〇_1_1_1": "richmenu-8993c7b5f6148328ecd68bc5e53df76c",
};

// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
