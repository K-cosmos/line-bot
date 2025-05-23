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
async function handleStatusChange(event) {
    const userId = event.source.userId;
    const newStatus = event.postback.data;

    if (!areas.includes(newStatus)) {
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: '無効なステータス'
        });
    }

    try {
        const profile = await client.getProfile(userId);
        members[userId] = {
            name: profile.displayName,
            status: newStatus
        };
        console.log(`[変更] ${profile.displayName}(${userId}) → ${newStatus}`);

        // 鍵状況更新しつつ、返却確認のメッセージも一緒に作る関数を呼ぶ
        const messages = await createStatusAndKeyReturnMessages(userId);

        // replyMessageは一回だけ。まとめてメッセージを送る
        return client.replyMessage(event.replyToken, messages);

    } catch (err) {
        console.error('handleStatusChange error:', err);
    }
}

// 変更ユーザーがいない全体通知用
// updateKeyStatusもasyncにして、鍵の状態をメンバーから再計算する関数にするよ
async function updateKeyStatus() {
    const messagesText = [];

    for (const area of ['研究室', '実験室']) {
        const before = keyStatus[area];
        // そのエリアにいるメンバー数
        const inArea = Object.values(members).filter(m => m.status === area);
        // 全員が学外かどうか
        const allOutside = Object.values(members).every(m => m.status === '学外');

        let next = '×'; // デフォルト鍵なし
        if (inArea.length > 0) next = '〇';
        else if (!allOutside && before !== '×') next = '△';

        if (before !== next) {
            console.log(`[鍵更新] ${area}：${before} → ${next}`);
            keyStatus[area] = next;
        }

        messagesText.push(`${area}：${keyStatus[area]}`);
    }

    // 鍵状態を必要に応じて全員に通知する場合はここでbroadcastKeyStatus呼んでもOK
}

// 鍵返却の処理
// handleReturnKeyをasyncにするの忘れないでね！
async function handleReturnKey(event) {
    const userId = event.source.userId;
    const [_, response, area] = event.postback.data.split('_');

    if (response === 'yes') {
        // 返却「はい」なら、そのユーザーのステータスを学外にするよ
        members[userId].status = '学外';
    }

    // 鍵状態はメンバーのステータスから自動計算するupdateKeyStatusを呼ぶよ
    await updateKeyStatus();

    const text = response === 'yes'
        ? `鍵の返却：しました\n🔐 鍵の状態\n研究室：${keyStatus['研究室']}\n実験室：${keyStatus['実験室']}`
        : `鍵の返却：しませんでした\n🔐 鍵の状態\n研究室：${keyStatus['研究室']}\n実験室：${keyStatus['実験室']}`;

    // 全員に通知するよ
    await broadcastKeyStatus(text);

    // 返答メッセージを送る
    return client.replyMessage(event.replyToken, {
        type: 'text',
        text
    });
}

// updateKeyStatusもasyncにして、鍵の状態をメンバーから再計算する関数にするよ
async function updateKeyStatus() {
    const messagesText = [];

    for (const area of ['研究室', '実験室']) {
        const before = keyStatus[area];
        // そのエリアにいるメンバー数
        const inArea = Object.values(members).filter(m => m.status === area);
        // 全員が学外かどうか
        const allOutside = Object.values(members).every(m => m.status === '学外');

        let next = '×'; // デフォルト鍵なし
        if (inArea.length > 0) next = '〇';
        else if (!allOutside && before !== '×') next = '△';

        if (before !== next) {
            console.log(`[鍵更新] ${area}：${before} → ${next}`);
            keyStatus[area] = next;
        }

        messagesText.push(`${area}：${keyStatus[area]}`);
    }

    // 鍵状態を必要に応じて全員に通知する場合はここでbroadcastKeyStatus呼んでもOK
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

    // △がなければ鍵状況だけ返信（ステータスメニューは送らない！）
    if (areasToPrompt.length === 0) {
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: `🔐 鍵の状態\n${messagesText.join('\n')}`
        });
    }else if (areasToPrompt.length === 1) {
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
        ]);
    } else if (areasToPrompt.length === 2) {
        // △2つなら鍵状況＋複数返却確認
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
        ]);
    }
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

async function createStatusAndKeyReturnMessages(userId) {
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

    // ここからメッセージ生成

    const baseTextMsg = { type: 'text', text: `ステータスを「${members[userId].status}」に更新` };

    if (areasToPrompt.length === 0) {
        // △なし → ステータス更新と鍵状態のみ
        return [baseTextMsg];
    }

    // △あり → 鍵返却確認＋ステータスメニュー

    let confirmTemplate;

    if (areasToPrompt.length === 1) {
        confirmTemplate = {
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
        };
    } else if (areasToPrompt.length === 2) {
        confirmTemplate = {
            type: 'template',
            altText: '鍵を返しますか？',
            template: {
                type: 'buttons',
                text: 'どの鍵を返しますか？',
                actions: [
                    { type: 'postback', label: '研究室', data: 'return_yes_研究室' },
                    { type: 'postback', label: '実験室', data: 'return_yes_実験室' },
                    { type: 'postback', label: '両方', data: 'return_yes_両方' },
                    { type: 'postback', label: '両方返さない', data: 'return_no_両方' }
                ]
            }
        };
    }

    return [baseTextMsg, confirmTemplate];
}


// ポート起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート${PORT}で起動したよ`);
});
