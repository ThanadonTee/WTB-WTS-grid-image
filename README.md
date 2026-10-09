# WTB/WTS Grid Maker

Make clean **WTS / WTB / WTT** card grid images for Facebook groups, with no image editor needed.

Add your card photos, type in each card's rarity and price, then export a PNG or JPG that's ready to post.

## Features

- **Add cards fast**: pick several photos at once, drag and drop them, paste with Ctrl/⌘+V, or paste an image link.
- **Card-first layout**: cards fill the grid with thin gaps. Rarity and price are tags on each card's bottom corners, and quantity sits top-right.
- **Per-card details**: rarity (colour-coded for Vanguard's RRR, SP, OR, SEC… and other games' SAR, SIR, UR, Alt Art…), price, quantity, plus an optional name and note shown as a caption under the card.
- **Mark as sold or found**: puts a stamp over the card, so you can repost an updated list.
- **Post header and footer**: WTS / WTB / WTT / WTS-WTT / WTB-WTS label, a title, notes (shipping, payment), and your contact details.
- **Card shape**: "Match my images" (the default) uses your uploads' own shape, so official scans like Vanguard's 350×510 are never cropped. Fixed Vanguard, standard 63×88, graded slab and square shapes are also available.
- **Layout**: automatic or fixed columns, fill or fit photos, and rotation for sideways phone shots.
- **Font**: [Kanit](https://fonts.google.com/specimen/Kanit) for Thai and English. Japanese text uses your system font.
- **Themes**: six colour themes plus a custom price colour, and a currency symbol placed before or after the number.
- **Split big lists** into several images (e.g. 9 or 12 cards each) so Facebook doesn't shrink one huge image. Each image is numbered 1/3, 2/3…
- **Export** at up to 3000 px wide (2048 px is Facebook's sweet spot). Then download, copy to the clipboard and paste into a post, or share directly from your phone.
- **Auto-save**: your work, including images, is kept in your browser, so a refresh doesn't lose anything. Nothing is uploaded anywhere.

## Use it

It's a static site with no build step and no dependencies.

- **Locally:** open `index.html` in a browser.
- **GitHub Pages:** in the repository go to *Settings → Pages*, set *Source* to "Deploy from a branch", pick the branch and `/ (root)`, and save. The app will be live at `https://<user>.github.io/<repo>/`.

## How it works

| File | Purpose |
| --- | --- |
| `index.html` | Page markup |
| `css/styles.css` | App styling (light/dark, mobile layout) |
| `js/render.js` | Draws a grid page on a `<canvas>`. The preview and the export use the same code, so what you see is what you get. |
| `js/app.js` | Editor UI, adding images, pagination, export / copy / share |
| `js/storage.js` | Small IndexedDB wrapper for auto-save |

Large photos are scaled down to 2000 px on import to keep things fast.
