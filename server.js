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

      await sheet.loadCells("A2:E");
      const rows = await sheet.getRows();
      const members = rows.map(row => ({
        name: row.Name,
        status: row.Status,
        keyLab: row.LabKey,
        keyExp: row.ExpKey,
        userId: row.UserId,
        row: row, // 更新用にrowを残す
      }));

      const currentUser = members.find(m => m.userId === userId);
      if (!currentUser) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "ユーザー情報が見つからないよ！",
        });
        return;
      }

      // 在室状況
      const inLab = members.filter(m => m.status === "研究室");
      const inExp = members.filter(m => m.status === "実験室");
      const inCampus = members.filter(m => m.status === "学内");

      // 在室状況による鍵状態の強制変更
      const labKeyStatus = inLab.length > 0 ? "〇" : "△";
      const expKeyStatus = inExp.length > 0 ? "〇" : "△";

      // スプレッドシートの鍵状態を更新
      for (const m of members) {
        // 研究室の鍵
        if (m.keyLab !== labKeyStatus) {
          m.row.LabKey = labKeyStatus;
          await m.row.save();
        }
        // 実験室の鍵
        if (m.keyExp !== expKeyStatus) {
          m.row.ExpKey = expKeyStatus;
          await m.row.save();
        }
      }

      // 在室状況メッセージ
      const roomStatusMessage = `研究室\n${inLab.map(m => `・${m.name}`).join("\n") || "（誰もいない）"}\n\n` +
                                `実験室\n${inExp.map(m => `・${m.name}`).join("\n") || "（誰もいない）"}\n\n` +
                                `学内\n${inCampus.map(m => `・${m.name}`).join("\n") || "（誰もいない）"}`;

      // ユーザーの最新情報を取得し直す（鍵状態反映）
      const updatedUser = members.find(m => m.userId === userId);

      // リッチメニュー決定
      const richMenuAlias = getRichMenuAlias(
        updatedUser.status,
        labKeyStatus,
        expKeyStatus,
        inLab.length > 0,
        inExp.length > 0,
        inCampus.length > 0
      );

      // ユーザーにリッチメニューをリンク
      await client.linkRichMenuToUser(userId, richMenuAlias);

      // 在室状況を返す
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: roomStatusMessage,
      });
    }
  }
  res.send("ok");
});

// リッチメニューエイリアス名を決める関数
function getRichMenuAlias(status, keyLab, keyExp, hasLab, hasExp, hasCampus) {
  const labStatus = hasLab ? "1" : "0";
  const expStatus = hasExp ? "1" : "0";
  const campusStatus = hasCampus ? "1" : "0";
  return `richmenu_${status}_${keyLab}_${keyExp}_${labStatus}_${expStatus}_${campusStatus}`;
}

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
