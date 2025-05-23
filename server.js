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

const areas = ['研究室', '実験室', '学内', '学外'];
const members = {}; 
const keyStatus = { '研究室': '×', '実験室': '×' };

async function pushMessageWithRetry(userId, messages, maxRetries = 3, delayMs = 1500) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await client.pushMessage(userId, messages);
            return;
        } catch (err) {
            console.error(`pushMessage失敗、リトライします。残り回数: ${maxRetries - attempt} エラー:`, err.message || err);
            if (attempt === maxRetries) {
                console.error(`pushMessage完全に失敗しました: ${userId}`, err);
                throw err;
            }
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
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
    if (event.type !== 'postback') return Promise.resolve(null);

    const data = event.postback.data;

    if (data === 'open_status_menu') return sendStatusButtons(event.replyToken);
    if (data === 'show_key_status') return handleShowKeyStatus(event);
    if (data === 'show_all_members') return handleShowAllMembers(event);
    if (data.startsWith('return_')) return handleReturnKey(event);

    return handleStatusChange(event);
}

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
        // ここでステータス更新メッセージを一旦返信しておく
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: `ステータスを「${newStatus}」に更新`
        }).then(() => updateKeyStatus(userId)); // 鍵状況更新は後でpushMessageで通知するためreplyはここまで
    }).catch(err => console.error('handleStatusChange error:', err));
}

async function updateKeyStatus(changedUserId) {
    // 鍵状況テキスト作成
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
        // changedUserId無ければ全員に鍵状況通知だけでOK
        await broadcastKeyStatus(`🔐 鍵の状態\n${messagesText.join('\n')}`);
        return;
    }

    // ここからが改良ポイント↓
    // △の時は鍵返却確認メニューを含めてまとめてpushMessageを送る
    if (areasToPrompt.length === 0) {
        // △じゃなければ鍵状況だけ通知し、ステータスボタンも送る
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
        // △1つのときは鍵状況テキスト＋返却確認（confirmテンプレ）＋ステータスボタン
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
        // △2つのときは鍵状況テキスト＋返却確認（buttonsテンプレ）＋ステータスボタン
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

    // 鍵状態全員に通知（push）
    broadcastKeyStatus(`🔐 鍵の状態\n研究室：${keyStatus['研究室']}\n実験室：${keyStatus['実験室']}`);

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `鍵の返却：${response === 'yes' ? 'しました' : 'しませんでした'}`
    }).then(() => sendStatusButtonsToUser(userId));
}

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

function sendStatusButtonsToUser(userId) {
    return pushMessage
