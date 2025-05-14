if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
} // これが最初に必要です

const express = require('express');
const bodyParser = require('body-parser');
const { Client } = require('@line/bot-sdk');

// express.json()を使ってリクエストボディのパースを行う
const app = express();
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new Client(config);

console.log('🔐 LINE設定:', config); // ←追加！

// ログ出力を追加
app.post('/webhook', (req, res) => {
    console.log('Webhook received'); // ここでリクエスト受信を確認
    Promise.all(req.body.events.map(handleEvent))
        .then(() => res.sendStatus(200))
        .catch(err => {
            console.error(err);
            res.sendStatus(500);
        });
});

function handleEvent(event) {
    console.log('Handling event:', event);  // イベントをログに表示
    if (event.type === 'message' && event.message.type === 'text') {
        console.log('ReplyToken:', event.replyToken); // replyTokenの確認
        client.replyMessage(event.replyToken, {
            type: 'text',
            text: `メッセージを受け取ったよ: ${event.message.text}`
        })
            .then(() => {
                console.log('Reply sent successfully');
            })
            .catch((err) => {
                console.error('Error in sending reply:', err);
            });
    }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`LINE Bot is running on port ${port}`);
});
