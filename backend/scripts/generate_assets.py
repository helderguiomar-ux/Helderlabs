from PIL import Image, ImageDraw, ImageFont
import os

def create_og_image(output_path):
    width, height = 1200, 630
    img = Image.new('RGB', (width, height), color='#e9ece7')
    draw = ImageDraw.Draw(img)

    # Draw engineering grid background
    grid_color = '#d8ded7'
    for x in range(0, width, 30):
        draw.line([(x, 0), (x, height)], fill=grid_color, width=1)
    for y in range(0, height, 30):
        draw.line([(0, y), (width, y)], fill=grid_color, width=1)

    # Card background
    card_margin_x, card_margin_y = 80, 60
    draw.rectangle(
        [card_margin_x, card_margin_y, width - card_margin_x, height - card_margin_y],
        fill='#f7f8f5',
        outline='#bcc4bb',
        width=3
    )

    # Try loading fonts or fallback to default
    try:
        font_title = ImageFont.truetype("arial.ttf", 52)
        font_sub = ImageFont.truetype("arial.ttf", 26)
        font_logo = ImageFont.truetype("arial.ttf", 44)
        font_badge = ImageFont.truetype("arial.ttf", 20)
    except:
        font_title = font_sub = font_logo = font_badge = ImageFont.load_default()

    # Draw Badge
    draw.rectangle([130, 110, 310, 145], fill='#17408b')
    draw.text((145, 117), "HELDERLABS.EU", fill='#ffffff', font=font_badge)

    # Draw Logo / Header
    draw.text((130, 175), "HELDERLABS ERP", fill='#17408b', font=font_logo)

    # Title
    draw.text((130, 255), "Informatizar não é coisa", fill='#191e1b', font=font_title)
    draw.text((130, 320), "de empresa grande.", fill='#a32b1c', font=font_title)

    # Subtitle
    draw.text((130, 410), "Sistemas simples, modulares e seguros para pequenas empresas.", fill='#4e5a54', font=font_sub)
    draw.text((130, 450), "CRM • Condomínios • Finanças • Gestão Integrada", fill='#17408b', font=font_sub)

    # Red underline decoration
    draw.line([(130, 380), (520, 380)], fill='#a32b1c', width=5)

    img.save(output_path, 'PNG')
    print(f"[OK] Generated asset: {output_path}")

def create_favicon(size, output_path, is_ico=False):
    img = Image.new('RGBA', (size, size), color=(0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background circle/rounded rect
    margin = int(size * 0.05)
    draw.rounded_rectangle([margin, margin, size - margin, size - margin], radius=int(size*0.2), fill='#17408b')

    # Draw 'H' logo in white
    try:
        font_size = int(size * 0.6)
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        font = ImageFont.load_default()

    # Center 'H'
    text = "H"
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (size - w) / 2
    y = (size - h) / 2 - bbox[1]

    draw.text((x, y), text, fill='#ffffff', font=font)

    if is_ico:
        img.save(output_path, format='ICO', sizes=[(16,16), (32,32), (48,48)])
        print(f"[OK] Generated favicon ICO: {output_path}")
    else:
        img.save(output_path, 'PNG')
        print(f"[OK] Generated favicon PNG ({size}x{size}): {output_path}")

if __name__ == '__main__':
    public_dir = os.path.abspath('C:/Users/helde/Desktop/Dev/helderlabs-erp/backend/public')
    img_dir = os.path.join(public_dir, 'assets', 'img')
    os.makedirs(img_dir, exist_ok=True)

    create_og_image(os.path.join(img_dir, 'og-image.png'))

    create_favicon(32, os.path.join(public_dir, 'favicon.ico'), is_ico=True)
    create_favicon(180, os.path.join(public_dir, 'apple-touch-icon.png'))
    create_favicon(192, os.path.join(public_dir, 'android-chrome-192x192.png'))
    create_favicon(512, os.path.join(public_dir, 'android-chrome-512x512.png'))
