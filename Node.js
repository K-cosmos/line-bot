import fs from "fs";
import path from "path";
import { Client } from "@line/bot-sdk";

const client = new Client({
    channelAccessToken: process.env.LINE_ACCESS_TOKEN
});

// 画像フォルダパス
const imagesDir = "./Richmenu";

// 画像ファイル名からリッチメニュー設定を返す関数（例として共通設定）
function getRichMenuConfig(fileName) {
    return {
        size: { width: 2500, height: 1686 },
        selected: true,
        name: `RichMenu for ${fileName}`,
        chatBarText: "メニューを開く",
        areas: [
            { bounds: { x: 0, y: 1280, width: 833, height: 128 }, action: { type: "postback", data: "btn:status1" } },
            { bounds: { x: 0, y: 1408, width: 833, height: 128 }, action: { type: "postback", data: "btn:status2" } },
            // …必要なエリア設定をここに書いておく…
        ]
    };
}

async function createAllRichMenus() {
    const imageFiles = fs.readdirSync(imagesDir).filter(file => file.endsWith(".png"));

    for (const file of imageFiles) {
        const filePath = path.join(imagesDir, file);
        const richMenuConfig = getRichMenuConfig(file);

        try {
            const richMenuId = await client.createRichMenu(richMenuConfig);
            console.log(`✅ ${file} → RichMenu作成完了！ID: ${richMenuId}`);

            await client.setRichMenuImage(richMenuId, fs.createReadStream(filePath));
            console.log(`✅ ${file} → 画像アップロード完了！`);

            // 必要なら、ここで別ファイルにIDを保存するといいよ！
            // 例: fs.appendFileSync("richmenu_ids.txt", `${file}: ${richMenuId}\n`);
        } catch (err) {
            console.error(`❌ ${file}でエラー:`, err);
        }
    }
}

async function createRichMenu() {
    const richMenu = {
        size: {
            width: 2500,
            height: 1686
        },
        selected: true,
        name: "研究室Botメニュー",
        chatBarText: "メニューを開く",
        areas: [
            { bounds: { x: 0, y: 1280, width: 833, height: 128 }, action: { type: "postback", data: "btn:status1" } },
            { bounds: { x: 0, y: 1408, width: 833, height: 128 }, action: { type: "postback", data: "btn:status2" } },
            { bounds: { x: 0, y: 1536, width: 833, height: 128 }, action: { type: "postback", data: "btn:status3" } },
            { bounds: { x: 833, y: 1280, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab1" } },
            { bounds: { x: 833, y: 1408, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab2" } },
            { bounds: { x: 833, y: 1536, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab3" } },
            { bounds: { x: 1666, y: 1280, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab4" } },
            { bounds: { x: 1666, y: 1408, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab5" } },
            { bounds: { x: 1666, y: 1536, width: 833, height: 128 }, action: { type: "postback", data: "btn:lab6" } },
            { bounds: { x: 1666, y: 1664, width: 833, height: 128 }, action: { type: "postback", data: "btn:detail" } }
        ]
    };

    const richMenuId = await client.createRichMenu(richMenu);
    console.log("リッチメニュー作成完了！ID:", richMenuId);

    const imagePath = path.resolve("./richmenu.png");
    await client.setRichMenuImage(richMenuId, fs.createReadStream(imagePath));
    console.log("画像アップロード完了！");
}

createRichMenu().catch(console.error);
