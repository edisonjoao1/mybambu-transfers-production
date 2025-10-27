import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
} from "@modelcontextprotocol/sdk/types.js";

// Real-time exchange rates cache
let exchangeRatesCache: any = null;
let lastFetchTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Transfer storage
const transfers = new Map<string, any>();
let transferCounter = 1000;

// Transfer limits
const transferLimits = {
  daily: 10000,
  perTransaction: 5000,
  monthlyLimit: 50000,
  fees: { standard: 0.015, minFee: 2.99, maxFee: 50 },
};

// Fetch real-time exchange rates
async function fetchExchangeRates() {
  const now = Date.now();
  
  if (exchangeRatesCache && (now - lastFetchTime) < CACHE_DURATION) {
    return exchangeRatesCache;
  }

  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await response.json();
    
    exchangeRatesCache = {
      base: 'USD',
      rates: data.rates,
      timestamp: new Date(data.date).toISOString(),
    };
    lastFetchTime = now;
    
    return exchangeRatesCache;
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);
    return exchangeRatesCache || {
      base: 'USD',
      rates: { MXN: 17.5, GTQ: 7.8, HND: 24.5, DOP: 58.2 },
      timestamp: new Date().toISOString(),
    };
  }
}

// Generate HTML for transfer receipt
function generateTransferReceiptHtml(transfer: any): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
    }
    .receipt {
      background: white;
      border-radius: 16px;
      padding: 24px;
      max-width: 500px;
      margin: 0 auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .header {
      text-align: center;
      padding-bottom: 20px;
      border-bottom: 2px solid #f0f0f0;
    }
    .status {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      margin-top: 12px;
      background: #fff3cd;
      color: #856404;
    }
    .amount-section {
      text-align: center;
      padding: 30px 0;
    }
    .amount {
      font-size: 48px;
      font-weight: 700;
      color: #667eea;
    }
    .currency { font-size: 24px; color: #888; }
    .details {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child { border-bottom: none; }
    .label { color: #666; font-size: 14px; }
    .value { font-weight: 600; color: #333; }
    .recipient {
      text-align: center;
      padding: 20px 0;
      font-size: 18px;
      color: #333;
    }
    .transfer-id {
      text-align: center;
      color: #999;
      font-size: 12px;
      margin-top: 20px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1>💸 Transfer Receipt</h1>
      <div class="status">${transfer.status.toUpperCase()}</div>
    </div>
    
    <div class="amount-section">
      <div class="amount">${transfer.recipient_amount.toFixed(2)}</div>
      <div class="currency">${transfer.to_currency}</div>
    </div>
    
    <div class="recipient">
      To: <strong>${transfer.recipient_name}</strong><br>
      ${transfer.recipient_country}
    </div>
    
    <div class="details">
      <div class="detail-row">
        <span class="label">You sent</span>
        <span class="value">${transfer.amount} ${transfer.from_currency}</span>
      </div>
      <div class="detail-row">
        <span class="label">Fee</span>
        <span class="value">${transfer.fee.toFixed(2)} ${transfer.from_currency}</span>
      </div>
      <div class="detail-row">
        <span class="label">Exchange rate</span>
        <span class="value">1 ${transfer.from_currency} = ${transfer.exchange_rate} ${transfer.to_currency}</span>
      </div>
      <div class="detail-row">
        <span class="label">Recipient gets</span>
        <span class="value">${transfer.recipient_amount.toFixed(2)} ${transfer.to_currency}</span>
      </div>
      <div class="detail-row">
        <span class="label">Delivery</span>
        <span class="value">1-3 business days</span>
      </div>
    </div>
    
    <div class="transfer-id">ID: ${transfer.id}</div>
  </div>
</body>
</html>`;
}

// Generate HTML for exchange rate card
function generateExchangeRateHtml(data: any): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      min-height: 100vh;
    }
    .rate-card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      margin: 0 auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .title { text-align: center; color: #333; margin-bottom: 24px; font-size: 18px; }
    .rate-display {
      text-align: center;
      padding: 30px 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 12px;
      color: white;
    }
    .rate-value {
      font-size: 56px;
      font-weight: 700;
      margin: 16px 0;
    }
    .currencies {
      font-size: 20px;
      opacity: 0.9;
    }
    .timestamp {
      text-align: center;
      color: #999;
      font-size: 12px;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="rate-card">
    <h2 class="title">💱 Live Exchange Rate</h2>
    <div class="rate-display">
      <div class="currencies">1 ${data.from_currency}</div>
      <div class="rate-value">${data.rate.toFixed(4)}</div>
      <div class="currencies">${data.to_currency}</div>
    </div>
    <div class="timestamp">Updated: ${new Date(data.timestamp).toLocaleString()}</div>
  </div>
</body>
</html>`;
}

// Create MCP server
function createTransfersServer(): Server {
  const server = new Server(
    { name: "transfers-node", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async (_request: ListToolsRequest) => ({
    tools: [
      {
        name: "send_money",
        description: "Send money internationally with real-time exchange rates",
        inputSchema: {
          type: "object",
          properties: {
            from_currency: { type: "string", description: "Source currency (USD, MXN, etc.)" },
            to_currency: { type: "string", description: "Destination currency" },
            amount: { type: "number", description: "Amount to send" },
            recipient_name: { type: "string", description: "Recipient name" },
            recipient_country: { type: "string", description: "Recipient country" },
          },
          required: ["from_currency", "to_currency", "amount", "recipient_name", "recipient_country"],
        },
      },
      {
        name: "get_exchange_rate",
        description: "Get real-time exchange rate between currencies",
        inputSchema: {
          type: "object",
          properties: {
            from_currency: { type: "string", description: "Source currency" },
            to_currency: { type: "string", description: "Destination currency" },
          },
          required: ["from_currency", "to_currency"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const toolName = request.params.name;
    const args = request.params.arguments ?? {};

    if (toolName === "send_money") {
      const { from_currency, to_currency, amount, recipient_name, recipient_country } = args as any;

      if (amount <= 0) {
        return { content: [{ type: "text", text: "Amount must be greater than 0" }] };
      }

      if (amount > transferLimits.perTransaction) {
        return {
          content: [{
            type: "text",
            text: `Amount exceeds per-transaction limit of ${transferLimits.perTransaction} ${from_currency}`,
          }],
        };
      }

      const rateData = await fetchExchangeRates();
      const rate = from_currency === 'USD' 
        ? rateData.rates[to_currency]
        : rateData.rates[to_currency] / rateData.rates[from_currency];

      if (!rate) {
        return {
          content: [{
            type: "text",
            text: `Exchange rate not available for ${from_currency} to ${to_currency}`,
          }],
        };
      }

      const feeAmount = Math.max(
        transferLimits.fees.minFee,
        Math.min(amount * transferLimits.fees.standard, transferLimits.fees.maxFee)
      );
      const netAmount = amount - feeAmount;
      const recipientAmount = netAmount * rate;
      const transferId = `TXN-${transferCounter++}`;

      const transfer = {
        id: transferId,
        from_currency,
        to_currency,
        amount,
        fee: feeAmount,
        net_amount: netAmount,
        exchange_rate: rate,
        recipient_amount: recipientAmount,
        recipient_name,
        recipient_country,
        status: "pending",
        created_at: new Date().toISOString(),
      };

      transfers.set(transferId, transfer);

      return {
        content: [{
          type: "text",
          text: `✅ Transfer created! ${recipient_name} will receive ${recipientAmount.toFixed(2)} ${to_currency}. Fee: ${feeAmount.toFixed(2)} ${from_currency}. ID: ${transferId}`,
        }],
      };
    }

    if (toolName === "get_exchange_rate") {
      const { from_currency, to_currency } = args as any;

      const rateData = await fetchExchangeRates();
      const rate = from_currency === 'USD'
        ? rateData.rates[to_currency]
        : rateData.rates[to_currency] / rateData.rates[from_currency];

      if (!rate) {
        return {
          content: [{
            type: "text",
            text: `Exchange rate not available for ${from_currency} to ${to_currency}`,
          }],
        };
      }

      return {
        content: [{
          type: "text",
          text: `💱 Current rate: 1 ${from_currency} = ${rate.toFixed(4)} ${to_currency}\n\nLast updated: ${new Date(rateData.timestamp).toLocaleString()}`,
        }],
      };
    }

    throw new Error(`Unknown tool: ${toolName}`);
  });

  return server;
}

// Session management
type SessionRecord = { server: Server; transport: SSEServerTransport };
const sessions = new Map<string, SessionRecord>();
const ssePath = "/mcp";
const postPath = "/mcp/messages";

async function handleSseRequest(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const server = createTransfersServer();
  const transport = new SSEServerTransport(postPath, res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => {
    sessions.delete(sessionId);
    await server.close();
  };

  transport.onerror = (error) => console.error("SSE transport error", error);

  try {
    await server.connect(transport);
  } catch (error) {
    sessions.delete(sessionId);
    console.error("Failed to start SSE session", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to establish SSE connection");
    }
  }
}

async function handlePostMessage(req: IncomingMessage, res: ServerResponse, url: URL) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    res.writeHead(400).end("Missing sessionId query parameter");
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    res.writeHead(404).end("Unknown session");
    return;
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Failed to process message", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to process message");
    }
  }
}

// HTTP Server
const port = Number(process.env.PORT ?? 8000);

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && (url.pathname === ssePath || url.pathname === postPath)) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === ssePath) {
    await handleSseRequest(res);
    return;
  }

  if (req.method === "POST" && url.pathname === postPath) {
    await handlePostMessage(req, res, url);
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.on("clientError", (err: Error, socket) => {
  console.error("HTTP client error", err);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

httpServer.listen(port, () => {
  console.log(`🚀 Transfers MCP server with REAL-TIME rates!`);
  console.log(`   http://localhost:${port}`);
  console.log(`   SSE: GET http://localhost:${port}${ssePath}`);
  console.log(`   POST: http://localhost:${port}${postPath}?sessionId=...`);
  console.log(`\n💡 Expose with: lt --port ${port}`);
});
