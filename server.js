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
const members = {};
const keyStatus = { '研究室': '×', '実験室': '×' };

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function pushMessageWithRetry(userId, messages, maxRetries = 3) {
  let delayMs = 3000; // 3秒スタート
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await delay(delayMs);
      await client.pushMessage(userId, messages);
      console.log(`pushMessage成功！試行:${attempt}`);
      return;
    } catch (err) {
      console.error(`pushMessage失敗 リトライ残り:${maxRetries - attempt} エラー:`, err.message || err);
      if (attempt === maxRetries) throw err;
      delayMs *= 2; // 失敗したら待機時間を倍にする
    }
  }
}

function formatKeyStatusText() {
  return ['研究室', '実験室'].map(area => `${area}：${keyStatus[area]}`).join('\n');
}

function createYesNoQuickReply(area) {
  return {
    type: 'text',
    text: `${area}の鍵を返す？`,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'postback', label: 'はい', data: `return_${area}` } },
        { type: 'action', action: { type: 'postback', label: 'いいえ', data: 'return_なし' } },
      ],
    },
  };
}

function createMultiKeyReturnTemplate() {
  return {
    type: 'template',
    altText: 'どの鍵を返しますか？',
    template: {
      type: 'buttons',
      text: 'どの鍵を返しますか？',
      actions: [
        { type: 'postback', label: '研究室', data: 'return_研究室' },
        { type: 'postback', label: '実験室', data: 'return_実験室' },
        { type: 'postback', label: '両方', data: 'return_両方' },
        { type: 'postback', label: '返さない', data: 'return_なし' },
      ],
    },
  };
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
    await delay(1500);
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ステータスを選択',
      quickReply,
    }).catch(console.error);
    return;
  }

  if (data === 'show_key_status') {
    return handleShowKeyStatus(event);
  }

  if (data === 'show_all_members') {
    return handleShowAllMembers(event);
  }

  if (data.startsWith('return_')) {
    const area = data.replace('return_', '');
    return handleReturnKey(event, area);
  }

  if (AREAS.includes(data)) {
    return handleStatusChangeFlow(event, data);
  }
}

async function handleStatusChangeFlow(event, newStatus) {
  const userId = event.source.userId;
  const profile = await client.getProfile(userId);
  members[userId] = { name: profile.displayName, status: newStatus };

  const prevKeyStatus = { ...keyStatus };
  recalcKeyStatus();

  // ステータス変更通知（全員に送る）
  const statusMessage = { type: 'text', text: `ステータスを「${newStatus}」に更新したよ！` };

  // 鍵の状態が変わったら鍵状況も全員に送る
  const keyChanged = ['研究室', '実験室'].some(area => prevKeyStatus[area] !== keyStatus[area]);
  const messages = [statusMessage];
  if (keyChanged) {
    messages.push({
      type: 'text',
      text: `【🔐 鍵の状態変更】\n${formatKeyStatusText()}`,
    });
  }

  // 全員にまとめて送る
  const allUserIds = Object.keys(members);
  await delay(1500);
  await client.multicast(allUserIds, messages);

  // △が出たらその人に鍵返すか確認
  const areasToPrompt = ['研究室', '実験室'].filter(area => keyStatus[area] === '△');
  if (areasToPrompt.length === 1) {
    await delay(1500);
    await pushMessageWithRetry(userId, createYesNoQuickReply(areasToPrompt[0]));
  } else if (areasToPrompt.length === 2) {
    await delay(1500);
    await pushMessageWithRetry(userId, createMultiKeyReturnTemplate());
  }
}

async function handleReturnKey(event, data) {
  const userId = event.source.userId;
  let prefixText = null;

  if (data === 'なし') {
    prefixText = '鍵の管理よろしくね！';
  } else {
    if (data === '研究室' || data === '両方') {
      keyStatus['研究室'] = '×';
    }
    if (data === '実験室' || data === '両方') {
      keyStatus['実験室'] = '×';
    }
  }

  recalcKeyStatus();
  const messages = [];
  if (prefixText) messages.push({ type: 'text', text: prefixText });
  messages.push({
    type: 'text',
    text: `【🔐 鍵の状態変更】\n${formatKeyStatusText()}`,
  });

  const allUserIds = Object.keys(members);
  await delay(1500);
  await client.multicast(allUserIds, messages);
}

async function sendKeyStatusUpdate(userId, newStatus, prevKeyStatus, replyToken = null, prefixText = null, sendStatusUpdate = true) {
  const keyChanged = prevKeyStatus
    ? ['研究室', '実験室'].some(area => prevKeyStatus[area] !== keyStatus[area])
    : false;

  const messages = [];
  if (prefixText) messages.push({ type: 'text', text: prefixText });
  if (sendStatusUpdate && newStatus) messages.push({ type: 'text', text: `ステータスを「${newStatus}」に更新` });

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

  await delay(1500);
  if (replyToken) {
    await client.replyMessage(replyToken, messages);
  } else {
    await pushMessageWithRetry(userId, messages);
  }

  if (keyChanged) {
    setTimeout(() => {
      (async () => {
        const otherUserIds = Object.keys(members).filter(id => id !== userId);
        if (otherUserIds.length === 0) return;
        const multicastMsg = [{
          type: 'text',
          text: `【🔐 鍵の状態変更】\n${formatKeyStatusText()}`,
        }];
        await delay(1500);
        try {
          await client.multicast(otherUserIds, multicastMsg);
          console.log('Multicast送信成功！');
        } catch (e) {
          console.error('Multicast送信失敗:', e.response?.data || e);
        }
      })().catch(e => {
        console.error('setTimeout内での例外:', e);
      });
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

  await delay(1500);
  if (areasToPrompt.length === 0) {
    return client.replyMessage(event.replyToken, { type: 'text', text });
  }

  if (areasToPrompt.length === 1) {
    return client.replyMessage(event.replyToken, [
      { type: 'text', text },
      createYesNoQuickReply(areasToPrompt[0]),
    ]).catch(console.error);
  } else {
    return client.replyMessage(event.replyToken, [
      { type: 'text', text },
      createMultiKeyReturnTemplate(),
    ]).catch(console.error);
  }
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

  await delay(1500);
  return client.replyMessage(event.replyToken, { type: 'text', text });
}

const cron = require('node-cron');
cron.schedule('0 4 * * *', () => {
  console.log('🔄 4時だよ！全員のステータスを「学外」にするよ！');
  for (const userId in members) {
    members[userId].status = '学外';
  }
});

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
