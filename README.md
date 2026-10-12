# Flipkart Product Availability Monitor (Size & Color Watcher)

Automated 24/7 Playwright monitoring system that checks **Flipkart** for a specific product, color swatch, and shoe/apparel size, and triggers continuous multi-channel alerts the instant your size comes back in stock.

---

## 🎯 Configured Target Product

- **Product:** `WOODLAND Slip On Lightweight Comfortable Easy Wear Casuals For Men`
- **Target Color:** `DNAVY 4` (`pid=SHOFXHQCVGM4NRCE`)
- **Target Size:** `7`
- **Flipkart URL:**
  `https://www.flipkart.com/woodland-slip-lightweight-comfortable-easy-wear-casuals-men/p/itm28c3d46f85a6c?pid=SHOFXHQCVGM4NRCE&marketplace=FLIPKART&lid=LSTSHOFXHQCVGM4NRCENSXFFB`

---

## 🔍 How Stock Detection Works

On every check cycle (default: every `5 seconds`), the monitor inspects three layers of Flipkart's DOM:

1. **Color Swatch Div (`<a href*="pid=...">`)**:
   - Checks if the selected color (`DNAVY 4`) has the `"Out of stock"` overlay badge (`.v1zwn221` / `_7dzyg22` / `_7dzyg2r`).
2. **Size Swatch Divs (`<a href*="swatchAttr=size">`)**:
   - Inspects all sizes (`5`, `6`, `7`, `8`, `9`, `10`, `11`) and specifically **Size `7`**:
     - **Out of Stock markers:** Dashed border (`_1o6mltlk6`), gray overlay (`_7dzyg24z` / `rgba(0, 0, 0, 0.06)`), horizontal strikethrough bar (`_7dzyg21s` / `rgb(214, 214, 214)`), and muted gray text (`v1zwn21o`).
     - **In Stock markers:** Solid border (`_1o6mltlk4`), transparent overlay (`_7dzyg24y`), no strikethrough bar, and dark active text (`v1zwn21n`).
3. **Page Action Buttons**:
   - Verifies whether the page shows **"Notify Me"** / **"Currently Unavailable"** (Out of Stock) vs **"Add to cart"** / **"Buy Now"** / **"Buy at ₹..."** (In Stock).

---

## 🚀 Quick Start

### 1. Run Live Flipkart Monitor
```bash
npm start
```

### 2. Run Mock Simulation (`--dry-run`)
Simulates the Flipkart product starting **Out of Stock** for Size 7 and transitioning to **In Stock** after 5 seconds:
```bash
npm run dev
```

---

## 🛑 How to Stop Continuous Alerts Once In Stock

When **Size 7** becomes available, continuous alerts fire every `2 seconds` (`ALERT_INTERVAL_SECONDS=2`). You can silence them anytime via:
1. **Console:** Type `stop` (or `s`, `q`) + **[Enter]**
2. **Mobile `ntfy` App:** Tap **[🛑 Stop Alerts]** on the notification or send `stop` to topic `bms-movie-monitor-alerts`
3. **Browser:** Open `http://localhost:3000/stop`
4. **Keyboard:** Press `Ctrl+C` once (silences alerts while keeping the Flipkart browser window open so you can checkout!)
