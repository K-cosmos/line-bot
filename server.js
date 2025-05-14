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

// メンバーの状態
const members = {};  // userId -> ステータス
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

// ステータス変更
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
    updateKeyStatus(); // 鍵の状態を更新
    return sendStatusButtons(event.replyToken, `ステータスを「${newStatus}」に更新しました。`);
}

// 鍵の状態を更新し、必要なら送信
function updateKeyStatus() {
    let messages = [];
    let keyStatusChanged = false;

    // 研究室と実験室の鍵の状態をチェック
    for (const area of ['研究室', '実験室']) {
        const inArea = Object.entries(members).filter(([_, s]) => s === area);
        const allOutside = Object.values(members).every(s => s === '学外');

        let newStatus = keyStatus[area]; // 変更後の鍵の状態
        if (inArea.length > 0) {
            newStatus = '〇'; // 誰かがその部屋にいる場合
        } else if (!allOutside) {
            // 誰もいない場合、かつ学内や実験室にいる人がいる場合
            if (keyStatus[area] === '×') {
                // 鍵が一度×になった場合、そのまま×のままで維持
                continue;
            }
            newStatus = '△'; // 鍵の状態を保留にする
        } else {
            // 全員が学外の場合、鍵は×に
            newStatus = '×';
        }

        if (keyStatus[area] !== newStatus) {
            keyStatus[area] = newStatus;
            messages.push(`${area}：${newStatus}`);
            keyStatusChanged = true;
        }
    }

    // 鍵の状態が変更された場合のみ通知
    if (keyStatusChanged) {
        broadcastKeyStatus(messages.join('\n'));
    }
}

// △時に「鍵返しますか？」と確認
function promptReturnKey(userId, area) {
    client.pushMessage(userId, {
        type: 'template',
        altText: '鍵を返しますか？',
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

// Yes/No回答処理
function handleReturnKey(event) {
    const userId = event.source.userId;
    const data = event.postback.data;

    const [_, response, area] = data.split('_');
    if (!['研究室', '実験室'].includes(area)) return;

    // 鍵の返却処理
    if (response === 'yes') {
        keyStatus[area] = '×';
    } else {
        keyStatus[area] = '△';
    }

    // 鍵の状態更新後、全員に通知
    broadcastKeyStatus(`${area}：${keyStatus[area]}`);

    // 最後に次のメニューを表示
    return sendStatusButtons(event.replyToken, `鍵の返却：${response === 'yes' ? 'しました' : 'しませんでした'}`);
}

// 鍵の状態を全員に通知
function broadcastKeyStatus(message) {
    Object.keys(members).forEach(userId => {
        client.pushMessage(userId, {
            type: 'text',
            text: `🔐 鍵の状態\n${message}`
        }).catch(err => {
            console.error(`通知送信失敗（${userId}）:`, err);
        });
    });
}

// △時に「鍵返しますか？」と確認
function promptReturnKey(userId, area) {
    client.pushMessage(userId, {
        type: 'text',
        text: `${area}の鍵を返しますか？`  // ボタンを表示せず、テキストだけで質問
    }).catch(err => {
        console.error(`鍵返却確認の送信に失敗: ${err}`);
    });
}

// ステータス選択ボタン送信
function sendStatusButtons(replyToken, msg = 'ステータスを選択してください：') {
    const actions = areas.map(area => ({
        type: 'postback',
        label: area,
        data: area
    }));

    return client.replyMessage(replyToken, {
        type: 'template',
        altText: msg,  // ボタンが表示されない場合の代替テキスト
        template: {
            type: 'buttons',
            text: msg,
            actions: actions
        }
    }).catch((err) => {
        console.error('Error sending status buttons:', err);
    });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`LINE Bot is running on port ${port}`);
});
