const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

app.post('/webhook', (req, res) => {
    console.log('Webhook received:', req.body.events);

    // LINE�v���b�g�t�H�[������̊m�F�p�ɕK��200��Ԃ��I
    res.sendStatus(200);
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
