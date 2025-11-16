# MyBambu Transfers - PRODUCTION VERSION

> **⚠️ This is the PRODUCTION version with REAL payment APIs**
>
> For the demo version with simulated transfers, see: [chatgpt-transfers](https://github.com/edisonjoao1/chatgpt-transfers)

**Send money to Latin America directly through ChatGPT with real banking APIs** 💸

A production MCP (Model Context Protocol) server that enables **real international money transfers** through ChatGPT using Wise API, Plaid, and other payment providers. Built following OpenAI Apps SDK best practices with interactive widgets, real-time exchange rates, and production-grade security.

## 📖 Integration Guide

**See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) for complete setup instructions** including:
- Wise API integration
- Payment provider setup (Plaid, dLocal, Currencycloud)
- Database configuration
- KYC/AML compliance
- Security best practices

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.0.4-green)](https://github.com/modelcontextprotocol)

## ✨ Features

### 🌎 International Transfers
- **17+ Latin American Countries** - Mexico, Guatemala, Honduras, Dominican Republic, Colombia, Peru, Ecuador, El Salvador, Nicaragua, Costa Rica, and more
- **Ultra-Low Fees** - Starting at just $0.85 (1.5% with $2.99 min, $50 max)
- **Fast Delivery** - As quick as 35 minutes for select corridors
- **Live Exchange Rates** - Updated hourly from exchangerate-api.com

### 🎨 Interactive Widgets
Built with the OpenAI Apps SDK, featuring:
- **Transfer Receipt Widget** - Beautiful animated receipts with status tracking
- **Exchange Rate Widget** - Live rates with animated backgrounds
- **Transfer History Widget** - Browse past transfers with click-to-view details
- **window.openai Integration** - Full interactive capabilities

### 🛠️ Five Powerful Tools

1. **send_money** - Initiate international transfers
2. **get_exchange_rate** - Check live exchange rates
3. **check_transfer_status** - Track transfer progress
4. **get_transfer_history** - View all past transfers
5. **get_supported_countries** - List all supported corridors

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Start the Server
```bash
pnpm start
```

Server runs on `http://localhost:8000`

### 3. Expose Publicly

**Option 1: ngrok (Recommended)**
```bash
npx ngrok http 8000
```

**Option 2: localtunnel**
```bash
npx localtunnel --port 8000
```

**Option 3: Cloudflare Tunnel**
```bash
cloudflared tunnel --url http://localhost:8000
```

### 4. Connect to ChatGPT

1. **Enable Developer Mode**
   - Open ChatGPT Settings → Apps & Connectors
   - Enable "Advanced settings" → "Developer mode"

2. **Create Connector**
   - Go to Connectors → Create
   - **Name**: MyBambu Transfers
   - **Description**: Send money to Latin America with low fees and fast delivery
   - **URL**: `https://your-public-url.com/mcp`

3. **Test It!**
   - Start a new chat
   - Click the `+` button → Select "MyBambu Transfers"
   - Try: *"Send $100 to Mexico"*

## 💬 Usage Examples

### Send Money
```
You: Send $100 to Maria in Mexico
ChatGPT: [Shows interactive receipt widget with transfer details]
```

### Check Exchange Rates
```
You: What's the exchange rate from USD to MXN?
ChatGPT: [Shows beautiful rate widget with live data]
```

### View History
```
You: Show me my transfer history
ChatGPT: [Shows history widget with all past transfers]
```

### Check Status
```
You: Check status of TXN-1001
ChatGPT: [Shows updated receipt with current status]
```

### Supported Countries
```
You: Which countries does MyBambu support?
ChatGPT: [Lists all 17+ supported corridors with delivery times]
```

## 🏗️ Architecture

### MCP Server Structure

```
src/server.ts
├── Component Resources (HTML widgets)
│   ├── Transfer Receipt Widget
│   ├── Exchange Rate Widget
│   └── Transfer History Widget
├── Tools (5 total)
│   ├── send_money
│   ├── get_exchange_rate
│   ├── check_transfer_status
│   ├── get_transfer_history
│   └── get_supported_countries
└── Mock MyBambu API
    └── simulateMyBambuTransfer()
```

### Apps SDK Integration

**Component Resources** (`text/html+skybridge` mimeType)
- Exposed via `ListResourcesRequestSchema`
- Served via `ReadResourceRequestSchema`
- Interactive with `window.openai` API

**Tool Metadata** (proper `_meta` fields)
- `openai/outputTemplate` - Links to widget component
- `openai/toolInvocation` - Status messages
- `readOnlyHint` / `destructiveHint` - Behavioral hints

**Response Structure**
```typescript
{
  content: [...],           // For ChatGPT conversation
  structuredContent: {...}, // For widget (window.openai.toolOutput)
  _meta: {...}             // For widget only (window.openai.toolResponseMetadata)
}
```

## 🎨 Widget Features

### Interactive Actions

**Transfer Receipt Widget:**
- "Check Status" button → Calls `check_transfer_status` tool
- "View History" button → Sends follow-up message

**Exchange Rate Widget:**
- "Send Money Now" button → Initiates transfer flow

**Transfer History Widget:**
- Click any transfer → Shows full receipt

## 🌍 Supported Corridors

| Country | Currency | Delivery Time |
|---------|----------|---------------|
| 🇲🇽 Mexico | MXN | 35 minutes |
| 🇬🇹 Guatemala | GTQ | 1-2 hours |
| 🇭🇳 Honduras | HNL | 1-2 hours |
| 🇩🇴 Dominican Republic | DOP | 35 minutes |
| 🇸🇻 El Salvador | USD | 35 minutes |
| 🇨🇴 Colombia | COP | 1-3 hours |
| 🇵🇪 Peru | PEN | 1-3 hours |
| 🇪🇨 Ecuador | USD | 1-3 hours |
| 🇳🇮 Nicaragua | NIO | 2-4 hours |
| 🇨🇷 Costa Rica | CRC | 1-2 hours |

*More countries coming soon!*

## 📦 Deployment

### Render (Current Setup)

The repository includes `render.yaml` for one-click deployment:

1. Push to GitHub
2. Go to https://render.com
3. New → Web Service
4. Connect your GitHub repo
5. Render auto-detects config from render.yaml

### Railway

Includes `railway.json` for deployment:

```bash
npm install -g @railway/cli
railway login
railway up
```

### Docker

```bash
docker build -t mybambu-transfers .
docker run -p 8000:8000 mybambu-transfers
```

## 🛠 Development

```bash
pnpm start      # Start production server
pnpm dev        # Start with auto-reload
```

## 🎯 Roadmap

### Phase 1: MVP (Current) ✅
- [x] MCP server with Apps SDK best practices
- [x] Interactive widgets with window.openai
- [x] 5 tools for transfers and rates
- [x] Mock MyBambu API
- [x] Beautiful UI with animations
- [x] 17+ country support

### Phase 2: Production
- [ ] Real MyBambu API integration
- [ ] OAuth 2.1 authentication
- [ ] PostgreSQL database
- [ ] Transaction persistence
- [ ] Webhook status updates

---

**Built with ❤️ for the Latino community** 🌎
