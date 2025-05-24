if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const { Client } = require('@line/bot-sdk');
const app = express();
app.use(express.json());

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

const AREAS = ['研究室', '実験室', '学内', '学外'];
const members = {}; // userId -> { name, status }
const keyStatus = { '研究室': '×', '実験室': '×' };

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function pushMessageWithRetry(userId, messages, maxRetries = 3, delayMs = 1500) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await client.pushMessage(userId, messages);
            return;
        } catch (err) {
            console.error(`pushMessage失敗 リトライ残り:${maxRetries - attempt} エラー:`, err.message || err);
            if (attempt === maxRetries) throw err;
            await delay(delayMs);
        }
    }
}

async function broadcastKeyStatus(text) {
    const userIds = Object.keys(members);
    await Promise.all(userIds.map(id => pushMessageWithRetry(id, { type: 'text', text })));
}

function recalcKeyStatus() {
    for (const area of ['研究室', '実験室']) {
        const prev = keyStatus[area];
        const inArea = Object.values(members).filter(m => m.status === area).length;
        const allOutside = Object.values(members).every(m => m.status === '学外');

        let next = '×';
        if (inArea > 0) next = '〇';
        else if (!allOutside && prev !== '×') next = '△';

        if (prev !== next) {
            console.log(`[鍵更新] ${area}: ${prev} → ${next}`);
            keyStatus[area] = next;
        }
    }
}

function createKeyReturnConfirm(areasToPrompt) {
    if (areasToPrompt.length === 1) {
        const area = areasToPrompt[0];
        return {
            type: 'template',
            altText: `${area}の鍵を返しますか？`,
            template: {
                type: 'confirm',
                text: `${area}の鍵を返しますか？`,
                actions: [
                    { type: 'postback', label: 'はい', data: 'return_yes_研究室' },
                    { type: 'postback', label: 'いいえ', data: 'return_no_研究室' },
                ],
            },
        };
    }
    return {
        type: 'template',
        altText: '鍵を返しますか？',
        template: {
            type: 'buttons',
            text: 'どの鍵を返しますか？',
            actions: [
                { type: 'postback', label: '研究室', data: 'return_yes_研究室' },
                { type: 'postback', label: '実験室', data: 'return_yes_研究室' },
                { type: 'postback', label: '両方', data: 'return_yes_研究室' },
                { type: 'postback', label: '返さない', data: 'return_no_研究室' },
            ],
        },
    };
}

function formatKeyStatusText() {
    return ['研究室', '実験室'].map(area => `${area}：${keyStatus[area]}`).join('\n');
}

async function handleEvent(event) {
    console.log('ポストバック受信:', event.postback.data);
    if (event.type === 'postback') {
        const data = event.postback.data
       if (data === 'show_key_status') {
          return handleShowKeyStatus(event);
       }

    if (data === 'show_all_members') {
        return handleShowAllMembers(event);
    }

    if (data === 'open_status_menu') {
        const quickReply = {
            items: AREAS.map(area => ({
                type: 'action',
                action: {
                     type: 'postback',
                     label: area,
                     data: area,
               },
        })),
    };

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ステータスを選択',
        quickReply: quickReply,
    });
}

if (AREAS.includes(data)) {
    return handleStatusChange(event);
}
    }
}

async function handleStatusChange(event) {
    const userId = event.source.userId;
    const newStatus = event.postback.data;

    if (!AREAS.includes(newStatus)) {
        return client.replyMessage(event.replyToken, { type: 'text', text: '無効なステータス' });
    }

    try {
        const profile = await client.getProfile(userId);
        members[userId] = { name: profile.displayName, status: newStatus };
        console.log(`[変更] ${profile.displayName}(${userId}) → ${newStatus}`);

        recalcKeyStatus();

        const areasToPrompt = ['研究室', '実験室'].filter(area => keyStatus[area] === '△');
        const baseTextMsg = { type: 'text', text: `ステータスを「${newStatus}」に更新` };

        if (areasToPrompt.length === 0) {
            return client.replyMessage(event.replyToken, baseTextMsg);
        }

        return client.replyMessage(event.replyToken, [
            baseTextMsg,
            createKeyReturnConfirm(areasToPrompt),
        ]);
    } catch (err) {
        console.error('handleStatusChange error:', err);
    }
}

async function handleReturnKey(event) {
    const userId = event.source.userId;
    const data = event.postback.data;
    const response = data.includes('yes') ? 'yes' : 'no';

    if (response === 'yes') {
        if (members[userId]) members[userId].status = '学外';
    }

    recalcKeyStatus();

    const text = response === 'yes'
        ? `鍵の返却：しました\n🔐 鍵の状態\n${formatKeyStatusText()}`
        : `鍵の返却：しませんでした\n🔐 鍵の状態\n${formatKeyStatusText()}`;

    await broadcastKeyStatus(text);

    return client.replyMessage(event.replyToken, { type: 'text', text });
}

async function handleShowKeyStatus(event) {
    const messagesText = formatKeyStatusText();
    const areasToPrompt = ['研究室', '実験室'].filter(area => keyStatus[area] === '△');

    if (areasToPrompt.length === 0) {
        return client.replyMessage(event.replyToken, { type: 'text', text: `🔐 鍵の状態\n${messagesText}` });
    }

    return client.replyMessage(event.replyToken, [
        { type: 'text', text: `🔐 鍵の状態\n${messagesText}` },
        createKeyReturnConfirm(areasToPrompt),
    ]);
}

async function handleShowAllMembers(event) {
    const statusGroups = {};
    Object.values(members).forEach(({ name, status }) => {
        if (status === '学外') return;
        if (!statusGroups[status]) statusGroups[status] = [];
        statusGroups[status].push(name);
    });

    const text = AREAS
        .filter(area => area !== '学外' && statusGroups[area])
        .map(area => `${area}\n${statusGroups[area].map(name => `・${name}`).join('\n')}`)
        .join('\n\n') || '全員学外';

    return client.replyMessage(event.replyToken, { type: 'text', text });
}

app.post('/webhook', (req, res) => {
    Promise.all(req.body.events.map(handleEvent))
        .then(() => res.sendStatus(200))
        .catch(err => {
            console.error(err);
            res.sendStatus(500);
        });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート${PORT}で起動したよ`);
});
