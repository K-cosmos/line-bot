const fs = require('fs');
const { Client } = require('@line/bot-sdk');

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

async function setupRichMenu() {
  const richMenu = await client.createRichMenu({
    size: { width: 1200, height: 405 },
    selected: true,
    name: 'status-richmenu',
    chatBarText: 'メニューを開く',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 400, height: 405 },
        action: { type: 'postback', data: 'open_status_menu' },
      },
      {
        bounds: { x: 400, y: 0, width: 400, height: 405 },
        action: { type: 'postback', data: 'show_key_status' },
      },
      {
        bounds: { x: 800, y: 0, width: 400, height: 405 },
        action: { type: 'postback', data: 'show_all_members' },
      },
    ],
  });

  console.log('RichMenu ID:', richMenu);

  // 画像アップロード
  const imagePath = './richmenu.png'; // あなたの画像のパス（保存済み）
  await client.setRichMenuImage(richMenu, fs.createReadStream(imagePath));

  // 全ユーザーにデフォルト設定
  await client.setDefaultRichMenu(richMenu);
  console.log('リッチメニュー設定完了');
}

setupRichMenu().catch(console.error);
