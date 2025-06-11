// server.js

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

// 毎日4時にステータスと鍵状況をリセット
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
          user = { name, userId, status: "学外", notice: true };
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

        switch (data) {
          // 📍ロケーション変更
          case "location_lab":
            user.status = "研究室";
            break;
          case "location_exp":
            user.status = "実験室";
            break;
          case "location_on":
            user.status = "学内";
            break;
          case "location_off":
            user.status = "学外";
            break;

          // 🏠在室ステータス変更（手動）
          case "exist_lab":
            user.status = "研究室";
            break;
          case "noexist_lab":
            if (user.status === "研究室") {
              user.status = "学内";
              members.forEach(m => {
                if (m.status === "研究室") m.status = "学内";
              });
            }
            break;
          case "exist_exp":
            user.status = "実験室";
            break;
          case "noexist_exp":
            if (user.status === "実験室") {
              user.status = "学内";
              members.forEach(m => {
                if (m.status === "実験室") m.status = "学内";
              });
            }
            break;
          case "exist_on":
            user.status = "学内";
            break;
          case "noexist_on":
            if (user.status === "学内") {
              user.status = "学外";
              members.forEach(m => {
                if (m.status === "学内") m.status = "学外";
              });
            }
            break;
          case "exist_off":
            user.status = "学外";
            break;
          case "noexist_off":
            break;

          // 🔔通知設定
          case "notice_on":
            user.notice = true;
            break;
          case "notice_off":
            user.notice = false;
            break;

          // 📋詳細表示
          case "detail": {
            const msg = createRoomMessage();
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: msg
            });
            break;
          }

          // 🔑鍵ボタン（研究室）
          case "key_lab_〇":
            user.status = "研究室";
            break;
          case "key_lab_△":
          case "key_lab_×":
            if (user.status === "研究室") {
              user.status = "学内";
              members.forEach(m => {
                if (m.status === "研究室") m.status = "学内";
              });
            }
            if (data === "key_lab_×") {
              const anyoneInside = members.some(m =>
                m.userId !== userId &&
                (m.status === "研究室" || m.status === "学内" || m.status === "実験室")
              );
              labKey = anyoneInside ? "△" : "×";
            }
            break;

          // 🔑鍵ボタン（実験室）
          case "key_exp_〇":
            user.status = "実験室";
            break;
          case "key_exp_△":
          case "key_exp_×":
            if (user.status === "実験室") {
              user.status = "学内";
              members.forEach(m => {
                if (m.status === "実験室") m.status = "学内";
              });
            }
            if (data === "key_exp_×") {
              const anyoneInside = members.some(m =>
                m.userId !== userId &&
                (m.status === "実験室" || m.status === "学内" || m.status === "研究室")
              );
              expKey = anyoneInside ? "△" : "×";
            }
            break;

          default:
            break;
        }

        // postbackが来たときのみ：鍵処理とリッチメニュー更新
        await updateKeyStatus();

        const targetRichMenuId = getRichMenuId(
          user.status,
          labKey,
          expKey,
          members.some(m => m.status === "研究室"),
          members.some(m => m.status === "実験室"),
          members.some(m => m.status === "学内"),
          user.notice
        );

        const currentRichMenu = await client.getRichMenuIdOfUser(userId).catch(() => null);
        if (targetRichMenuId && currentRichMenu !== targetRichMenuId) {
          await client.linkRichMenuToUser(userId, targetRichMenuId).catch(console.error);
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("🔥 Webhookエラー:", err);
    res.sendStatus(500);
  }
});

async function updateKeyStatus() {
  const inLab = members.some(m => m.status === "研究室");
  const inExp = members.some(m => m.status === "実験室");

  const oldLabKey = labKey;
  const oldExpKey = expKey;

  if (inLab && (labKey === "×" || labKey === "△")) labKey = "〇";
  else if (!inLab && labKey === "〇") labKey = "△";

  if (inExp && (expKey === "×" || expKey === "△")) expKey = "〇";
  else if (!inExp && expKey === "〇") expKey = "△";

  if (labKey !== oldLabKey && oldLabKey === "×" && labKey === "〇") {
    await broadcast("研究室の鍵を借りたよ！", "lab");
  }

  if (expKey !== oldExpKey && oldExpKey === "×" && expKey === "〇") {
    await broadcast("実験室の鍵を借りたよ！", "exp");
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

function getRichMenuId(status, lab, exp, inLab, inExp, inCampus, notice) {
  if (!status) return null;
  const filename = `${status}_${inLab ? 1 : 0}_${inExp ? 1 : 0}_${inCampus ? 1 : 0}_${lab}_${exp}_${notice ? "on" : "off"}`;
  console.log(filename);
  return richMenuMapping[filename];
}

async function broadcast(message, room) {
  for (const m of members) {
    if (m.notice) {
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
}

const richMenuMapping = {
  // ここに新しいリッチメニューのマッピングを追加してください
  "学内_0_0_1_×_×_off": "richmenu-20da175cbfc9d116cce4266ede84e914",
  "学内_0_0_1_×_×_on": "richmenu-8514c2d8e1802d91f7305649fbe32004",
  "学内_0_0_1_×_△_off": "richmenu-1afe35a40d284269ad3800adbf1be129",
  "学内_0_0_1_×_△_on": "richmenu-b62cb7b521f1798b7136eeaadfee856f",
  "学内_0_0_1_△_×_off": "richmenu-c6cc0f3feae587b3a9217218e44a0758",
  "学内_0_0_1_△_×_on": "richmenu-67c4bc7e155953b37f65ef0612e9faa9",
  "学内_0_0_1_△_△_off": "richmenu-f3f438df3cc1340d5d32e3c102ed3a10",
  "学内_0_0_1_△_△_on": "richmenu-6bf3a6cc90f93b537e137883fc610f64",
  "学内_0_1_1_×_〇_off": "richmenu-1c6219deefb2935329090ad8fb025956",
  "学内_0_1_1_×_〇_on": "richmenu-0e29adb11f5c132e346bfbc83516bac9",
  "学内_0_1_1_△_〇_off": "richmenu-3f6b7b3680238aaf41b0bb9e56d8edb0",
  "学内_0_1_1_△_〇_on": "richmenu-b171ad611e3089878b7e683e9852dffc",
  "学内_1_0_1_〇_×_off": "richmenu-2b83f9c8f4a28af049bb23f79bc29f5c",
  "学内_1_0_1_〇_×_on": "richmenu-64e09da88ad4b16efcd8389e569ca8ce",
  "学内_1_0_1_〇_△_off": "richmenu-32886bbd79a6e86fdb211f103308c7e0",
  "学内_1_0_1_〇_△_on": "richmenu-4098e26001bb8c41b41cd9b4c34eb240",
  "学内_1_1_1_〇_〇_off": "richmenu-7c00476c52d8a80da77d8024e1c94407",
  "学内_1_1_1_〇_〇_on": "richmenu-3e69037c3768a4e857b483439f5f14c3",
  "学外_0_0_0_×_×_off": "richmenu-7a5c81cb05f003c566aa7dc86011b679",
  "学外_0_0_0_×_×_on": "richmenu-173ae13f9be4b3e5c5bc37850763e5d9",
  "学外_0_0_1_×_×_off": "richmenu-a53045e936c9e690f6bd3c0b59abdce0",
  "学外_0_0_1_×_×_on": "richmenu-57a8557c58e8e06b175ca5e97a1a8f95",
  "学外_0_0_1_×_△_off": "richmenu-e28322719c44b19724bbdfe9c21768d4",
  "学外_0_0_1_×_△_on": "richmenu-1ebf108aaf807f652c13325d6b645b38",
  "学外_0_0_1_△_×_off": "richmenu-e827b96c1541e83180df89815e6b5a20",
  "学外_0_0_1_△_×_on": "richmenu-a20df2a42f87e29b8353b71d1dfe1189",
  "学外_0_0_1_△_△_off": "richmenu-36fa0a3763b71dde2729afc6bd9d1a72",
  "学外_0_0_1_△_△_on": "richmenu-f658b6f7d2bcd36d3d74526991bdc22d",
  "学外_0_1_0_×_〇_off": "richmenu-808851070090034375d783ea82677757",
  "学外_0_1_0_×_〇_on": "richmenu-36d751d6ed1db4a8eec4fa3e43cba467",
  "学外_0_1_0_△_〇_off": "richmenu-4bc263290e572e9167cb2acf5896fad8",
  "学外_0_1_0_△_〇_on": "richmenu-738650684734452f7b3ac581b061c61f",
  "学外_0_1_1_×_〇_off": "richmenu-5a3e779a1bf23fd32db656ab382168e2",
  "学外_0_1_1_×_〇_on": "richmenu-cc52a1749dd04933b83c146c4021cb4a",
  "学外_0_1_1_△_〇_off": "richmenu-c5a4a63fe4dd75ec8091c9fad8820c1e",
  "学外_0_1_1_△_〇_on": "richmenu-5f7834efec3a56bbc1ac79a114a723d8",
  "学外_1_0_0_〇_×_off": "richmenu-90649a1dbbc203a0bf529b2dc252969f",
  "学外_1_0_0_〇_×_on": "richmenu-022258e7d1e3ae3a751ecc7a4afecebf",
  "学外_1_0_0_〇_△_off": "richmenu-fdbf65739828b27356623d69b88326df",
  "学外_1_0_0_〇_△_on": "richmenu-5a3f7453631672d994839264141f116b",
  "学外_1_0_1_〇_×_off": "richmenu-e33c0a198ce062b2fd0a5099365da644",
  "学外_1_0_1_〇_×_on": "richmenu-92eef384599e2fbfc94111753add6ead",
  "学外_1_0_1_〇_△_off": "richmenu-6a910ced0df56d344f1b2e665fe622ae",
  "学外_1_0_1_〇_△_on": "richmenu-b63e4d872e1ea77e93ad511af4711a9e",
  "学外_1_1_0_〇_〇_off": "richmenu-726db7ccf2e3ef479356a4c84f154e36",
  "学外_1_1_0_〇_〇_on": "richmenu-6a3a3533b12cea02db1c4335739e5a3f",
  "学外_1_1_1_〇_〇_off": "richmenu-c1d2f4b7da1633cde7cfe73804d5965d",
  "学外_1_1_1_〇_〇_on": "richmenu-89e8417606e3472cfca02c705e64eddb",
  "実験室_0_1_0_×_〇_off": "richmenu-fe125bbb1b9d556c10b211332227fb31",
  "実験室_0_1_0_×_〇_on": "richmenu-81372045e60ce766b9b9321a5ab73c32",
  "実験室_0_1_0_△_〇_off": "richmenu-68060cf1abf320aeb3d5c7fec491588e",
  "実験室_0_1_0_△_〇_on": "richmenu-ecccc650e93123309a1a236c93312c5f",
  "実験室_0_1_1_×_〇_off": "richmenu-805ab62771defaa586894f52f8073bf2",
  "実験室_0_1_1_×_〇_on": "richmenu-4f8c3c0d3488487ca77b336811bdd668",
  "実験室_0_1_1_△_〇_off": "richmenu-28c1cde5482d9609d3964fd816cab8b3",
  "実験室_0_1_1_△_〇_on": "richmenu-c4b7035b0097f27611cefe9160cdeee7",
  "実験室_1_1_0_〇_〇_off": "richmenu-13e4899440bfca63df664f99cea480c2",
  "実験室_1_1_0_〇_〇_on": "richmenu-5a2f855291af6001893936f842ce0234",
  "実験室_1_1_1_〇_〇_off": "richmenu-647f45aa3d725dced0063f6b6b1fb495",
  "実験室_1_1_1_〇_〇_on": "richmenu-f69868216f74d25d2e25f24c2a32b25b",
  "研究室_1_0_0_〇_×_off": "richmenu-a274901b17b47dc94f1aa73d3b733936",
  "研究室_1_0_0_〇_×_on": "richmenu-ead6cea37a4eeacf030f87974a9cd467",
  "研究室_1_0_0_〇_△_off": "richmenu-85142c7f499f90f4ea2e7b79265feb35",
  "研究室_1_0_0_〇_△_on": "richmenu-a21900cbd2327b8dba85d06c9b778a87",
  "研究室_1_0_1_〇_×_off": "richmenu-a6a84fb6960129ace01e9e77147f8118",
  "研究室_1_0_1_〇_×_on": "richmenu-4e74dfca57dc1a4b71ea30e4c37920b6",
  "研究室_1_0_1_〇_△_off": "richmenu-4e4790aa47116660af6c12d9334387cc",
  "研究室_1_0_1_〇_△_on": "richmenu-6467a05b7b7d4f7be1294b8ebab678a4",
  "研究室_1_1_0_〇_〇_off": "richmenu-87106076637971cdbcee6624d9c082cb",
  "研究室_1_1_0_〇_〇_on": "richmenu-6eacb9878e55b8095a51bd2a9ad8ebb2",
  "研究室_1_1_1_〇_〇_off": "richmenu-eaab91e6fc1edd7336821782a0575bbf",
  "研究室_1_1_1_〇_〇_on": "richmenu-2616ace51e4c79712fe4b0b0fb03c448",
};

// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
