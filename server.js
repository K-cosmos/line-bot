import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import dotenv from "dotenv";
import { GoogleSpreadsheet } from "google-spreadsheet";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const config = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

// Google Sheets初期化
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
await doc.useServiceAccountAuth({
  client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
});
await doc.loadInfo();
const sheet = doc.sheetsByTitle["Status"];

// LINE webhook受信
app.post("/webhook", middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === "follow" || event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      // スプレッドシートからデータ取得
      await sheet.loadCells("A2:E"); // ステータス管理表の範囲

      const rows = await sheet.getRows();
      const members = rows.map(row => ({
        name: row.Name,
        status: row.Status,
        keyLab: row.LabKey,
        keyExp: row.ExpKey,
        userId: row.UserId,
      }));

      // きおりのユーザー情報取得
      const currentUser = members.find(m => m.userId === userId);

      if (!currentUser) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "ユーザー情報が見つからないよ！",
        });
        return;
      }

      // 在室状況を作成
      const inLab = members.filter(m => m.status === "研究室");
      const inExp = members.filter(m => m.status === "実験室");
      const inCampus = members.filter(m => m.status === "学内");

      const roomStatusMessage = `研究室\n${inLab.map(m => `・${m.name}`).join("\n") || "（誰もいない）"}\n\n` +
                                `実験室\n${inExp.map(m => `・${m.name}`).join("\n") || "（誰もいない）"}\n\n` +
                                `学内\n${inCampus.map(m => `・${m.name}`).join("\n") || "（誰もいない）"}`;

      // リッチメニューの分岐条件
      const richMenuAlias = getRichMenuAlias(
        currentUser.status,
        currentUser.keyLab,
        currentUser.keyExp,
        inLab.length > 0,
        inExp.length > 0,
        inCampus.length > 0
      );

      // ユーザーにリッチメニューをリンク
      await client.linkRichMenuToUser(userId, richMenuAlias);

      // 在室状況のメッセージを送信
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: roomStatusMessage,
      });
    }
  }
  res.send("ok");
});

// リッチメニューエイリアス名を決定する関数
function getRichMenuAlias(status, keyLab, keyExp, hasLab, hasExp, hasCampus) {
  // 在室状況は「1人以上いる:1、誰もいない:0」
  const labStatus = hasLab ? "1" : "0";
  const expStatus = hasExp ? "1" : "0";
  const campusStatus = hasCampus ? "1" : "0";

  // 例: lab_labKey_expKey_labStatus_expStatus_campusStatus
  // 研究室_〇_△_1_0_1 → richmenu_lab_〇_△_1_0_1
  return `richmenu_${status}_${keyLab}_${keyExp}_${labStatus}_${expStatus}_${campusStatus}`;
}

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
