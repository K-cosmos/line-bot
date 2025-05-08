const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const LINE_REPLY_API = 'https://api.line.me/v2/bot/message/reply';

app.use(bodyParser.json());

app.post('/webhook', async (req, res) => {
    const events = req.body.events;

    for (const event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userMessage = event.message.text;

            await axios.post(LINE_REPLY_API, {
                replyToken,
                messages: [
                    { type: 'text', text: `あなたのメッセージ: ${userMessage}` }
                ]
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
                }
            });
        }
    }

    res.sendStatus(200);
});

app.get('/', (req, res) => res.send('LINE Bot is running'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
