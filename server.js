if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const { Client } = require('@line/bot-sdk');
const cron = require('node-cron');

const app = express();
app.use(express.json());

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};
const client = new Client(config);

// リトライ付き pushMessage 関数（最大3回リトライ）
function pushMessageWithRetry(userId, message, retries = 3, delay = 1000) {
    return client.pushMessage(userId, message).catch(err => {
        if (retries > 0) {
            console.warn(`pushMessage失敗、リトライします。残り回数: ${retries} エラー:`, err.message);
            return new Promise(resolve => setTimeout(resolve, delay))
                .then(() => pushMessageWithRetry(userId, message, retries - 1, delay * 2));
        }
        console.error(`pushMessage完全に失敗しました: ${userId}`, err);
        throw err;
    });
}

// 状態管理
const areas = ['研究室', '実験室', '学内', '学外'];
const members = {}; // userId -> { name, status }
const keyStatus = { '研究室': '×', '実験室': '×' };

// Webhook エントリーポイント
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
    if (event.type !== 'postback') return Promise.resolve(null);

    const data = event.postback.data;

    if (data === 'open_status_menu') return sendStatusButtons(event.replyToken);
    if (data === 'show_key_status') return handleShowKeyStatus(event);
    if (data === 'show_all_members') return handleShowAllMembers(event);
    if (data.startsWith('return_')) return handleReturnKey(event);

    // ステータス変更
    return handleStatusChange(event);
}

// ステータス変更処理
function handleStatusChange(event) {
    const userId = event.source.userId;
    const newStatus = event.postback.data;

    if (!areas.includes(newStatus)) {
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: '無効なステータスだよ！'
        });
    }

    return client.getProfile(userId).then(profile => {
        members[userId] = {
            name: profile.displayName,
            status: newStatus
        };
        console.log(`[変更] ${profile.displayName}(${userId}) → ${newStatus}`);
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: `ステータスを「${newStatus}」に更新`
        });
    }).then(() => updateKeyStatus(userId))
      .catch(err => console.error('handleStatusChange error:', err));
}

// 鍵の状態更新＆通知
function updateKeyStatus(changedUserId) {
    const messages = [];
    const areasToPrompt = [];

    for (const area of ['研究室', '実験室']) {
        const before = keyStatus[area];
        const inArea = Object.values(members).filter(m => m.status === area);
        const allOutside = Object.values(members).every(m => m.status === '学外');

        let next = '×';
        if (inArea.length > 0) next = '〇';
        else if (!allOutside && before !== '×') next = '△';

        if (before !== next) {
            console.log(`[鍵更新] ${area}：${before} → ${next}`);
            keyStatus[area] = next;
        }

        if (before === '〇' && next === '△') areasToPrompt.push(area);

        messages.push(`${area}：${next}`);
    }

    broadcastKeyStatus(`🔐 鍵の状態\n${messages.join('\n')}`);

    // △が1つなら即送信、2つなら少し遅延
    if (changedUserId) {
        if (areasToPrompt.length === 1) {
            return promptReturnKey(changedUserId, areasToPrompt[0], 0);
        } else if (areasToPrompt.length === 2) {
            return promptReturnKey(changedUserId, areasToPrompt[0], 0)
                .then(() => promptReturnKey(changedUserId, areasToPrompt[1], 1500));
        }
    }

    return Promise.resolve();
}

// 鍵返却確認（1エリア）
function promptReturnKey(userId, area, delay = 0) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            pushMessageWithRetry(userId, {
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
            }).then(resolve).catch(reject);
        }, delay);
    });
}

// 鍵返却確認（複数用ボタン）
function promptMultipleReturnKey(userId, delay = 0) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            pushMessageWithRetry(userId, {
                type: 'template',
                altText: '鍵を返しますか？',
                template: {
                    type: 'buttons',
                    text: 'どの鍵を返す？',
                    actions: [
                        { type: 'postback', label: '研究室', data: 'return_yes_研究室' },
                        { type: 'postback', label: '実験室', data: 'return_yes_実験室' },
                        { type: 'postback', label: '両方', data: 'return_yes_両方' }
                    ]
                }
            }).then(resolve).catch(reject);
        }, delay);
    });
}

// 鍵返却処理
function handleReturnKey(event) {
    const userId = event.source.userId;
    const [_, response, area] = event.postback.data.split('_');

    if (area === '両方') {
        ['研究室', '実験室'].forEach(a => {
            keyStatus[a] = response === 'yes' ? '×' : '△';
        });
    } else {
        keyStatus[area] = response === 'yes' ? '×' : '△';
    }

    broadcastKeyStatus(`🔐 鍵の状態\n研究室：${keyStatus['研究室']}\n実験室：${keyStatus['実験室']}`);

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `鍵の返却：${response === 'yes' ? 'しました' : 'しませんでした'}`
    }).then(() => sendStatusButtonsToUser(userId));
}

// ステータスボタン送信（replyToken用）
function sendStatusButtons(replyToken) {
    return client.replyMessage(replyToken, {
        type: 'template',
        altText: 'ステータスを選択：',
        template: {
            type: 'buttons',
            text: 'ステータスを選択',
            actions: areas.map(area => ({
                type: 'postback',
                label: area,
                data: area
            }))
        }
    });
}

// ステータスボタン送信（push用）
function sendStatusButtonsToUser(userId) {
    return pushMessageWithRetry(userId, {
        type: 'template',
        altText: 'ステータスを選択：',
        template: {
            type: 'buttons',
            text: 'ステータスを選択',
            actions: areas.map(area => ({
                type: 'postback',
                label: area,
                data: area
            }))
        }
    });
}

// 鍵状態を全ユーザーに通知
function broadcastKeyStatus(message) {
    Object.keys(members).forEach((userId, i) => {
        setTimeout(() => {
            pushMessageWithRetry(userId, {
                type: 'text',
                text: message
            }).catch(err => console.error(`鍵通知失敗：${userId}`, err));
        }, i * 1500);
    });
}

// ステータスリセット（毎朝4時）
function resetAllStatusesToOutside() {
    console.log('[定時処理] 全員を「学外」にリセット');
    Object.keys(members).forEach(userId => {
        members[userId].status = '学外';
    });
    updateKeyStatus(null);
}

// 毎日4時にリセット実行
cron.schedule('0 4 * * *', resetAllStatusesToOutside, {
    timezone: 'Asia/Tokyo'
});

// キー状態表示
function handleShowKeyStatus(event) {
    const text = `🔐 鍵の状態\n研究室：${keyStatus['研究室']}\n実験室：${keyStatus['実験室']}`;
    const needPrompt = ['研究室', '実験室'].filter(a => keyStatus[a] === '△');

    if (needPrompt.length === 1) {
        return Promise.all([
            client.replyMessage(event.replyToken, { type: 'text', text }),
            promptReturnKey(event.source.userId, needPrompt[0]),
            sendStatusButtonsToUser(event.source.userId)
        ]);
    } else if (needPrompt.length === 2) {
        return Promise.all([
            client.replyMessage(event.replyToken, { type: 'text', text }),
            promptMultipleReturnKey(event.source.userId),
            sendStatusButtonsToUser(event.source.userId)
        ]);
    }

    return client.replyMessage(event.replyToken, { type: 'text', text });
}

// 全メンバー表示
function handleShowAllMembers(event) {
    const statusGroups = {};

    Object.values(members).forEach(info => {
        if (info.status === '学外') return;
        if (!statusGroups[info.status]) statusGroups[info.status] = [];
        statusGroups[info.status].push(info.name);
    });

    const text = areas
        .filter(area => area !== '学外' && statusGroups[area])
        .map(area => `${area}\n${statusGroups[area].map(name => `・${name}`).join('\n')}`)
        .join('\n\n') || '全員学外';

    return client.replyMessage(event.replyToken, { type: 'text', text });
}

// サーバー起動
app.get('/', (req, res) => {
    res.send('LINE Bot is alive!');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`LINE Bot is running on port ${port}`);
});
