if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const bodyParser = require('body-parser');
const { Client } = require('@line/bot-sdk');

const app = express();
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new Client(config);
console.log('🔐 LINE設定:', config);

// メンバーと鍵状態の初期化
const members = {};
const defaultStatus = '学外';
const areas = ['研究室', '実験室'];
const keyStatus = {
    '研究室': '×',
    '実験室': '×'
};

app.post('/webhook', (req, res) => {
    console.log('Webhook received');
    Promise.all(req.body.events.map(handleEvent))
        .then(() => res.sendStatus(200))
        .catch(err => {
            console.error(err);
            res.sendStatus(500);
        });
});

function handleEvent(event) {
    console.log('Handling event:', event);

    if (event.type === 'postback') {
        const data = event.postback.data;
        if (data.startsWith('return_')) {
            return handleReturnKey(event);
        } else {
            return handleStatusChange(event);
        }
    }

    if (event.type === 'message' && event.message.type === 'text') {
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: 'ステータスを選択してください。'
        });
    }

    return Promise.resolve(null);
}

function handleStatusChange(event) {
    const userId = event.source.userId;
    const newStatus = event.postback.data;
    members[userId] = newStatus;

    const keyUpdate = updateKeyStatus();

    let reply = `ステータスを「${newStatus}」に更新しました。\n\n🔑 鍵の状態\n`;
    for (const area of areas) {
        reply += `${area}：${keyStatus[area]}\n`;
    }

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: reply.trim()
    });
}

function handleReturnKey(event) {
    const userId = event.source.userId;
    const data = event.postback.data;

    if (!data.startsWith('return_')) return;

    const [_, response, area] = data.split('_');
    if (!areas.includes(area)) return;

    if (response === 'yes') {
        keyStatus[area] = '×';
    } else {
        keyStatus[area] = '△';
    }

    // 状態を全員に送信
    broadcastKeyStatus(`${area}：${keyStatus[area]}`);

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `鍵の返却：${response === 'yes' ? 'しました' : 'しませんでした'}`
    });
}

function updateKeyStatus() {
    let messages = [];

    for (const area of areas) {
        const inArea = Object.entries(members).filter(([_, s]) => s === area);
        const allOutside = Object.values(members).every(s => s === '学外');

        let newStatus = '×';
        if (inArea.length > 0) {
            newStatus = '〇';
        } else if (!allOutside) {
            const candidate = Object.entries(members).find(([_, s]) => s !== '学外');
            if (candidate) {
                promptReturnKey(candidate[0], area);
                newStatus = '△'; // 保留中
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

function broadcastKeyStatus(text) {
    const userIds = Object.keys(members);
    const message = {
        type: 'text',
        text: `🔐 鍵の状態が変わりました！\\n${text}`
    };

    userIds.forEach(userId => {
        client.pushMessage(userId, message).catch(err => {
            console.error(`Error pushing to ${userId}:`, err);
        });
    });
}

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


const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`LINE Bot is running on port ${port}`);
});
