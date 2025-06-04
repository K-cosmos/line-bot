import os
from PIL import Image, ImageDraw, ImageFont

# フォントとサイズ
FONT_PATH = 'C:/Windows/Fonts/YuGothic.ttc'
FONT_SIZE = 96
IMG_WIDTH = 2500
IMG_HEIGHT = 1696

# 出力フォルダ
OUTPUT_DIR = 'output_images'
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 背景画像の読み込み（背景画像はこのファイルと同じ場所に "background.png" として置いてね）
BACKGROUND_IMAGE_PATH = 'background.png'
background = Image.open(BACKGROUND_IMAGE_PATH).convert('RGB')

# フォント読み込み
font = ImageFont.truetype(FONT_PATH, FONT_SIZE)

# テキスト描画（擬似太字対応）
def draw_text(draw, position, text, bold=False):
    x, y = position
    if bold:
        draw.text((x, y), text, font=font, fill='black')
        draw.text((x + 2, y + 2), text, font=font, fill='black')
    else:
        draw.text((x, y), text, font=font, fill='black')

# 状態ごとのテキストパーツ生成
def presence_pair(status): return [status, 'いない' if status == 'いる' else 'いる']
def symbol_pair(main): return [main] + [s for s in ['○', '△', '×'] if s != main][:2]
def onoff_pair(onoff): return [onoff, 'ＯＦＦ' if onoff == 'ＯＮ' else 'ＯＮ']

# 条件の組み合わせ
statuses = ['研究室', '実験室', '学内', '学外']
presence_options = [(a, b, c) for a in ['いる', 'いない'] for b in ['いる', 'いない'] for c in ['いる', 'いない']]
symbol_options = [(a, b) for a in ['○', '△', '×'] for b in ['○', '△', '×']]
on_off_options = ['ＯＮ', 'ＯＦＦ']

# 全576通り生成
for status in statuses:
    for presence in presence_options:
        for symbols in symbol_options:
            for on_off in on_off_options:

                # 背景コピーと描画準備
                img = background.copy()
                draw = ImageDraw.Draw(img)

                # テキスト行構成
                lines = [
                    ['研究室'] + presence_pair(presence[0]) + symbol_pair(symbols[0]),
                    ['実験室'] + presence_pair(presence[1]) + symbol_pair(symbols[1]),
                    ['学内'] + presence_pair(presence[2]) + ['', '', '通知'],
                    ['学外', '', '詳細表示'] + onoff_pair(on_off) + ['']
                ]

                # 描画位置の調整
                y_offset = (IMG_HEIGHT - (len(lines) * FONT_SIZE * 1.5)) // 2
                for i, line in enumerate(lines):
                    line_width = sum([font.getbbox(w)[2] for w in line])
                    x = (IMG_WIDTH - line_width) // 2
                    y = y_offset + int(i * FONT_SIZE * 1.5)
                    for word in line:
                        bold = word == status or word in presence or word in symbols or word == on_off
                        draw_text(draw, (x, y), word, bold)
                        x += font.getbbox(word)[2]

                # ファイル名生成
                val1 = 1 if presence[0] == 'いる' else 0  # 研究室
                val2 = 1 if presence[1] == 'いない' else 0  # 実験室
                val3 = 1 if presence[2] == 'いる' else 0  # 学内
                filename = f"{status}_{symbols[0]}_{symbols[1]}_{val1}_{val2}_{val3}_{on_off}.png"
                img.save(os.path.join(OUTPUT_DIR, filename))
