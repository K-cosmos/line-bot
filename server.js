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

function broadcastKeyStatus() {
    const text =
        `【鍵の状態変更】\n` +
        `研究室: ${keyStatus['研究室']}\n` +
        `実験室: ${keyStatus['実験室']}`;
    for (const userId of Object.keys(members)) {
        client.pushMessage(userId, { type: 'text', text });
    }
}

function createKeyReturnConfirmQuickReply(areaList) {
    return {
        type: 'text',
        text: `${areaList.join('、')}の鍵を返す？`,
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
    if (event.type !== 'postback') return;

    const postbackData = event.postback.data;
    console.log('ポストバック受信:', postbackData);

    if (postbackData === 'show_key_status') {
        return handleShowKeyStatus(event);
    }

    if (postbackData === 'show_all_members') {
        return handleShowAllMembers(event);
    }

    if (postbackData === 'open_status_menu') {
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

    if (postbackData === 'return_yes' || postbackData === 'return_no') {
        return handleReturnKey(event, postbackData);
    }

    if (AREAS.includes(postbackData)) {
        return handleStatusChange(event, postbackData);
    }
}

function recalcKeyStatus(lastUserId) {
  const keyReturnedAreas = [];
  let keyChanged = false;

  for (const area of ['研究室', '実験室']) {
    const prev = keyStatus[area];
    const inArea = Object.values(members).filter(m => m.status === area).length;
    const allOutside = Object.values(members).every(m => m.status === '学外');

    let next = prev;
    if (inArea > 0) next = '〇';
    else if (!allOutside) next = '△'; // 誰かどこかにいれば△
    else next = '×';

    if (prev !== next) {
      console.log(`[鍵更新] ${area}: ${prev} → ${next}`);
      keyStatus[area] = next;
      keyChanged = true;

      if (next === '×' && (prev === '△' || prev === '〇') && allOutside && lastUserId) {
        keyReturnedAreas.push(area);
      }
    }
  }

  if (keyChanged) {
    broadcastKeyStatus();
  }

  return { keyReturnedAreas, keyChanged };
}

async function handleStatusChange(event, newStatus) {
  const userId = event.source.userId;

  if (!AREAS.includes(newStatus)) {
    return client.replyMessage(event.replyToken, { type: 'text', text: '無効なステータス' });
  }

  try {
    const profile = await client.getProfile(userId);
    members[userId] = { name: profile.displayName, status: newStatus };
    console.log(`[変更] ${profile.displayName}(${userId}) → ${newStatus}`);

    const prevKeyStatus = { ...keyStatus };
    const { keyReturnedAreas, keyChanged } = recalcKeyStatus(userId);

    const replyMessages = [];

    // ① ステータス更新通知
    replyMessages.push({ type: 'text', text: `ステータスを「${newStatus}」に更新` });

    // ② 鍵が△になったところを返却確認で聞く
    const areasToPrompt = ['研究室', '実験室'].filter(area =>
      keyStatus[area] === '△' && prevKeyStatus[area] !== '△'
    );

    if (areasToPrompt.length > 0) {
      replyMessages.push(createKeyReturnConfirmQuickReply(areasToPrompt));
      // 返却確認中は鍵の状態は送らない
    } else {
      // ③ 鍵返却確認不要なら鍵の状態を送る
      replyMessages.push({
        type: 'text',
        text: `🔐 鍵の状態\n${formatKeyStatusText()}`,
      });
    }

    return client.replyMessage(event.replyToken, replyMessages);
  } catch (err) {
    console.error('[ステータス変更エラー]', err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ステータスの更新中にエラーが発生しました。',
    });
  }
}

async function handleReturnKey(event, postbackData) {
  const userId = event.source.userId;
  let resultText = '';

  if (postbackData === 'return_yes') {
    // ユーザーが「はい」と答えたときだけ×にする
    for (const area of ['研究室', '実験室']) {
      if (keyStatus[area] === '△') {
        keyStatus[area] = '×';
        console.log(`[鍵返却] ${area}：△→× by ${userId}`);
      }
    }
    resultText = '鍵の返却：しました';
  } else {
    resultText = '鍵の返却：しませんでした';
  }

  // 鍵状態の再計算（×にはしないので必要ないが念のため）
  recalcKeyStatus();

  // 返事＋鍵の状態をまとめて送る
  const statusText = `🔐 鍵の状態\n${formatKeyStatusText()}`;
  await client.replyMessage(event.replyToken, [
    { type: 'text', text: resultText },
    { type: 'text', text: statusText },
  ]);

  // 全員に最新の鍵状態を送信
  broadcastKeyStatus();
}
      
async function handleShowKeyStatus(event) {
    const messagesText = formatKeyStatusText();
    const areasToPrompt = ['研究室', '実験室'].filter(area => keyStatus[area] === '△');

    if (areasToPrompt.length === 0) {
        return client.replyMessage(event.replyToken, { type: 'text', text: `🔐 鍵の状態\n${messagesText}` });
    }

    return client.replyMessage(event.replyToken, [
        { type: 'text', text: `🔐 鍵の状態\n${messagesText}` },
        createKeyReturnConfirmQuickReply(areasToPrompt),
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

// すでにある部分に追記してね！

app.post('/webhook', (req, res) => {
    Promise.all(req.body.events.map(handleEvent))
        .then(() => res.sendStatus(200))
        .catch(err => {
            console.error('[Webhook全体のエラー]', err.stack || err);
            res.sendStatus(500);
        });
});

// Node全体で補足する例外キャッチ
process.on('unhandledRejection', (reason, p) => {
    console.error('未処理のPromise例外:', reason.stack || reason);
});
process.on('uncaughtException', (err) => {
    console.error('未処理例外:', err.stack || err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート${PORT}で起動したよ`);
});
