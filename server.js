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

function createKeyReturnConfirmQuickReply(areaList) {
  return {
    type: 'text',
    text: `${areaList.join('、')}の鍵を返す？`,
    quickReply: {
      items: [
        {
          type: 'action',
          action: { type: 'postback', label: 'はい', data: 'return_yes' },
        },
        {
          type: 'action',
          action: { type: 'postback', label: 'いいえ', data: 'return_no' },
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
  const data = event.postback.data;
  console.log('ポストバック:', data);

  if (data === 'open_status_menu') {
    const quickReply = {
      items: AREAS.map(area => ({
        type: 'action',
        action: { type: 'postback', label: area, data: area },
      })),
    };
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ステータスを選択',
      quickReply,
    });
  }

  if (data === 'show_key_status') {
    return handleShowKeyStatus(event);
  }

  if (data === 'show_all_members') {
    return handleShowAllMembers(event);
  }

  if (data === 'return_yes' || data === 'return_no') {
    return handleReturnKey(event, data);
  }

  if (AREAS.includes(data)) {
    return handleStatusChangeFlow(event, data);
  }
}

async function handleStatusChangeFlow(event, newStatus) {
  const userId = event.source.userId;
  const profile = await client.getProfile(userId);
  const isFirstUpdate = !members[userId]; // 初めてのステータス更新かチェック

  members[userId] = { name: profile.displayName, status: newStatus };

  const prevKeyStatus = { ...keyStatus };
  recalcKeyStatus();

  if (isFirstUpdate) {
    // 1回目は「ステータスを更新」だけ返す
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ステータスを更新',
    });
    return;
  }

  // △があれば返却確認
  const areasToPrompt = ['研究室', '実験室'].filter(area => keyStatus[area] === '△');
  if (areasToPrompt.length > 0) {
    await client.replyMessage(event.replyToken, [
      { type: 'text', text: `ステータスを「${newStatus}」に更新` },
      createKeyReturnConfirmQuickReply(areasToPrompt),
    ]);
    return;
  }

  // △がない → 直接鍵状況更新送信
  await sendKeyStatusUpdate(userId, newStatus, prevKeyStatus);
}

async function handleReturnKey(event, area, answer) {
  const userId = event.source.userId;

  if (answer === 'yes') {
    // 返却する場合だけ鍵状態更新する
    const prevKeyStatus = { ...keyStatus };
    keyStatus[area] = '×';
    await sendKeyStatusUpdate(userId, null, prevKeyStatus, event.replyToken, '鍵の返却: しました');
  } else {
    // 返却しない場合は鍵状態変更しない
    await sendKeyStatusUpdate(userId, null, null, event.replyToken, '鍵の返却: しませんでした');
  }
}
  
async function sendKeyStatusUpdate(userId, newStatus, prevKeyStatus, replyToken = null, prefixText = null) {
  const keyChanged = prevKeyStatus
    ? ['研究室', '実験室'].some(area => prevKeyStatus[area] !== keyStatus[area])
    : false;

  const messages = [];
  if (prefixText) messages.push({ type: 'text', text: prefixText });
  if (newStatus) messages.push({ type: 'text', text: `ステータスを「${newStatus}」に更新` });

  if (keyChanged) {
    messages.push({
      type: 'text',
      text: `【🔐 鍵の状態変更】\n${formatKeyStatusText()}`,
    });

    const areasToPrompt = ['研究室', '実験室'].filter(
      area => prevKeyStatus[area] === '△' && keyStatus[area] === '×'
    );
    if (areasToPrompt.length > 0) {
      messages.push({
        type: 'text',
        text: `${areasToPrompt.join('と')}の鍵よろしくね！`,
      });
    }
  }

  if (messages.length === 0) return;

  if (replyToken) {
    await client.replyMessage(replyToken, messages);
  } else {
    await pushMessageWithRetry(userId, messages);
  }

  if (keyChanged) {
    setTimeout(async () => {
      const otherUserIds = Object.keys(members).filter(id => id !== userId);
      const broadcastMsg = [{
        type: 'text',
        text: `【🔐 鍵の状態変更】\n${formatKeyStatusText()}`,
      }];
      for (const id of otherUserIds) {
        try {
          await pushMessageWithRetry(id, broadcastMsg);
        } catch (e) {
          console.error('全体送信失敗:', e);
        }
      }
    }, 3000);
  }
}

function recalcKeyStatus() {
  for (const area of ['研究室', '実験室']) {
    const inArea = Object.values(members).filter(m => m.status === area).length;
    if (inArea > 0) keyStatus[area] = '〇';
    else keyStatus[area] = keyStatus[area] === '〇' ? '△' : '×';
  }
}

async function handleShowKeyStatus(event) {
  const text = `🔐 鍵の状態\n${formatKeyStatusText()}`;
  const areasToPrompt = ['研究室', '実験室'].filter(area => keyStatus[area] === '△');
  if (areasToPrompt.length === 0) {
    return client.replyMessage(event.replyToken, { type: 'text', text });
  }
  return client.replyMessage(event.replyToken, [
    { type: 'text', text },
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

app.post('/webhook', (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.sendStatus(200))
    .catch(err => {
      console.error('[Webhook全体のエラー]', err.stack || err);
      res.sendStatus(500);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバーがポート${PORT}で起動したよ`);
});
