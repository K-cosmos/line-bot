const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const LINE_API = 'https://api.line.me/v2/bot';
const headers = {
    Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
};

async function createRichMenu() {
    // ① リッチメニューの構成
    const richMenuData = {
        size: { width: 2500, height: 843 },
        selected: true,
        name: 'main-menu',
        chatBarText: 'メニュー',
        areas: [
            {
                bounds: { x: 0, y: 0, width: 833, height: 843 },
                action: { type: 'postback', data: 'open_status_menu' }
            },
            {
                bounds: { x: 833, y: 0, width: 834, height: 843 },
                action: { type: 'postback', data: 'show_key_status' }
            },
            {
                bounds: { x: 1667, y: 0, width: 833, height: 843 },
                action: { type: 'postback', data: 'show_all_members' }
            }
        ]
    };

    // ② リッチメニュー作成
    const res = await axios.post(`${LINE_API}/richmenu`, richMenuData, { headers });
    const richMenuId = res.data.richMenuId;
    console.log('✅ RichMenu作成成功:', richMenuId);

    // ③ 画像をアップロード
    const imageBuffer = fs.readFileSync('richmenu.png');
    await axios.post(
        `${LINE_API}/richmenu/${richMenuId}/content`,
        imageBuffer,
        {
            headers: {
                Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                'Content-Type': 'image/png'
            }
        }
    );
    console.log('✅ 画像アップロード成功');

    // ④ 全ユーザーにリッチメニューを適用
    await axios.post(`${LINE_API}/user/all/richmenu/${richMenuId}`, {}, { headers });
    console.log('✅ 全ユーザーにリッチメニューを適用しました');
}

createRichMenu().catch(console.error);
