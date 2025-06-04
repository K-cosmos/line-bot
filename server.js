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
  let oldLabKey = labKey;
  let oldExpKey = expKey;

  if (num === 1 || num === 2) {
    labKey = getNextStatus(labKey);
  } else if (num === 3 || num === 4) {
    expKey = getNextStatus(expKey);
  } else if (num === 5 || num === 6) {
    labKey = getNextStatus(labKey);
    expKey = getNextStatus(expKey);
  }

  // ボタンによる変更で通知（〇と×だけ）
  if (labKey !== oldLabKey && (labKey === "〇" || labKey === "×")) {
    await broadcast(`${labKey === "〇" ? "🔓" : "🔒"} 研究室: ${labKey}`);
  }
  if (expKey !== oldExpKey && (expKey === "〇" || expKey === "×")) {
    await broadcast(`${expKey === "〇" ? "🔓" : "🔒"} 実験室: ${expKey}`);
  }
}
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

async function updateKeyStatus() {
  const inLab = members.some(m => m.status === "研究室");
  const inExp = members.some(m => m.status === "実験室");

  const oldLabKey = labKey;
  const oldExpKey = expKey;

  // 強制変更（誰か入った・全員出た）
  if (inLab && (labKey === "×" || labKey === "△")) labKey = "〇";
  else if (!inLab && labKey === "〇") labKey = "△";

  if (inExp && (expKey === "×" || expKey === "△")) expKey = "〇";
  else if (!inExp && expKey === "〇") expKey = "△";

  // 通知（〇か×に変わったときだけ）
  if (labKey !== oldLabKey && (labKey === "〇" || labKey === "×")) {
    await broadcast(`${labKey === "〇" ? "🔓" : "🔒"} 研究室: ${labKey}`);
  }

  if (expKey !== oldExpKey && (expKey === "〇" || expKey === "×")) {
    await broadcast(`${expKey === "〇" ? "🔓" : "🔒"} 実験室: ${expKey}`);
  }
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

async function broadcast(message) {
  for (const m of members) {
    try {
      await client.pushMessage(m.userId, {
        type: "text",
        text: message
      });
    } catch (err) {
      console.error(`📤 ${m.name}への送信失敗:`, err);
    }
  }
}

function getNextStatus(current) {
  const order = ["×", "△", "〇"];
  const index = order.indexOf(current);
  return order[(index + 1) % order.length];
}

const richMenuMapping = {
  "学内_×_×_0_0_1": "richmenu-d061b0c85439572436b1e3e01904fc28",
  "学内_×_〇_0_1_1": "richmenu-ca3cd610e64423345f44f3d01e9329e4",
  "学内_△_△_0_0_1": "richmenu-4d1e17e58e52ee449fcbf0018ba07cd1",
  "学内_△_〇_0_1_1": "richmenu-a61edc34aa5bba96f3e7554b017192d2",
  "学内_〇_×_1_0_1": "richmenu-ac82c0f2ddcff48af18defa6fb133bee",
  "学内_〇_△_1_0_1": "richmenu-2ccc0b99549294d5878cf33d3fe2cdd0",
  "学内_〇_〇_1_1_1": "richmenu-7b5e54f8dc42767a8332b50065712e65",
  "学外_×_×_0_0_0": "richmenu-946eb2ec0f05805e5f4f6cf2546a284c",
  "学外_×_×_0_0_1": "richmenu-e92fa62c01bf9aed75b4bd7d41c6f501",
  "学外_×_〇_0_1_0": "richmenu-94584c7a94cabb8b008473a30030c482",
  "学外_×_〇_0_1_1": "richmenu-5a8d0d6b44e63960d5455977191113c2",
  "学外_△_△_0_0_0": "richmenu-de59106ace8bab006e1f3cb840dc5c22",
  "学外_△_〇_0_1_0": "richmenu-494aea6b42ccf09fb9ba63e73889d376",
  "学外_△_〇_0_1_1": "richmenu-cb6d447dd92aacadeaf542b53c5c0a3f",
  "学外_〇_×_1_0_0": "richmenu-ef2104882e8990804449d01302ae42e6",
  "学外_〇_×_1_0_1": "richmenu-a475b568c6f73b7508b8acb027ad0454",
  "学外_〇_△_1_0_0": "richmenu-0aef52c9bb13ed5221d39f11b75e356d",
  "学外_〇_△_1_0_1": "richmenu-101711da79759bdbc9463e602f4ec6a2",
  "学外_〇_〇_1_1_0": "richmenu-5fde474bf1f26261d751f7b582553e67",
  "学外_〇_〇_1_1_1": "richmenu-f8c29dd2f91033e5fb802bbd3ad7aead",
  "実験室_×_〇_0_1_0": "richmenu-1640776584aeb57e309bc1c69b0f74c5",
  "実験室_×_〇_0_1_1": "richmenu-eaad9a08fd66d28f420f2f852caa80a1",
  "実験室_△_〇_0_1_0": "richmenu-c1fdcee232365a0c3533b9a363a51892",
  "実験室_△_〇_0_1_1": "richmenu-9bb81e9175b1ad8544065a048d689c5e",
  "実験室_〇_〇_1_1_0": "richmenu-021e315001e8621738938a19e0f056a1",
  "実験室_〇_〇_1_1_1": "richmenu-db06d867b03f0d1a55aeb2373765347a",
  "研究室_〇_×_1_0_0": "richmenu-aaa702294f84faa79181a92f4b5f854e",
  "研究室_〇_×_1_0_1": "richmenu-2bf97002516c245e80935f7227275627",
  "研究室_〇_△_1_0_0": "richmenu-d4d1ed39e2e5e09a8cecd62223b5c9f6",
  "研究室_〇_△_1_0_1": "richmenu-fdb559a4329d4be195dd41c63326db50",
  "研究室_〇_〇_1_1_0": "richmenu-97d9f830537c1f74f1a117f6f3fb69df",
  "研究室_〇_〇_1_1_1": "richmenu-17993cc6c670e9fb992fb67f5c19eb78",
};

// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
