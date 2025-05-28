import fs from "fs";
import path from "path";
import line from "@line/bot-sdk";

const client = new line.Client({
  channelAccessToken: process.env.LINE_ACCESS_TOKEN
});

async function createRichMenu() {
  const richMenu = {
    size: {
      width: 2500,
      height: 1686
    },
    selected: true,
    name: "研究室Botメニュー",
    chatBarText: "メニューを開く",
    areas: [
      { bounds: { x: 0, y: 1280, width: 833, height: 128 }, action: { type: "postback", data: "btn:status1" } },
      { bounds: { x: 0, y: 1408, width: 833, height: 128 }, action: { type: "postback", data: "btn:status2" } },
      { bounds: { x: 0, y: 1536, width: 833, height: 128 }, action: { type: "postback", data: "btn:status3" } },
      { bounds: { x: 833, y: 1280, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab1" } },
      { bounds: { x: 833, y: 1408, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab2" } },
      { bounds: { x: 833, y: 1536, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab3" } },
      { bounds: { x: 1666, y: 1280, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab4" } },
      { bounds: { x: 1666, y: 1408, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab5" } },
      { bounds: { x: 1666, y: 1536, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab6" } },
      { bounds: { x: 1666, y: 1664, width: 833, height: 128 }, action: { type: "postback", data: "btn:detail" } }
    ]
  };

  const richMenuId = await client.createRichMenu(richMenu);
  console.log("リッチメニュー作成完了！ID:", richMenuId);

  const imagePath = path.resolve("./richmenu.png");
  await client.setRichMenuImage(richMenuId, fs.createReadStream(imagePath));
  console.log("画像アップロード完了！");
}

createRichMenu().catch(console.error);
