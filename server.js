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

// メンバー状態と鍵状態
const members = {};  // userId -> status
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

// ステータス変更処理
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
    }).then(() => {
        return updateKeyStatus(userId);
    }).then(() => {
        return sendStatusButtonsToUser(userId);  // replyTokenが使えないためpushで送る
    }).catch(err => {
        console.error('handleStatusChange error:', err);
    });
}

// 鍵の状態を更新し必要に応じて確認も送る
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

    // 🔽 鍵の確認がない場合はすぐメニューを送信
    if (promptPromises.length === 0 && changedUserId) {
        return sendStatusButtonsToUser(changedUserId);
    }

    // 🔽 鍵の確認後にメニュー送信
    return Promise.all(promptPromises).then(() => {
        return sendStatusButtonsToUser(changedUserId);
    });
}

// 鍵返却確認（Yes/No）
function promptReturnKey(userId, area) {
    return client.pushMessage(userId, {
        type: 'template',
        altText: `${area}の鍵を返しますか？`,
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

// Yes/No 回答の処理
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

    broadcastKeyStatus(`🔐 鍵の状態\n${area}：${keyStatus[area]}`);

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `鍵の返却：${response === 'yes' ? 'しました' : 'しませんでした'}`
    }).then(() => {
        return sendStatusButtonsToUser(userId);
    });
}

// 鍵の状態を全員に通知
function broadcastKeyStatus(message) {
    Object.keys(members).forEach(userId => {
        client.pushMessage(userId, {
            type: 'text',
            text: message  // 🔐 鍵の状態 は updateKeyStatus で含める
        }).catch(err => {
            console.error(`通知送信失敗（${userId}）:`, err);
        });
    });
}

// メニュー送信（replyTokenなしでpush）
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
    }).catch((err) => {
        console.error('sendStatusButtonsToUser error:', err);
    });
}

// メニュー送信（replyTokenありの初回用）
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
    }).catch((err) => {
        console.error('sendStatusButtons error:', err);
    });
}

// すでにある Express アプリにこの1行を追加
app.get('/', (req, res) => {
    res.send('LINE Bot is alive!');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`LINE Bot is running on port ${port}`);
});
