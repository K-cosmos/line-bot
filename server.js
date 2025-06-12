// server.js

import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import dotenv from "dotenv";
import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);
const app = express();
const PORT = process.env.PORT || 3000;

let labKey = "×";
let expKey = "×";
const DEFAULT_RICHMENU_ID = "richmenu-ea3798e4868613c347c660c9354ee59f";

/** 毎日4時に全員ステータスを「学外」にリセット＆鍵も×に */
cron.schedule("0 4 * * *", async () => {
  await supabase
    .from("members")
    .update({ status: "学外" });
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

      // ✅ Supabaseからユーザー取得
      const { data: user, error } = await supabase
        .from("members")
        .select("*")
        .eq("userId", userId)
        .single();

      let me = user;

      // ✳️ 新規登録
      if (!me && event.type === "message" && event.message.type === "text") {
        const name = event.message.text.trim();
        const { data: newUser } = await supabase
          .from("members")
          .insert([{ name, userId, status: "学外", notice: true }])
          .single();
        me = newUser;
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `はじめまして！\n「${name}」として登録したよ！`,
        });
      }
      if (!me) continue;

      if (event.type === "postback") {
        const data = event.postback.data;

        // ステータス更新用フラグ
        let updatedFields = {};

        switch (data) {
          // 🌏 ロケーション変更
          case "location_lab": updatedFields.status = "研究室"; break;
          case "location_exp": updatedFields.status = "実験室"; break;
          case "location_on":  updatedFields.status = "学内"; break;
          case "location_off": updatedFields.status = "学外"; break;

          // 🏠 手動在室変更
          case "exist_lab":    updatedFields.status = "研究室"; break;
          case "noexist_lab":
            if (me.status === "研究室") {
              updatedFields.status = "学内";
              await supabase
                .from("members")
                .update({ status: "学内" })
                .eq("status", "研究室");
            }
            break;
          case "exist_exp":    updatedFields.status = "実験室"; break;
          case "noexist_exp":
            if (me.status === "実験室") {
              updatedFields.status = "学内";
              await supabase
                .from("members")
                .update({ status: "学内" })
                .eq("status", "実験室");
            }
            break;
          case "exist_on":     updatedFields.status = "学内"; break;
          case "noexist_on":
            if (me.status === "学内") {
              updatedFields.status = "学外";
              await supabase
                .from("members")
                .update({ status: "学外" })
                .eq("status", "学内");
            }
            break;
          case "exist_off":    updatedFields.status = "学外"; break;
          case "noexist_off":  break;

          // 🔔 通知設定
          case "notice_on":  updatedFields.notice = true; break;
          case "notice_off": updatedFields.notice = false; break;

          // 📋 詳細表示
          case "detail": {
            const { data: all } = await supabase.from("members").select("name,status");
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: createRoomMessage(all),
            });
            break;
          }

          // 🔑 鍵ボタン（研究室）
          case "key_lab_〇": updatedFields.status = "研究室"; break;
          case "key_lab_△":
          case "key_lab_×":
            if (me.status === "研究室") {
              updatedFields.status = "学内";
              await supabase
                .from("members")
                .update({ status: "学内" })
                .eq("status", "研究室");
            }
            if (data === "key_lab_×") {
              const { data: all } = await supabase.from("members").select("status");
              const stillInside = all.some(u => u.status !== "学外");
              labKey = stillInside ? "△" : "×";
            }
            break;

          // 🔑 鍵ボタン（実験室）
          case "key_exp_〇": updatedFields.status = "実験室"; break;
          case "key_exp_△":
          case "key_exp_×":
            if (me.status === "実験室") {
              updatedFields.status = "学内";
              await supabase
                .from("members")
                .update({ status: "学内" })
                .eq("status", "実験室");
            }
            if (data === "key_exp_×") {
              const { data: all } = await supabase.from("members").select("status");
              const stillInside = all.some(u => u.status !== "学外");
              expKey = stillInside ? "△" : "×";
            }
            break;

          default:
            break;
        }

        // DBに更新があれば
        if (Object.keys(updatedFields).length > 0) {
          await supabase
            .from("members")
            .update(updatedFields)
            .eq("userId", userId);
          me = { ...me, ...updatedFields };
        }

        // 🔄 鍵自動更新
        await updateKeyStatus();

        // 🔁 リッチメニュー再設定
        const { data: all } = await supabase.from("members").select("status,notice");
        const inLab = all.some(u => u.status === "研究室");
        const inExp = all.some(u => u.status === "実験室");
        const inCampus = all.some(u => u.status === "学内");

        const targetRichMenuId = getRichMenuId(
          me.status,
          labKey,
          expKey,
          inLab,
          inExp,
          inCampus,
          me.notice
        );
        const current = await client.getRichMenuIdOfUser(userId).catch(() => null);
        if (targetRichMenuId && current !== targetRichMenuId) {
          await client.linkRichMenuToUser(userId, targetRichMenuId).catch(console.error);
        }
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    res.sendStatus(500);
  }
});

async function updateKeyStatus() {
  const { data: all } = await supabase.from("members").select("status");
  const inLab = all.some(u => u.status === "研究室");
  const inExp = all.some(u => u.status === "実験室");

  const oldLab = labKey, oldExp = expKey;

  labKey = inLab ? (labKey === "×" || labKey === "△" ? "〇" : labKey)
                 : (labKey === "〇" ? "△" : labKey);

  expKey = inExp ? (expKey === "×" || expExp === "△" ? "〇" : expKey)
                 : (expKey === "〇" ? "△" : expKey);

  if (oldLab === "×" && labKey === "〇") {
    await broadcast("研究室の鍵を取ったよ！", "lab");
  }
  if (oldExp === "×" && expKey === "〇") {
    await broadcast("実験室の鍵を取ったよ！", "exp");
  }
}

function createRoomMessage(all) {
  const groups = { 研究室: [], 実験室: [], 学内: [] };
  all.forEach(u => {
    if (groups[u.status]) groups[u.status].push(u.name);
  });
  let msg = "";
  if (groups["研究室"].length) msg += `研究室\n${groups["研究室"].map(n => `・${n}`).join("\n")}\n\n`;
  if (groups["実験室"].length) msg += `実験室\n${groups["実験室"].map(n => `・${n}`).join("\n")}\n\n`;
  if (groups["学内"].length) msg += `学内\n${groups["学内"].map(n => `・${n}`).join("\n")}`;
  return msg.trim() || "誰もいないみたい…";
}

async function broadcast(msg, room) {
  const { data: users } = await supabase
    .from("members")
    .select("userId")
    .eq("notice", true);
  for (const u of users) {
    await client.pushMessage(u.userId, { type: "text", text: msg }).catch(console.error);
  }
}

function getRichMenuId(status, lab, exp, inLab, inExp, inCampus, notice) {
  const filename = `${status}_${inLab ? 1 : 0}_${inExp ? 1 : 0}_${inCampus ? 1 : 0}_${lab}_${exp}_${notice ? "on" : "off"}`;
  return richMenuMapping[filename];
}

const richMenuMapping = {
  // ...そのままリッチメニューIDをマッピングしてね！
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

app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
