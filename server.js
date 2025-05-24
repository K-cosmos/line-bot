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

function createKeyReturnConfirmQuickReply(areaList) {
    return {
        type: 'text',
        text: '鍵を返却しますか？',
        quickReply: {
            items: [
                {
                    type: 'action',
                    action: {
                        type: 'postback',
                        label: 'はい',
                        data: 'return_yes',
                    },
                },
                {
                    type: 'action',
                    action: {
                        type: 'postback',
                        label: 'いいえ',
                        data: 'return_no',
                    },
                },
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

    if (data === 'return_yes' || data === 'return_no') {
    return handleReturnKey(event);
}
        
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
            createKeyReturnConfirmQuickReply(areasToPrompt),
        ]);
    } catch (err) {
        console.error('handleStatusChange error:', err);
        return client.replyMessage(event.replyToken, { type: 'text', text: 'ステータス更新中にエラーが発生したよ' });
    }
}

async function handleReturnKey(event) {
    const userId = event.source.userId;
    const data = event.postback.data;

if (data === 'return_yes') {
    if (members[userId]) members[userId].status = '学外';
    // 鍵返却処理あり
} else if (data === 'return_no') {
    // 鍵返却処理なし
}

    recalcKeyStatus();

    const resultText = response === 'yes'
        ? '鍵の返却：しました'
        : '鍵の返却：しませんでした';

    const statusText = `🔐 鍵の状態\n${formatKeyStatusText()}`;

    await client.replyMessage(event.replyToken, [
        { type: 'text', text: resultText },
        { type: 'text', text: statusText },
    ]);

    await broadcastKeyStatus(`${resultText}\n${statusText}`);
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
