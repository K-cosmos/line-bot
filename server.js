if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const { Client } = require('@line/bot-sdk');

const app = express();
app.use(express.json());

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new Client(config);

// メンバーの状態
const members = {};  // userId -> ステータス
const keyStatus = {
    '研究室': '×',
    '実験室': '×'
};

const areas = ['研究室', '実験室', '学内', '学外'];

// LINE webhook
app.post('/webhook', (req, res) => {
    Promise.all(req.body.events.map(handleEvent))
        .then(() => res.sendStatus(200))
        .catch(err => {
            console.error(err);
            res.sendStatus(500);
        });
});

// イベント処理
function handleEvent(event) {
    if (event.type === 'postback') {
        const data = event.postback.data;
        if (data.startsWith('return_')) {
            return handleReturnKey(event);
        } else {
            return handleStatusChange(event);
        }
    }

    if (event.type === 'message' && event.message.type === 'text') {
        return sendStatusButtons(event.replyToken);
    }

    return Promise.resolve(null);
}

// ステータス変更
function handleStatusChange(event) {
    const userId = event.source.userId;
    const newStatus = event.postback.data;

    if (!areas.includes(newStatus)) {
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: '無効なステータスです。'
        });
    }

    members[userId] = newStatus;
    updateKeyStatus();
    return sendStatusButtons(event.replyToken, `ステータスを「${newStatus}」に更新しました。`);
}

// ステータス選択ボタン送信
function sendStatusButtons(replyToken, msg = 'ステータスを選択してください：') {
    return client.replyMessage(replyToken, {
        type: 'template',
        altText: 'ステータス選択メニュー',
        template: {
            type: 'buttons',
            text: msg,
            actions: areas.map(area => ({
                type: 'postback',
                label: area,
                data: area
            }))
        }
    });
}

// 鍵の状態を更新し、必要なら送信
function updateKeyStatus() {
    let messages = [];

    for (const area of ['研究室', '実験室']) {
        const inArea = Object.entries(members).filter(([_, s]) => s === area);
        const allOutside = Object.values(members).every(s => s === '学外');

        let newStatus = '×';
        if (inArea.length > 0) {
            newStatus = '〇';
        } else if (!allOutside) {
            const candidate = Object.entries(members).find(([_, s]) => s !== '学外');
            if (candidate) {
                promptReturnKey(candidate[0], area);
                newStatus = '△';
            }
        }

        if (keyStatus[area] !== newStatus) {
            keyStatus[area] = newStatus;
            messages.push(`${area}：${newStatus}`);
        }
    }

    if (messages.length > 0) {
        broadcastKeyStatus(messages.join('\n'));
    }
}

// △時に「鍵返しますか？」と確認
function promptReturnKey(userId, area) {
    client.pushMessage(userId, {
        type: 'template',
        altText: '鍵を返しますか？',
        template: {
            type: 'confirm',
            text: `${area}の鍵を返しますか？`,
            actions: [
                {
                    type: 'postback',
                    label: 'はい',
                    data: `return_yes_${area}`
                },
                {
                    type: 'postback',
                    label: 'いいえ',
                    data: `return_no_${area}`
                }
            ]
        }
    }).catch(err => {
        console.error(`鍵返却確認の送信に失敗: ${err}`);
    });
}

// Yes/No回答処理
function handleReturnKey(event) {
    const userId = event.source.userId;
    const data = event.postback.data;

    const [_, response, area] = data.split('_');
    if (!['研究室', '実験室'].includes(area)) return;

    if (response === 'yes') {
        keyStatus[area] = '×';
    } else {
        keyStatus[area] = '△';
    }

    broadcastKeyStatus(`${area}：${keyStatus[area]}`);

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `鍵の返却：${response === 'yes' ? 'しました' : 'しませんでした'}`
    });
}

// 鍵の状態を全員に通知
function broadcastKeyStatus(message) {
    Object.keys(members).forEach(userId => {
        client.pushMessage(userId, {
            type: 'text',
            text: `🔐 鍵の状態\n${message}`
        }).catch(err => {
            console.error(`通知送信失敗（${userId}）:`, err);
        });
    });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`LINE Bot is running on port ${port}`);
});
