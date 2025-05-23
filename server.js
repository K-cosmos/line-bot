// server.js
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const fs = require('fs');
const { Client } = require('@line/bot-sdk');

const cron = require('node-cron');

const app = express();
app.use(express.json());

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new Client(config);

// メンバー状態と鍵状態
const members = {};  // userId -> status
const keyStatus = {
    '研究室': '×',
    '実験室': '×'
};

const areas = ['研究室', '実験室', '学内', '学外'];

app.post('/webhook', (req, res) => {
    Promise.all(req.body.events.map(handleEvent))
        .then(() => res.sendStatus(200))
        .catch(err => {
            console.error(err);
            res.sendStatus(500);
        });
});

function handleEvent(event) {
    if (event.type === 'postback') {
        const data = event.postback.data;

        if (data === 'open_status_menu') {
            return sendStatusButtons(event.replyToken);
        }

        if (data === 'show_key_status') {
            const text = `🔐 鍵の状態\n研究室：${keyStatus['研究室']}\n実験室：${keyStatus['実験室']}`;
        
            // 鍵が△の部屋をチェック（最初の1個だけ対象にする）
            const promptArea = ['研究室', '実験室'].find(area => keyStatus[area] === '△');
        
            if (promptArea) {
                // ユーザーに確認メッセージ送る → ステータスボタンも忘れずに
                return Promise.all([
                    client.replyMessage(event.replyToken, { type: 'text', text }),
                    promptReturnKey(event.source.userId, promptArea),
                    sendStatusButtonsToUser(event.source.userId)
                ]);
            }
        
            // △なかったらそのままメッセージ送信
            return client.replyMessage(event.replyToken, { type: 'text', text });
        }

        if (data === 'show_all_members') {
            const statusGroups = {};

            // 場所ごとにまとめる（学外はスキップ）
            Object.values(members).forEach(info => {
                if (info.status === '学外') return;
                if (!statusGroups[info.status]) {
                    statusGroups[info.status] = [];
                }
                statusGroups[info.status].push(info.name);
            });

            // 表示用の整形
            const text = areas
                .filter(area => area !== '学外' && statusGroups[area])
                .map(area => `${area}\n${statusGroups[area].map(name => `・${name}`).join('\n')}`)
                .join('\n\n') || '全員学外です。';

            return client.replyMessage(event.replyToken, { type: 'text', text });
        }

        // 🔑 鍵返却の確認（例：return_yes_研究室）
        if (data.startsWith('return_')) {
            return handleReturnKey(event);
        }

        // ✅ ステータス変更（研究室/実験室/学内/学外）
        return handleStatusChange(event);
    }

    return Promise.resolve(null);
}

function handleStatusChange(event) {
    const userId = event.source.userId;
    const newStatus = event.postback.data;

    if (!areas.includes(newStatus)) {
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: '無効なステータスです。'
        });
    }

    // ユーザー情報取得 & 更新
    return client.getProfile(userId)
        .then(profile => {
            members[userId] = {
                name: profile.displayName,
                status: newStatus
            };
            console.log(`[変更] ${profile.displayName}(${userId}) → ステータスを「${newStatus}」に変更`);
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: `ステータスを「${newStatus}」に更新`
            });
        })

        .then(() => updateKeyStatus(userId))
        .catch(err => console.error('handleStatusChange error:', err));
}

function updateKeyStatus(changedUserId) {
    const statusMessages = [];
    let promptArea = null;

    for (const area of ['研究室', '実験室']) {
        const beforeStatus = keyStatus[area];
        const inArea = Object.values(members).filter(info => info.status === area);
        const allOutside = Object.values(members).every(info => info.status === '学外');

        let newStatus;

        if (inArea.length > 0) {
            newStatus = '〇';
        } else if (allOutside) {
            newStatus = '×';
        } else if (beforeStatus !== '×') {
            newStatus = '△';
        } else {
            newStatus = '×'; // 追加！
        }

        if (beforeStatus !== newStatus) {
            console.log(`[鍵更新] ${area}：${beforeStatus} → ${newStatus}`);
        }
    
        if (beforeStatus === '〇' && newStatus === '△') {
            console.log(`[確認必要] ${area}の鍵が△になったため確認対象`);
            promptArea = area;
        }

        keyStatus[area] = newStatus;
        statusMessages.push(`${area}：${newStatus}`);
    }

    const statusText = `🔐 鍵の状態\n${statusMessages.join('\n')}`;
    broadcastKeyStatus(statusText);

    // △になったエリアがあれば確認する
    // △になったエリアがあれば確認する（複数あるかも！）
    if (changedUserId) {
        const areasToPrompt = [];
    
        for (const area of ['研究室', '実験室']) {
            if (keyStatus[area] === '△') {
                areasToPrompt.push(area);
        }
    }

    // △のエリアが複数ある場合に遅延して送る例
    if (areasToPrompt.length === 1) {
        return promptReturnKey(changedUserId, areasToPrompt[0], 0);  // 遅延0ms
    }
    
    if (areasToPrompt.length === 2) {
        return Promise.all([
            promptReturnKey(changedUserId, '研究室', 0),
            promptReturnKey(changedUserId, '実験室', 1000)
        ]);
    }
}
return Promise.resolve();    
}

// 1人に鍵返却確認メッセージを送る処理（もし複数連続で呼ばれるなら遅延を追加できる）
function promptReturnKey(userId, area, delay = 0) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            console.log(`[送信] ${userId} に「${area}の鍵を返しますか？」メッセージ送信（delay=${delay}ms）`);
            client.pushMessage(userId, {
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
            }).then(resolve)
              .catch(err => {
                console.error(`鍵返却確認の送信に失敗: ${err}`);
                reject(err);
              });
        }, delay);
    });
}

function handleReturnKey(event) {
    const userId = event.source.userId;
    const data = event.postback.data;
    const [_, response, area] = data.split('_');

    if (area === '両方') {
        ['研究室', '実験室'].forEach(a => {
            keyStatus[a] = response === 'yes' ? '×' : '△';
        });
    } else if (['研究室', '実験室'].includes(area)) {
        keyStatus[area] = response === 'yes' ? '×' : '△';
    }

    broadcastKeyStatus(`🔐 鍵の状態\n研究室：${keyStatus['研究室']}\n実験室：${keyStatus['実験室']}`);

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `鍵の返却：${response === 'yes' ? 'しました' : 'しませんでした'}`
    }).then(() => sendStatusButtonsToUser(userId));
}

// 複数鍵返却確認メニュー（ボタン）も遅延対応可能に
function promptMultipleReturnKey(userId, delay = 0) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            client.pushMessage(userId, {
                type: 'template',
                altText: '鍵を返しますか？',
                template: {
                    type: 'buttons',
                    text: 'どの鍵を返す？',
                    actions: [
                        { type: 'postback', label: '研究室の鍵を返す', data: 'return_yes_研究室' },
                        { type: 'postback', label: '実験室の鍵を返す', data: 'return_yes_実験室' },
                        { type: 'postback', label: '両方返す', data: 'return_yes_両方' }
                    ]
                }
            }).then(resolve)
              .catch(err => {
                console.error(`鍵返却（複数）確認の送信に失敗: ${err}`);
                reject(err);
              });
        }, delay);
    });
}

function sendStatusButtonsToUser(userId) {
    console.log(`[送信] ${userId} にステータスボタンを送信`);
    return client.pushMessage(userId, {
        type: 'template',
        altText: 'ステータスを選択:',
        template: {
            type: 'buttons',
            text: 'ステータスを選択：',
            actions: areas.map(area => ({
                type: 'postback',
                label: area,
                data: area
            }))
        }
    }).catch(err => console.error('sendStatusButtonsToUser error:', err));
}

function sendStatusButtons(replyToken) {
    return client.replyMessage(replyToken, {
        type: 'template',
        altText: 'ステータスを選択:',
        template: {
            type: 'buttons',
            text: 'ステータスを選択：',
            actions: areas.map(area => ({
                type: 'postback',
                label: area,
                data: area
            }))
        }
    }).catch(err => console.error('sendStatusButtons error:', err));
}

function broadcastKeyStatus(message) {
    const userIds = Object.keys(members);
    userIds.forEach((userId, i) => {
        const logMessage = `[通知] ${userId} に鍵状況を送信（${message}）`;
        console.log(logMessage);
        setTimeout(() => {
            client.pushMessage(userId, {
                type: 'text',
                text: message
            }).catch(err => console.error(`通知送信失敗（${userId}）:`, err));
        }, i * 1000);
    });
}

function resetAllStatusesToOutside() {
    console.log('午前4時になったので全員のステータスを「学外」にリセットします');

    Object.keys(members).forEach(userId => {
        members[userId].status = '学外';
    });

    // 鍵の状態も更新
    updateKeyStatus(null);
}

// 毎日午前4時に実行（日本時間）
// 0 4 * * * は「毎日4時0分」の意味（UTCじゃないからタイムゾーン指定必須）
cron.schedule('0 4 * * *', () => {
    resetAllStatusesToOutside();
}, {
    scheduled: true,
    timezone: "Asia/Tokyo"  // 日本時間でスケジューリング
});

app.get('/', (req, res) => {
    res.send('LINE Bot is alive!');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`LINE Bot is running on port ${port}`);
});
