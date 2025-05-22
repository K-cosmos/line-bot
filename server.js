// server.js
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const fs = require('fs');
const { Client } = require('@line/bot-sdk');

const app = express();
app.use(express.json());

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new Client(config);

// メンバー状態と鍵状態
const members = {};  // userId -> status
const keyStatus = {
    '研究室': '×',
    '実験室': '×'
};

const areas = ['研究室', '実験室', '学内', '学外'];

app.post('/webhook', (req, res) => {
    Promise.all(req.body.events.map(handleEvent))
        .then(() => res.sendStatus(200))
        .catch(err => {
            console.error(err);
            res.sendStatus(500);
        });
});

function handleEvent(event) {
    if (event.type === 'postback') {
        const data = event.postback.data;

        if (data === 'open_status_menu') {
            return sendStatusButtons(event.replyToken);
        }

        if (data === 'show_key_status') {
            const text = `🔐 鍵の状態\n研究室：${keyStatus['研究室']}\n実験室：${keyStatus['実験室']}`;
            return client.replyMessage(event.replyToken, { type: 'text', text });
        }

        if (data === 'show_all_members') {
            const text = Object.entries(members)
                .map(([userId, status]) => `${userId}：${status}`)
                .join('\n') || '誰も登録されていません。';
            return client.replyMessage(event.replyToken, { type: 'text', text });
        }

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

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `ステータスを「${newStatus}」に更新`
    }).then(() => updateKeyStatus(userId))
      .catch(err => console.error('handleStatusChange error:', err));
}

function updateKeyStatus(changedUserId) {
    const statusMessages = [];
    const promptPromises = [];

    for (const area of ['研究室', '実験室']) {
        const inArea = Object.entries(members).filter(([_, s]) => s === area);
        const allOutside = Object.values(members).every(s => s === '学外');

        let newStatus = keyStatus[area];

        if (inArea.length > 0) {
            newStatus = '〇';
        } else if (!allOutside) {
            if (keyStatus[area] === '×') continue;
            newStatus = '△';
        } else {
            newStatus = '×';
        }

        keyStatus[area] = newStatus;

        if (newStatus === '△' && changedUserId) {
            promptPromises.push(promptReturnKey(changedUserId, area));
        }

        statusMessages.push(`${area}：${newStatus}`);
    }

    const statusText = `🔐 鍵の状態\n${statusMessages.join('\n')}`;
    broadcastKeyStatus(statusText);

    if (promptPromises.length === 0 && changedUserId) {
        return sendStatusButtonsToUser(changedUserId);
    }

    return Promise.all(promptPromises).then(() => sendStatusButtonsToUser(changedUserId));
}

function promptReturnKey(userId, area) {
    return client.pushMessage(userId, {
        type: 'template',
        altText: `${area}の鍵を返しますか？`,
        template: {
            type: 'confirm',
            text: `${area}の鍵を返しますか？`,
            actions: [
                { type: 'postback', label: 'はい', data: `return_yes_${area}` },
                { type: 'postback', label: 'いいえ', data: `return_no_${area}` }
            ]
        }
    }).catch(err => console.error(`鍵返却確認の送信に失敗: ${err}`));
}

function handleReturnKey(event) {
    const userId = event.source.userId;
    const data = event.postback.data;
    const [_, response, area] = data.split('_');

    if (!['研究室', '実験室'].includes(area)) return;

    keyStatus[area] = response === 'yes' ? '×' : '△';

    broadcastKeyStatus(`🔐 鍵の状態\n${area}：${keyStatus[area]}`);

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `鍵の返却：${response === 'yes' ? 'しました' : 'しませんでした'}`
    }).then(() => sendStatusButtonsToUser(userId));
}

function broadcastKeyStatus(message) {
    Object.keys(members).forEach(userId => {
        client.pushMessage(userId, {
            type: 'text',
            text: message
        }).catch(err => console.error(`通知送信失敗（${userId}）:`, err));
    });
}

function sendStatusButtonsToUser(userId) {
    return client.pushMessage(userId, {
        type: 'template',
        altText: 'ステータスを選択:',
        template: {
            type: 'buttons',
            text: 'ステータスを選択：',
            actions: areas.map(area => ({
                type: 'postback',
                label: area,
                data: area
            }))
        }
    }).catch(err => console.error('sendStatusButtonsToUser error:', err));
}

function sendStatusButtons(replyToken) {
    return client.replyMessage(replyToken, {
        type: 'template',
        altText: 'ステータスを選択:',
        template: {
            type: 'buttons',
            text: 'ステータスを選択：',
            actions: areas.map(area => ({
                type: 'postback',
                label: area,
                data: area
            }))
        }
    }).catch(err => console.error('sendStatusButtons error:', err));
}

app.get('/', (req, res) => {
    res.send('LINE Bot is alive!');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`LINE Bot is running on port ${port}`);
});
