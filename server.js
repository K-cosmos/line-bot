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

// 状態管理
const areas = ['研究室', '実験室', '学内', '学外'];
const members = {}; // userId -> { name, status }
const keyStatus = { '研究室': '×', '実験室': '×' };

// リトライ付きpushMessage関数
async function pushMessageWithRetry(userId, messages, maxRetries = 3, delayMs = 1500) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await client.pushMessage(userId, messages);
            return; // 成功したら抜ける
        } catch (err) {
            console.error(`pushMessage失敗、リトライします。残り回数: ${maxRetries - attempt} エラー:`, err.message || err);
            if (attempt === maxRetries) {
                console.error(`pushMessage完全に失敗しました: ${userId}`, err);
                throw err;  // 最大リトライで諦める
            }
            // 少し待ってからリトライ
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
}

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

// 鍵状況の更新＆通知
async function updateKeyStatus(changedUserId) {
    const messagesText = [];
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

        messagesText.push(`${area}：${keyStatus[area]}`);
    }

    if (!changedUserId) {
        // 変更ユーザーなしの場合は全員に通知だけ
        await broadcastKeyStatus(`🔐 鍵の状態\n${messagesText.join('\n')}`);
        return;
    }

    if (areasToPrompt.length === 0) {
        await pushMessageWithRetry(changedUserId, [
            { type: 'text', text: `🔐 鍵の状態\n${messagesText.join('\n')}` },
            {
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
            }
        ]);
    } else if (areasToPrompt.length === 1) {
        await pushMessageWithRetry(changedUserId, [
            { type: 'text', text: `🔐 鍵の状態\n${messagesText.join('\n')}` },
            {
                type: 'template',
                altText: `${areasToPrompt[0]}の鍵を返しますか？`,
                template: {
                    type: 'confirm',
                    text: `${areasToPrompt[0]}の鍵を返しますか？`,
                    actions: [
                        { type: 'postback', label: 'はい', data: `return_yes_${areasToPrompt[0]}` },
                        { type: 'postback', label: 'いいえ', data: `return_no_${areasToPrompt[0]}` }
                    ]
                }
            },
            {
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
            }
        ]);
    } else if (areasToPrompt.length === 2) {
        await pushMessageWithRetry(changedUserId, [
            { type: 'text', text: `🔐 鍵の状態\n${messagesText.join('\n')}` },
            {
                type: 'template',
                altText: '鍵を返しますか？',
                template: {
                    type: 'buttons',
                    text: 'どの鍵を返しますか？',
                    actions: [
                        { type: 'postback', label: '研究室', data: 'return_yes_研究室' },
                        { type: 'postback', label: '実験室', data: 'return_yes_実験室' },
                        { type: 'postback', label: '両方', data: 'return_yes_両方' }
                    ]
                }
            },
            {
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
            }
        ]);
    }
}

// 鍵返却の処理
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

    // 鍵状態を全員に通知
    broadcastKeyStatus(`🔐 鍵の状態\n研究室：${keyStatus['研究室']}\n実験室：${keyStatus['実験室']}`);

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `鍵の返却：${response === 'yes' ? 'しました' : 'しませんでした'}`
    }).then(() => sendStatusButtonsToUser(userId));
}

// ステータスボタンを送る（reply用）
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

// ステータスボタンを送る（push用）
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

// 鍵状況を全員に送信（broadcast）
function broadcastKeyStatus(text) {
    const userIds = Object.keys(members);
    return Promise.all(userIds.map(userId => {
        return pushMessageWithRetry(userId, { type: 'text', text });
    }));
}

// 鍵状況を見せるコマンドの処理
function handleShowKeyStatus(event) {
    const userId = event.source.userId;
    const messagesText = [];
    const areasToPrompt = [];

    for (const area of ['研究室', '実験室']) {
        messagesText.push(`${area}：${keyStatus[area]}`);
        if (keyStatus[area] === '△') areasToPrompt.push(area);
    }

    if (areasToPrompt.length === 0) {
        // △なしなら鍵状況＋ステータスボタンをまとめて送る
        return client.replyMessage(event.replyToken, [
            { type: 'text', text: `🔐 鍵の状態\n${messagesText.join('\n')}` },
            {
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
            }
        ]);
    } else if (areasToPrompt.length === 1) {
        // △1つなら鍵状況＋返却確認＋ステータスボタンまとめて返信
        return client.replyMessage(event.replyToken, [
            { type: 'text', text: `🔐 鍵の状態\n${messagesText.join('\n')}` },
            {
                type: 'template',
                altText: `${areasToPrompt[0]}の鍵を返しますか？`,
                template: {
                    type: 'confirm',
                    text: `${areasToPrompt[0]}の鍵を返しますか？`,
                    actions: [
                        { type: 'postback', label: 'はい', data: `return_yes_${areasToPrompt[0]}` },
                        { type: 'postback', label: 'いいえ', data: `return_no_${areasToPrompt[0]}` }
                    ]
                }
            },
            {
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
            }
        ]);
    } else if (areasToPrompt.length === 2) {
        // △2つなら鍵状況＋複数返却確認＋ステータスボタンまとめて返信
        return client.replyMessage(event.replyToken, [
            { type: 'text', text: `🔐 鍵の状態\n${messagesText.join('\n')}` },
            {
                type: 'template',
                altText: '鍵を返しますか？',
                template: {
                    type: 'buttons',
                    text: 'どの鍵を返しますか？',
                    actions: [
                        { type: 'postback', label: '研究室', data: 'return_yes_研究室' },
                        { type: 'postback', label: '実験室', data: 'return_yes_実験室' },
                        { type: 'postback', label: '両方', data: 'return_yes_両方' }
                    ]
                }
            },
            {
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
            }
        ]);
    }
}

// 全メンバー表示（必要なら）
function handleShowAllMembers(event) {
    const list = Object.values(members).map(m => `${m.name}：${m.status}`).join('\n') || 'まだ誰も登録していません。';
    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `メンバー一覧\n${list}`
    });
}

// ポート起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート${PORT}で起動したよ`);
});
