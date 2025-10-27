# 💸 Real-Time International Transfers - ChatGPT App

ChatGPT app for international money transfers with **LIVE exchange rates** and beautiful UI.

## ✨ Features

- 🌍 **Real-time exchange rates** from exchangerate-api.com
- 💳 **Beautiful transfer receipts** with interactive UI
- 📊 **Live rate cards** with gradient designs
- 🔄 **Auto-updates** every hour
- 💰 **Fee calculations** (1.5%, min $2.99, max $50)

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd transfers_server_node
pnpm install
```

### 2. Start the Server
```bash
pnpm start
```

Server runs on `http://localhost:8000`

### 3. Expose with ngrok
```bash
ngrok http 8000
```

Copy the ngrok URL (e.g., `https://abc123.ngrok-free.app`)

### 4. Add to ChatGPT

1. Open ChatGPT
2. Go to **Settings → Connectors → Advanced**
3. Toggle **Developer Mode**
4. Click **Add Connector**
5. Paste: `https://your-ngrok-url.ngrok-free.app/mcp`
6. Click **Add**

### 5. Test It!

In ChatGPT, try:
- "Send $100 to Mexico"
- "What's the exchange rate from USD to MXN?"
- "Send $500 to Maria Garcia in Guatemala"

## 🎨 UI Components

### Transfer Receipt
- Gradient purple background
- Clean white card design
- Status badges (pending/processing/completed)
- All transfer details
- Professional receipt layout

### Exchange Rate Card
- Blue gradient background  
- Large rate display
- Real-time timestamp
- Currency indicators

## 🔧 How It Works

1. **Fetches real exchange rates** from exchangerate-api.com
2. **Caches for 1 hour** to avoid rate limiting
3. **Generates HTML widgets** dynamically
4. **Returns structured data** + UI to ChatGPT
5. **ChatGPT renders** the widget inline in chat

## 📡 API Endpoints

- `GET /mcp` - SSE stream for ChatGPT
- `POST /mcp/messages` - Message handling

## 🌟 Supported Currencies

- USD → MXN (Mexico)
- USD → GTQ (Guatemala)
- USD → HND (Honduras)
- USD → DOP (Dominican Republic)
- Any currency pair available from exchangerate-api

## 💡 Tips

- Keep ngrok running while testing
- Check server logs for debugging
- Exchange rates update every hour
- Free tier has no API key needed!

## 🛠 Development

```bash
# Watch mode for auto-reload
pnpm dev
```

## 🎯 Next Steps

- Add OAuth authentication
- Connect to real payment rails (Thunes, Wise)
- Add transaction history
- Support more currencies
- Add transfer tracking
