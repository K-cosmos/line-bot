const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const LINE_API = 'https://api.line.me/v2/bot';
const headers = {
    Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
};

async function createRichMenu() {
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

    try {
        const res = await axios.post(`${LINE_API}/richmenu`, richMenuData, { headers });
        const richMenuId = res.data.richMenuId;
        console.log('✅ RichMenu作成成功:', richMenuId);

        const imageBuffer = fs.readFileSync('./richmenu.png');
        await axios({
            method: 'put', // ✅ ここをPUTに
            url: `${LINE_API}/richmenu/${richMenuId}/content`,
            headers: {
                Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                'Content-Type': 'image/png'
            },
            data: imageBuffer
        });
        console.log('✅ 画像アップロード成功');

        await axios.post(`${LINE_API}/user/all/richmenu/${richMenuId}`, {}, { headers });
        console.log('✅ 全ユーザーにリッチメニューを適用しました');

    } catch (error) {
        console.error('❌ エラーが発生しました:', error.response?.data || error.message);
    }
}

createRichMenu();
