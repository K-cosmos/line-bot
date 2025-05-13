const express = require('express');
const bodyParser = require('body-parser');
const { Client } = require('@line/bot-sdk');

const app = express();
app.use(bodyParser.json());

const config = {
    channelAccessToken: '2007403130',
    channelSecret: '84762520e79effc21c5a9e8883a8b38d'
};

const client = new Client(config);

const memberStatus = {}; // ユーザーごとの状態を保存

// 鍵の状態を判定する関数
function getKeyStatus(statuses) {
    const values = Object.values(statuses);
    const lab = values.includes('研究室') ? '〇' :
        values.some(s => ['学内', '実験室'].includes(s)) ? '△' : '×';
    const lab2 = values.includes('実験室') ? '〇' :
        values.some(s => ['研究室', '学内'].includes(s)) ? '△' : '×';
    return { 研究室: lab, 実験室: lab2 };
}

app.post('/webhook', (req, res) => {
    Promise.all(req.body.events.map(handleEvent))
        .then(() => res.sendStatus(200))
        .catch(err => {
            console.error(err);
            res.sendStatus(500);
        });
});

function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') return Promise.resolve();

    const userId = event.source.userId;
    const text = event.message.text.trim();

    const valid = ['研究室', '実験室', '学内', '学外'];
    if (!valid.includes(text)) {
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: `「研究室」「実験室」「学内」「学外」から選んでね。`
        });
    }

    memberStatus[userId] = text; // 状態を保存

    const keyStatus = getKeyStatus(memberStatus);

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `ステータスを「${text}」に更新したよ！\n\n🔐 鍵の状態：\n研究室：${keyStatus.研究室}\n実験室：${keyStatus.実験室}`
    });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`LINE Bot is running on port ${port}`);
});
