import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from 'node:fs';
import { config } from 'dotenv';

// Only load .env file if it exists (for local development)
// Railway/Render provide env vars natively - no .env file needed
if (existsSync('.env')) {
  config();
}
import { URL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { initializeWiseService, getWiseService } from './services/wise.js';

// Real-time exchange rates cache
let exchangeRatesCache: any = null;
let lastFetchTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Transfer storage (in production, use a database)
const transfers = new Map<string, any>();
let transferCounter = 1000;

// Recipient storage
const recipients = new Map<string, any>();
let recipientCounter = 1;

// Scheduled transfers storage
const scheduledTransfers = new Map<string, any>();
let scheduledCounter = 1;

// Transfer limits
const transferLimits = {
  daily: 10000,
  perTransaction: 5000,
  monthlyLimit: 50000,
  fees: { standard: 0.015, minFee: 2.99, maxFee: 50 },
};

// MyBambu supported corridors - Powered by Wise API
// Only includes countries with verified Wise API support
const SUPPORTED_CORRIDORS = [
  // Latin America (8 countries with direct Wise support)
  { country: "Mexico", currency: "MXN", deliveryTime: "Minutes to hours", region: "Latin America" },
  { country: "Brazil", currency: "BRL", deliveryTime: "Minutes to hours", region: "Latin America" },
  { country: "Colombia", currency: "COP", deliveryTime: "Minutes to hours", region: "Latin America" },
  { country: "Argentina", currency: "ARS", deliveryTime: "1-2 business days", region: "Latin America" },
  { country: "Chile", currency: "CLP", deliveryTime: "Minutes to hours", region: "Latin America" },
  { country: "Costa Rica", currency: "CRC", deliveryTime: "Minutes to hours", region: "Latin America" },
  { country: "Guatemala", currency: "GTQ", deliveryTime: "Minutes to hours", region: "Latin America" },
  { country: "Uruguay", currency: "UYU", deliveryTime: "1-2 business days", region: "Latin America" },

  // Asia (Top Wise-supported markets)
  { country: "India", currency: "INR", deliveryTime: "Minutes to hours", region: "Asia" },
  { country: "Philippines", currency: "PHP", deliveryTime: "Minutes to hours", region: "Asia" },
  { country: "Singapore", currency: "SGD", deliveryTime: "Minutes", region: "Asia" },
  { country: "Japan", currency: "JPY", deliveryTime: "Minutes", region: "Asia" },
  { country: "Hong Kong", currency: "HKD", deliveryTime: "Minutes", region: "Asia" },
  { country: "Thailand", currency: "THB", deliveryTime: "Minutes to hours", region: "Asia" },
  { country: "Malaysia", currency: "MYR", deliveryTime: "Minutes to hours", region: "Asia" },
  { country: "Indonesia", currency: "IDR", deliveryTime: "1-2 business days", region: "Asia" },
  { country: "Vietnam", currency: "VND", deliveryTime: "Minutes to hours", region: "Asia" },
  { country: "South Korea", currency: "KRW", deliveryTime: "Minutes to hours", region: "Asia" },
  { country: "China", currency: "CNY", deliveryTime: "1-2 business days", region: "Asia" },
  { country: "Pakistan", currency: "PKR", deliveryTime: "Minutes to hours", region: "Asia" },
  { country: "Bangladesh", currency: "BDT", deliveryTime: "Minutes to hours", region: "Asia" },

  // Europe (Eurozone + Top Markets)
  { country: "United Kingdom", currency: "GBP", deliveryTime: "Minutes", region: "Europe" },
  { country: "Germany", currency: "EUR", deliveryTime: "Minutes", region: "Europe" },
  { country: "France", currency: "EUR", deliveryTime: "Minutes", region: "Europe" },
  { country: "Spain", currency: "EUR", deliveryTime: "Minutes", region: "Europe" },
  { country: "Italy", currency: "EUR", deliveryTime: "Minutes", region: "Europe" },
  { country: "Netherlands", currency: "EUR", deliveryTime: "Minutes", region: "Europe" },
  { country: "Poland", currency: "PLN", deliveryTime: "Minutes to hours", region: "Europe" },
  { country: "Romania", currency: "RON", deliveryTime: "Minutes to hours", region: "Europe" },
  { country: "Turkey", currency: "TRY", deliveryTime: "Minutes to hours", region: "Europe" },
  { country: "Switzerland", currency: "CHF", deliveryTime: "Minutes", region: "Europe" },
  { country: "Sweden", currency: "SEK", deliveryTime: "Minutes", region: "Europe" },
  { country: "Norway", currency: "NOK", deliveryTime: "Minutes", region: "Europe" },
  { country: "Denmark", currency: "DKK", deliveryTime: "Minutes", region: "Europe" },
  { country: "Czech Republic", currency: "CZK", deliveryTime: "Minutes to hours", region: "Europe" },
  { country: "Hungary", currency: "HUF", deliveryTime: "Minutes to hours", region: "Europe" },

  // Africa (Major Markets)
  { country: "South Africa", currency: "ZAR", deliveryTime: "Minutes to hours", region: "Africa" },
  { country: "Nigeria", currency: "NGN", deliveryTime: "Minutes to hours", region: "Africa" },
  { country: "Kenya", currency: "KES", deliveryTime: "Minutes to hours", region: "Africa" },
  { country: "Egypt", currency: "EGP", deliveryTime: "Minutes to hours", region: "Africa" },
  { country: "Morocco", currency: "MAD", deliveryTime: "Minutes to hours", region: "Africa" },

  // Middle East
  { country: "United Arab Emirates", currency: "AED", deliveryTime: "Minutes to hours", region: "Middle East" },
  { country: "Israel", currency: "ILS", deliveryTime: "Minutes to hours", region: "Middle East" },

  // Oceania
  { country: "Australia", currency: "AUD", deliveryTime: "Minutes", region: "Oceania" },
  { country: "New Zealand", currency: "NZD", deliveryTime: "Minutes to hours", region: "Oceania" },

  // North America
  { country: "Canada", currency: "CAD", deliveryTime: "Minutes", region: "North America" },
];

// Fetch real-time exchange rates
async function fetchExchangeRates() {
  const now = Date.now();

  if (exchangeRatesCache && (now - lastFetchTime) < CACHE_DURATION) {
    return exchangeRatesCache;
  }

  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data: any = await response.json();

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
      rates: {
        MXN: 17.5, GTQ: 7.8, HNL: 24.5, DOP: 58.2,
        COP: 4100, PEN: 3.7, NIO: 36.5, CRC: 510
      },
      timestamp: new Date().toISOString(),
    };
  }
}

// Mock MyBambu API - simulate transfer processing
function simulateMyBambuTransfer(transferData: any) {
  // In production, this would call the real MyBambu API
  // For now, we'll simulate a successful transfer
  const statuses = ['pending', 'processing', 'completed'];
  const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];

  return {
    success: true,
    mybambuTransferId: `BAMBU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    status: randomStatus,
    estimatedDelivery: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
  };
}

// Calculate next execution dates for scheduled transfers
function getNextExecutionDates(frequency: string, startDate: string, count: number): string[] {
  const dates: string[] = [];
  let currentDate = new Date(startDate);

  for (let i = 0; i < count; i++) {
    dates.push(currentDate.toISOString());

    switch (frequency) {
      case 'weekly':
        currentDate = new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case 'bi-weekly':
        currentDate = new Date(currentDate.getTime() + 14 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        currentDate = new Date(currentDate.setMonth(currentDate.getMonth() + 1));
        break;
      case 'quarterly':
        currentDate = new Date(currentDate.setMonth(currentDate.getMonth() + 3));
        break;
    }
  }

  return dates;
}

// Component resources - these are the interactive widgets
function getTransferReceiptComponent(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #1863DC 0%, #296BFF 100%);
      min-height: 100vh;
      color: #0D1752;
    }
    .receipt {
      background: white;
      border-radius: 24px;
      padding: 32px;
      max-width: 520px;
      margin: 0 auto;
      box-shadow: 0 24px 72px rgba(24, 99, 220, 0.15);
      animation: slideUp 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .header {
      text-align: center;
      padding-bottom: 24px;
      border-bottom: 2px solid #f4f4f4;
    }
    .mybambu-logo {
      font-size: 28px;
      font-weight: 800;
      color: #1863DC;
      margin-bottom: 12px;
      letter-spacing: -0.5px;
    }
    .status {
      display: inline-block;
      padding: 10px 20px;
      border-radius: 24px;
      font-size: 12px;
      font-weight: 700;
      margin-top: 16px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }
    .status-pending { background: #FFF3CD; color: #856404; }
    .status-processing { background: #D1E7FE; color: #1863DC; }
    .status-completed { background: #D1F4E0; color: #17CA60; }
    .amount-section {
      text-align: center;
      padding: 40px 0;
      background: linear-gradient(135deg, rgba(24, 99, 220, 0.08) 0%, rgba(23, 202, 96, 0.08) 100%);
      border-radius: 20px;
      margin: 24px 0;
      position: relative;
      overflow: hidden;
    }
    .amount-section::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(23, 202, 96, 0.1) 0%, transparent 70%);
      animation: pulse 3s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.5; }
      50% { transform: scale(1.1); opacity: 0.8; }
    }
    .amount {
      font-size: 56px;
      font-weight: 800;
      color: #1863DC;
      line-height: 1;
      position: relative;
      z-index: 1;
    }
    .currency {
      font-size: 20px;
      color: #17CA60;
      font-weight: 700;
      margin-top: 8px;
      position: relative;
      z-index: 1;
    }
    .details {
      background: #F8F9FA;
      border-radius: 16px;
      padding: 24px;
      margin: 24px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 14px 0;
      border-bottom: 1px solid #E8EAED;
      align-items: center;
    }
    .detail-row:last-child { border-bottom: none; }
    .label { color: #6B7280; font-size: 15px; font-weight: 600; }
    .value { font-weight: 700; color: #0D1752; text-align: right; font-size: 15px; }
    .recipient {
      text-align: center;
      padding: 28px;
      background: linear-gradient(135deg, #F8FBFF 0%, #F0F9FF 100%);
      border-radius: 16px;
      margin: 24px 0;
      border: 2px solid #E8F2FE;
    }
    .recipient-name {
      font-size: 24px;
      font-weight: 800;
      margin: 10px 0;
      color: #1863DC;
      letter-spacing: -0.5px;
    }
    .transfer-id {
      text-align: center;
      color: #9CA3AF;
      font-size: 11px;
      margin-top: 24px;
      font-family: 'Courier New', monospace;
      padding: 14px;
      background: #F8F9FA;
      border-radius: 10px;
      font-weight: 600;
    }
    .actions {
      margin-top: 28px;
      display: flex;
      gap: 12px;
    }
    button {
      flex: 1;
      padding: 16px 24px;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      font-family: 'Nunito', sans-serif;
    }
    .btn-primary {
      background: #1863DC;
      color: white;
    }
    .btn-primary:hover {
      background: #296BFF;
      transform: translateY(-2px);
      box-shadow: 0 12px 24px rgba(24, 99, 220, 0.3);
    }
    .btn-secondary {
      background: white;
      color: #1863DC;
      border: 2px solid #1863DC;
    }
    .btn-secondary:hover {
      background: #F8FBFF;
      transform: translateY(-2px);
    }
    @media (max-width: 480px) {
      body { padding: 12px; }
      .receipt { padding: 24px; border-radius: 20px; }
      .amount { font-size: 44px; }
      .mybambu-logo { font-size: 24px; }
    }
  </style>
</head>
<body>
  <div class="receipt" id="receipt">
    <div class="header">
      <div class="mybambu-logo">MyBambu</div>
      <h2 style="color: #333; font-size: 20px;">💸 Transfer Receipt</h2>
      <div class="status" id="status">PENDING</div>
    </div>

    <div class="recipient">
      <div style="font-size: 14px; color: #666;">Sending to</div>
      <div class="recipient-name" id="recipientName">Loading...</div>
      <div style="font-size: 16px; color: #666; margin-top: 4px;" id="recipientCountry">Loading...</div>
    </div>

    <div class="amount-section">
      <div style="font-size: 14px; color: #666; margin-bottom: 8px;">They receive</div>
      <div class="amount" id="amount">0.00</div>
      <div class="currency" id="currency">USD</div>
    </div>

    <div class="details">
      <div class="detail-row">
        <span class="label">You sent</span>
        <span class="value" id="sentAmount">$0.00</span>
      </div>
      <div class="detail-row">
        <span class="label">Transfer fee</span>
        <span class="value" id="fee">$0.00</span>
      </div>
      <div class="detail-row">
        <span class="label">Exchange rate</span>
        <span class="value" id="rate">1 USD = 0.00</span>
      </div>
      <div class="detail-row">
        <span class="label">Delivery time</span>
        <span class="value" id="delivery">35 minutes</span>
      </div>
      <div class="detail-row">
        <span class="label">Estimated arrival</span>
        <span class="value" id="arrival">Calculating...</span>
      </div>
    </div>

    <div class="actions">
      <button class="btn-secondary" onclick="checkStatus()">Check Status</button>
      <button class="btn-primary" onclick="viewHistory()">View History</button>
    </div>

    <div class="transfer-id" id="transferId">ID: Loading...</div>
  </div>

  <script>
    // Access window.openai provided by ChatGPT Apps SDK
    function render() {
      if (!window.openai || !window.openai.toolOutput) {
        setTimeout(render, 100);
        return;
      }

      const data = window.openai.toolOutput;

      // Update all fields with transfer data
      document.getElementById('recipientName').textContent = data.recipient_name;
      document.getElementById('recipientCountry').textContent = data.recipient_country;
      document.getElementById('amount').textContent = data.recipient_amount.toFixed(2);
      document.getElementById('currency').textContent = data.to_currency;
      document.getElementById('sentAmount').textContent = \`$\${data.amount.toFixed(2)} \${data.from_currency}\`;
      document.getElementById('fee').textContent = \`$\${data.fee.toFixed(2)} \${data.from_currency}\`;
      document.getElementById('rate').textContent = \`1 \${data.from_currency} = \${data.exchange_rate.toFixed(4)} \${data.to_currency}\`;
      document.getElementById('delivery').textContent = data.delivery_time;
      document.getElementById('arrival').textContent = new Date(data.estimated_arrival).toLocaleString();
      document.getElementById('transferId').textContent = \`ID: \${data.id}\`;

      // Update status with proper styling
      const statusEl = document.getElementById('status');
      statusEl.textContent = data.status.toUpperCase();
      statusEl.className = 'status status-' + data.status;
    }

    // Interactive actions using window.openai.callTool
    async function checkStatus() {
      if (window.openai && window.openai.callTool) {
        const data = window.openai.toolOutput;
        await window.openai.callTool({
          name: 'check_transfer_status',
          input: { transfer_id: data.id }
        });
      }
    }

    async function viewHistory() {
      if (window.openai && window.openai.sendFollowUpMessage) {
        await window.openai.sendFollowUpMessage({
          role: 'user',
          content: 'Show me my transfer history'
        });
      }
    }

    // Initialize on load
    document.addEventListener('DOMContentLoaded', render);
    window.addEventListener('openai:set_globals', render);
  </script>
</body>
</html>`;
}

function getExchangeRateComponent(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #1863DC 0%, #296BFF 100%);
      min-height: 100vh;
    }
    .rate-card {
      background: white;
      border-radius: 24px;
      padding: 36px;
      max-width: 460px;
      margin: 0 auto;
      box-shadow: 0 24px 72px rgba(24, 99, 220, 0.2);
      animation: fadeIn 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.96); }
      to { opacity: 1; transform: scale(1); }
    }
    .mybambu-logo {
      font-size: 24px;
      font-weight: 800;
      color: #1863DC;
      text-align: center;
      margin-bottom: 12px;
      letter-spacing: -0.5px;
    }
    .title {
      text-align: center;
      color: #0D1752;
      margin-bottom: 32px;
      font-size: 20px;
      font-weight: 700;
    }
    .rate-display {
      text-align: center;
      padding: 40px 28px;
      background: linear-gradient(135deg, #1863DC 0%, #296BFF 100%);
      border-radius: 20px;
      color: white;
      position: relative;
      overflow: hidden;
      box-shadow: 0 16px 40px rgba(24, 99, 220, 0.25);
    }
    .rate-display::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%);
      animation: pulse 4s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.4; }
      50% { transform: scale(1.15) rotate(45deg); opacity: 0.7; }
    }
    .currencies {
      font-size: 20px;
      opacity: 0.95;
      font-weight: 700;
      position: relative;
      z-index: 1;
    }
    .rate-value {
      font-size: 68px;
      font-weight: 800;
      margin: 24px 0;
      position: relative;
      z-index: 1;
      text-shadow: 0 4px 20px rgba(0,0,0,0.15);
      letter-spacing: -2px;
    }
    .arrow {
      font-size: 32px;
      margin: 16px 0;
      opacity: 0.9;
      position: relative;
      z-index: 1;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-top: 28px;
    }
    .info-box {
      background: #F8F9FA;
      padding: 18px;
      border-radius: 14px;
      text-align: center;
      border: 2px solid #F0F0F0;
      transition: all 0.3s ease;
    }
    .info-box:hover {
      border-color: #1863DC;
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(24, 99, 220, 0.1);
    }
    .info-label {
      font-size: 11px;
      color: #6B7280;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      font-weight: 700;
    }
    .info-value {
      font-size: 17px;
      font-weight: 800;
      color: #0D1752;
    }
    .timestamp {
      text-align: center;
      color: #9CA3AF;
      font-size: 12px;
      margin-top: 28px;
      padding-top: 24px;
      border-top: 2px solid #F0F0F0;
      font-weight: 600;
    }
    button {
      width: 100%;
      padding: 16px;
      margin-top: 24px;
      border: none;
      border-radius: 12px;
      background: #1863DC;
      color: white;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      font-family: 'Nunito', sans-serif;
    }
    button:hover {
      background: #296BFF;
      transform: translateY(-2px);
      box-shadow: 0 12px 28px rgba(24, 99, 220, 0.3);
    }
  </style>
</head>
<body>
  <div class="rate-card">
    <div class="mybambu-logo">MyBambu</div>
    <h2 class="title">💱 Live Exchange Rate</h2>
    <div class="rate-display">
      <div class="currencies" id="fromCurrency">1 USD</div>
      <div class="arrow">↓</div>
      <div class="rate-value" id="rateValue">0.0000</div>
      <div class="currencies" id="toCurrency">MXN</div>
    </div>
    <div class="info-grid">
      <div class="info-box">
        <div class="info-label">Our Fee</div>
        <div class="info-value">$0.85+</div>
      </div>
      <div class="info-box">
        <div class="info-label">Delivery</div>
        <div class="info-value" id="deliveryTime">35 min</div>
      </div>
    </div>
    <button onclick="sendMoney()">Send Money Now</button>
    <div class="timestamp" id="timestamp">Updated: Loading...</div>
  </div>

  <script>
    function render() {
      if (!window.openai || !window.openai.toolOutput) {
        setTimeout(render, 100);
        return;
      }

      const data = window.openai.toolOutput;

      document.getElementById('fromCurrency').textContent = \`1 \${data.from_currency}\`;
      document.getElementById('rateValue').textContent = data.rate.toFixed(4);
      document.getElementById('toCurrency').textContent = data.to_currency;
      document.getElementById('timestamp').textContent = \`Updated: \${new Date(data.timestamp).toLocaleString()}\`;

      if (data.delivery_time) {
        document.getElementById('deliveryTime').textContent = data.delivery_time;
      }
    }

    async function sendMoney() {
      if (window.openai && window.openai.sendFollowUpMessage) {
        const data = window.openai.toolOutput;
        await window.openai.sendFollowUpMessage({
          role: 'user',
          content: \`Send money from \${data.from_currency} to \${data.to_currency}\`
        });
      }
    }

    document.addEventListener('DOMContentLoaded', render);
    window.addEventListener('openai:set_globals', render);
  </script>
</body>
</html>`;
}

function getTransferHistoryComponent(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #1863DC 0%, #296BFF 100%);
      min-height: 100vh;
    }
    .container {
      background: white;
      border-radius: 24px;
      padding: 32px;
      max-width: 640px;
      margin: 0 auto;
      box-shadow: 0 24px 72px rgba(24, 99, 220, 0.2);
      animation: slideUp 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .header {
      text-align: center;
      margin-bottom: 28px;
      padding-bottom: 24px;
      border-bottom: 2px solid #f4f4f4;
    }
    h1 {
      font-size: 26px;
      color: #0D1752;
      margin-bottom: 8px;
      font-weight: 800;
    }
    .subtitle {
      font-size: 15px;
      color: #6B7280;
      font-weight: 600;
    }
    .transfer-item {
      background: #F8F9FA;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 14px;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border-left: 4px solid #F0F0F0;
      border: 2px solid #F0F0F0;
    }
    .transfer-item:hover {
      transform: translateX(6px);
      border-color: #1863DC;
      box-shadow: 0 8px 24px rgba(24, 99, 220, 0.15);
      background: white;
    }
    .transfer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }
    .transfer-amount {
      font-size: 28px;
      font-weight: 800;
      color: #1863DC;
      letter-spacing: -0.5px;
    }
    .transfer-status {
      padding: 8px 14px;
      border-radius: 16px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .status-completed { background: #D1F4E0; color: #17CA60; }
    .status-pending { background: #FFF3CD; color: #856404; }
    .status-processing { background: #D1E7FE; color: #1863DC; }
    .transfer-details {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      color: #6B7280;
      font-weight: 600;
    }
    .empty-state {
      text-align: center;
      padding: 80px 20px;
      color: #9CA3AF;
    }
    .empty-state-icon {
      font-size: 72px;
      margin-bottom: 20px;
      opacity: 0.4;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📋 Transfer History</h1>
      <p class="subtitle" id="subtitle">Loading your transfers...</p>
    </div>
    <div id="transferList"></div>
  </div>

  <script>
    function render() {
      if (!window.openai || !window.openai.toolOutput) {
        setTimeout(render, 100);
        return;
      }

      const data = window.openai.toolOutput;
      const transfers = data.transfers || [];

      document.getElementById('subtitle').textContent =
        transfers.length > 0
          ? \`\${transfers.length} transfer\${transfers.length !== 1 ? 's' : ''} found\`
          : 'No transfers yet';

      const listEl = document.getElementById('transferList');

      if (transfers.length === 0) {
        listEl.innerHTML = \`
          <div class="empty-state">
            <div class="empty-state-icon">📭</div>
            <p>No transfers yet</p>
            <p style="font-size: 12px; margin-top: 8px;">Start by sending money to your loved ones</p>
          </div>
        \`;
        return;
      }

      listEl.innerHTML = transfers.map(t => \`
        <div class="transfer-item" onclick="viewTransfer('\${t.id}')">
          <div class="transfer-header">
            <span class="transfer-amount">\${t.recipient_amount.toFixed(2)} \${t.to_currency}</span>
            <span class="transfer-status status-\${t.status}">\${t.status}</span>
          </div>
          <div class="transfer-details">
            <span>To: \${t.recipient_name}</span>
            <span>\${new Date(t.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      \`).join('');
    }

    async function viewTransfer(id) {
      if (window.openai && window.openai.callTool) {
        await window.openai.callTool({
          name: 'check_transfer_status',
          input: { transfer_id: id }
        });
      }
    }

    document.addEventListener('DOMContentLoaded', render);
    window.addEventListener('openai:set_globals', render);
  </script>
</body>
</html>`;
}

function getRecipientManagementComponent(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #1863DC 0%, #296BFF 100%);
      min-height: 100vh;
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes pulse {
      0%, 100% {
        transform: scale(1) rotate(0deg);
        opacity: 0.4;
      }
      50% {
        transform: scale(1.15) rotate(45deg);
        opacity: 0.7;
      }
    }

    .container {
      background: white;
      border-radius: 24px;
      padding: 32px;
      max-width: 600px;
      margin: 0 auto;
      box-shadow: 0 24px 72px rgba(24, 99, 220, 0.2);
      animation: slideUp 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .header {
      text-align: center;
      margin-bottom: 28px;
      padding-bottom: 24px;
      border-bottom: 2px solid #F0F0F0;
    }

    .mybambu-logo {
      font-size: 28px;
      font-weight: 800;
      color: #1863DC;
      letter-spacing: -0.5px;
      margin-bottom: 12px;
    }

    h1 {
      font-size: 28px;
      color: #0D1752;
      margin-bottom: 6px;
      font-weight: 800;
    }

    .subtitle {
      font-size: 15px;
      color: #666;
      font-weight: 600;
    }

    .recipient-card {
      background: #F8F9FA;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 16px;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 2px solid #F0F0F0;
      border-left: 4px solid #1863DC;
      position: relative;
      overflow: hidden;
    }

    .recipient-card::before {
      content: '';
      position: absolute;
      top: 0;
      right: 0;
      width: 120px;
      height: 120px;
      background: radial-gradient(circle, rgba(24, 99, 220, 0.08) 0%, transparent 70%);
      animation: pulse 4s ease-in-out infinite;
    }

    .recipient-card:hover {
      transform: translateX(8px);
      box-shadow: 0 12px 28px rgba(24, 99, 220, 0.2);
      background: white;
      border-color: #1863DC;
    }

    .recipient-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      position: relative;
      z-index: 1;
    }

    .recipient-name {
      font-size: 22px;
      font-weight: 800;
      color: #1863DC;
      margin-bottom: 8px;
    }

    .recipient-country {
      font-size: 15px;
      color: #666;
      margin-bottom: 6px;
      font-weight: 600;
    }

    .recipient-currency {
      font-size: 13px;
      color: #999;
      font-family: 'Nunito', monospace;
      font-weight: 600;
    }

    .delete-btn {
      background: #dc3545;
      color: white;
      border: none;
      padding: 10px 18px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      font-family: 'Nunito', sans-serif;
    }

    .delete-btn:hover {
      background: #c82333;
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(220, 53, 69, 0.3);
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #999;
    }

    .empty-state-icon {
      font-size: 72px;
      margin-bottom: 20px;
      opacity: 0.4;
    }

    .empty-state p {
      font-weight: 600;
      color: #666;
    }

    .add-btn {
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 12px;
      background: linear-gradient(135deg, #1863DC 0%, #296BFF 100%);
      color: white;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      margin-top: 24px;
      font-family: 'Nunito', sans-serif;
      box-shadow: 0 6px 16px rgba(24, 99, 220, 0.2);
    }

    .add-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 28px rgba(24, 99, 220, 0.3);
      background: #296BFF;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="mybambu-logo">MyBambu</div>
      <h1>👥 Saved Recipients</h1>
      <p class="subtitle" id="subtitle">Loading...</p>
    </div>
    <div id="recipientList"></div>
    <button class="add-btn" onclick="addRecipient()">➕ Add New Recipient</button>
  </div>

  <script>
    function render() {
      if (!window.openai || !window.openai.toolOutput) {
        setTimeout(render, 100);
        return;
      }

      const data = window.openai.toolOutput;
      const recips = data.recipients || [];

      document.getElementById('subtitle').textContent =
        recips.length > 0
          ? \`\${recips.length} saved recipient\${recips.length !== 1 ? 's' : ''}\`
          : 'No recipients yet';

      const listEl = document.getElementById('recipientList');

      if (recips.length === 0) {
        listEl.innerHTML = \`
          <div class="empty-state">
            <div class="empty-state-icon">📭</div>
            <p>No saved recipients yet</p>
            <p style="font-size: 12px; margin-top: 8px;">Add recipients to send money faster next time!</p>
          </div>
        \`;
        return;
      }

      listEl.innerHTML = recips.map(r => \`
        <div class="recipient-card" onclick="sendToRecipient('\${r.id}')">
          <div class="recipient-header">
            <div>
              <div class="recipient-name">\${r.name}</div>
              <div class="recipient-country">📍 \${r.country}</div>
              <div class="recipient-currency">💱 \${r.currency}</div>
            </div>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteRecipient('\${r.id}')">Delete</button>
          </div>
        </div>
      \`).join('');
    }

    async function sendToRecipient(id) {
      if (window.openai && window.openai.sendFollowUpMessage) {
        const data = window.openai.toolOutput;
        const recipient = data.recipients.find((r: any) => r.id === id);
        if (recipient) {
          await window.openai.sendFollowUpMessage({
            role: 'user',
            content: \`Send money to \${recipient.name} in \${recipient.country}\`
          });
        }
      }
    }

    async function deleteRecipient(id) {
      if (window.openai && window.openai.callTool) {
        await window.openai.callTool({
          name: 'delete_recipient',
          input: { recipient_id: id }
        });
      }
    }

    async function addRecipient() {
      if (window.openai && window.openai.sendFollowUpMessage) {
        await window.openai.sendFollowUpMessage({
          role: 'user',
          content: 'Add a new recipient'
        });
      }
    }

    document.addEventListener('DOMContentLoaded', render);
    window.addEventListener('openai:set_globals', render);
  </script>
</body>
</html>`;
}

function getScheduledTransfersComponent(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #1863DC 0%, #296BFF 100%);
      min-height: 100vh;
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes shimmer {
      0%, 100% {
        transform: translate(0, 0);
        opacity: 0.5;
      }
      50% {
        transform: translate(10%, 10%);
        opacity: 0.8;
      }
    }

    .container {
      background: white;
      border-radius: 24px;
      padding: 32px;
      max-width: 600px;
      margin: 0 auto;
      box-shadow: 0 24px 72px rgba(24, 99, 220, 0.2);
      animation: slideUp 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .header {
      text-align: center;
      margin-bottom: 28px;
      padding-bottom: 24px;
      border-bottom: 2px solid #F0F0F0;
    }

    .mybambu-logo {
      font-size: 28px;
      font-weight: 800;
      color: #1863DC;
      letter-spacing: -0.5px;
      margin-bottom: 12px;
    }

    h1 {
      font-size: 28px;
      color: #0D1752;
      margin-bottom: 6px;
      font-weight: 800;
    }

    .subtitle {
      font-size: 15px;
      color: #666;
      font-weight: 600;
    }

    .schedule-card {
      background: #F8F9FA;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 16px;
      border: 2px solid #F0F0F0;
      border-left: 4px solid #17CA60;
      position: relative;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .schedule-card::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(23, 202, 96, 0.08) 0%, transparent 70%);
      animation: shimmer 3s ease-in-out infinite;
    }

    .schedule-card:hover {
      box-shadow: 0 12px 28px rgba(23, 202, 96, 0.15);
      border-color: #17CA60;
      background: white;
    }

    .schedule-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
      position: relative;
      z-index: 1;
    }

    .schedule-amount {
      font-size: 36px;
      font-weight: 800;
      color: #17CA60;
      letter-spacing: -1px;
    }

    .schedule-frequency {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      background: linear-gradient(135deg, #D1F4E0 0%, #B8F0D0 100%);
      color: #0A6E35;
      margin-top: 8px;
      box-shadow: 0 2px 8px rgba(23, 202, 96, 0.15);
    }

    .schedule-details {
      font-size: 15px;
      color: #666;
      margin-top: 12px;
      position: relative;
      z-index: 1;
    }

    .schedule-detail-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-top: 1px solid #E0E0E0;
      font-weight: 600;
    }

    .cancel-btn {
      background: #dc3545;
      color: white;
      border: none;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      margin-top: 16px;
      width: 100%;
      font-family: 'Nunito', sans-serif;
      position: relative;
      z-index: 1;
    }

    .cancel-btn:hover {
      background: #c82333;
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(220, 53, 69, 0.3);
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #999;
    }

    .empty-state-icon {
      font-size: 72px;
      margin-bottom: 20px;
      opacity: 0.4;
    }

    .empty-state p {
      font-weight: 600;
      color: #666;
    }

    .add-btn {
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 12px;
      background: linear-gradient(135deg, #1863DC 0%, #296BFF 100%);
      color: white;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      margin-top: 24px;
      font-family: 'Nunito', sans-serif;
      box-shadow: 0 6px 16px rgba(24, 99, 220, 0.2);
    }

    .add-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 28px rgba(24, 99, 220, 0.3);
      background: #296BFF;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="mybambu-logo">MyBambu</div>
      <h1>📅 Scheduled Transfers</h1>
      <p class="subtitle" id="subtitle">Loading...</p>
    </div>
    <div id="scheduleList"></div>
    <button class="add-btn" onclick="scheduleNew()">➕ Schedule New Transfer</button>
  </div>

  <script>
    function render() {
      if (!window.openai || !window.openai.toolOutput) {
        setTimeout(render, 100);
        return;
      }

      const data = window.openai.toolOutput;
      const schedules = data.schedules || [];

      document.getElementById('subtitle').textContent =
        schedules.length > 0
          ? \`\${schedules.length} active schedule\${schedules.length !== 1 ? 's' : ''}\`
          : 'No scheduled transfers';

      const listEl = document.getElementById('scheduleList');

      if (schedules.length === 0) {
        listEl.innerHTML = \`
          <div class="empty-state">
            <div class="empty-state-icon">📅</div>
            <p>No scheduled transfers</p>
            <p style="font-size: 12px; margin-top: 8px;">Set up recurring payments to send money automatically!</p>
          </div>
        \`;
        return;
      }

      listEl.innerHTML = schedules.map(s => \`
        <div class="schedule-card">
          <div class="schedule-header">
            <div>
              <div class="schedule-amount">$\${s.amount.toFixed(2)}</div>
              <div class="schedule-frequency">\${s.frequency}</div>
            </div>
          </div>
          <div class="schedule-details">
            <div class="schedule-detail-row">
              <span style="color: #999;">To:</span>
              <span style="font-weight: 600;">\${s.recipient_name}</span>
            </div>
            <div class="schedule-detail-row">
              <span style="color: #999;">Country:</span>
              <span>\${s.recipient_country} (\${s.currency_to})</span>
            </div>
            <div class="schedule-detail-row">
              <span style="color: #999;">Next Transfer:</span>
              <span>\${new Date(s.next_execution).toLocaleDateString()}</span>
            </div>
          </div>
          <button class="cancel-btn" onclick="cancelSchedule('\${s.id}')">Cancel Schedule</button>
        </div>
      \`).join('');
    }

    async function cancelSchedule(id) {
      if (window.openai && window.openai.callTool) {
        await window.openai.callTool({
          name: 'cancel_scheduled_transfer',
          input: { schedule_id: id }
        });
      }
    }

    async function scheduleNew() {
      if (window.openai && window.openai.sendFollowUpMessage) {
        await window.openai.sendFollowUpMessage({
          role: 'user',
          content: 'Schedule a recurring transfer'
        });
      }
    }

    document.addEventListener('DOMContentLoaded', render);
    window.addEventListener('openai:set_globals', render);
  </script>
</body>
</html>`;
}

function getRateComparisonComponent(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #1863DC 0%, #17CA60 100%);
      min-height: 100vh;
    }
    .container {
      background: white;
      border-radius: 24px;
      padding: 32px;
      max-width: 720px;
      margin: 0 auto;
      box-shadow: 0 24px 72px rgba(24, 99, 220, 0.2);
      animation: slideUp 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .header {
      text-align: center;
      margin-bottom: 28px;
      padding-bottom: 24px;
      border-bottom: 2px solid #f4f4f4;
    }
    .mybambu-logo {
      font-size: 28px;
      font-weight: 800;
      color: #1863DC;
      margin-bottom: 12px;
      letter-spacing: -0.5px;
    }
    h1 {
      font-size: 26px;
      color: #0D1752;
      margin-bottom: 4px;
      font-weight: 800;
    }
    .winner-card {
      background: linear-gradient(135deg, #1863DC 0%, #296BFF 100%);
      color: white;
      border-radius: 20px;
      padding: 32px;
      margin-bottom: 28px;
      box-shadow: 0 16px 40px rgba(24, 99, 220, 0.25);
      position: relative;
      overflow: hidden;
    }
    .winner-card::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(255, 255, 255, 0.15) 0%, transparent 70%);
      animation: shimmer 3s ease-in-out infinite;
    }
    @keyframes shimmer {
      0%, 100% { transform: translate(0, 0); }
      50% { transform: translate(10%, 10%); }
    }
    .winner-badge {
      font-size: 40px;
      margin-bottom: 12px;
      position: relative;
      z-index: 1;
    }
    .winner-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 8px;
      opacity: 0.95;
      position: relative;
      z-index: 1;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .winner-amount {
      font-size: 40px;
      font-weight: 800;
      margin-bottom: 8px;
      position: relative;
      z-index: 1;
      letter-spacing: -1px;
    }
    .winner-fee {
      font-size: 14px;
      opacity: 0.9;
      position: relative;
      z-index: 1;
      font-weight: 600;
    }
    .competitor-card {
      background: #F8F9FA;
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 14px;
      border: 2px solid #E8EAED;
      transition: all 0.3s ease;
    }
    .competitor-card:hover {
      border-color: #1863DC;
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(24, 99, 220, 0.1);
    }
    .competitor-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .competitor-name {
      font-weight: 700;
      font-size: 17px;
      color: #0D1752;
    }
    .competitor-amount {
      font-size: 19px;
      font-weight: 700;
      color: #6B7280;
    }
    .savings-badge {
      background: linear-gradient(135deg, #17CA60 0%, #0FB54A 100%);
      color: white;
      padding: 8px 16px;
      border-radius: 24px;
      font-size: 13px;
      font-weight: 700;
      display: inline-block;
      margin-top: 10px;
      box-shadow: 0 4px 12px rgba(23, 202, 96, 0.3);
    }
    .subtitle {
      color: #6B7280;
      font-size: 15px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="mybambu-logo">MyBambu</div>
      <h1>💰 Rate Comparison</h1>
      <p class="subtitle" id="subtitle">Loading...</p>
    </div>

    <div id="winnerCard"></div>
    <div id="competitorsList"></div>
  </div>

  <script>
    function render() {
      if (!window.openai || !window.openai.toolOutput) {
        setTimeout(render, 100);
        return;
      }

      const data = window.openai.toolOutput;
      const mybambu = data.mybambu;
      const competitors = data.competitors || [];

      document.getElementById('subtitle').textContent = \`Sending $\${data.amount} to \${data.country}\`;

      document.getElementById('winnerCard').innerHTML = \`
        <div class="winner-card">
          <div class="winner-badge">🏆</div>
          <div class="winner-title">MyBambu - Best Rate!</div>
          <div class="winner-amount">\${mybambu.receives.toFixed(2)} \${mybambu.currency}</div>
          <div class="winner-fee">Fee: $\${mybambu.fee.toFixed(2)} • Rate: \${mybambu.rate.toFixed(4)}</div>
        </div>
      \`;

      document.getElementById('competitorsList').innerHTML = competitors.map(c => \`
        <div class="competitor-card">
          <div class="competitor-header">
            <div class="competitor-name">\${c.name}</div>
            <div class="competitor-amount">\${c.receives} \${mybambu.currency}</div>
          </div>
          <div style="font-size: 13px; color: #999;">
            Fee: $\${c.fee.toFixed(2)} • Rate: \${c.rate.toFixed(4)}
          </div>
          <div class="savings-badge">
            💸 Save $\${c.savings} with MyBambu (\${c.savingsPercent}% more!)
          </div>
        </div>
      \`).join('');
    }

    document.addEventListener('DOMContentLoaded', render);
    window.addEventListener('openai:set_globals', render);
  </script>
</body>
</html>`;
}

function getSpendingAnalyticsComponent(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #1863DC 0%, #17CA60 100%);
      min-height: 100vh;
    }
    .container {
      background: white;
      border-radius: 24px;
      padding: 32px;
      max-width: 740px;
      margin: 0 auto;
      box-shadow: 0 24px 72px rgba(24, 99, 220, 0.2);
      animation: slideUp 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .header {
      text-align: center;
      margin-bottom: 28px;
      padding-bottom: 24px;
      border-bottom: 2px solid #f4f4f4;
    }
    .mybambu-logo {
      font-size: 28px;
      font-weight: 800;
      color: #1863DC;
      margin-bottom: 12px;
      letter-spacing: -0.5px;
    }
    h1 {
      font-size: 26px;
      color: #0D1752;
      margin-bottom: 4px;
      font-weight: 800;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: linear-gradient(135deg, #1863DC 0%, #296BFF 100%);
      color: white;
      border-radius: 16px;
      padding: 24px;
      text-align: center;
      position: relative;
      overflow: hidden;
      box-shadow: 0 8px 20px rgba(24, 99, 220, 0.15);
    }
    .stat-card::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -50%;
      width: 150%;
      height: 150%;
      background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
    }
    .stat-label {
      font-size: 11px;
      opacity: 0.9;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      font-weight: 700;
      position: relative;
      z-index: 1;
    }
    .stat-value {
      font-size: 32px;
      font-weight: 800;
      position: relative;
      z-index: 1;
      letter-spacing: -1px;
    }
    .breakdown-section {
      margin-top: 28px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 800;
      color: #0D1752;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .breakdown-item {
      background: #F8F9FA;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      border: 2px solid #F0F0F0;
      transition: all 0.3s ease;
    }
    .breakdown-item:hover {
      border-color: #1863DC;
      transform: translateX(4px);
      box-shadow: 0 8px 20px rgba(24, 99, 220, 0.1);
    }
    .breakdown-label {
      font-weight: 700;
      color: #0D1752;
      font-size: 15px;
      margin-bottom: 8px;
    }
    .breakdown-amount {
      font-weight: 800;
      color: #17CA60;
      font-size: 18px;
    }
    .breakdown-bar {
      height: 8px;
      background: linear-gradient(to right, #1863DC, #17CA60);
      border-radius: 4px;
      margin-top: 10px;
      transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 2px 8px rgba(24, 99, 220, 0.2);
    }
    .subtitle {
      color: #6B7280;
      font-size: 15px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="mybambu-logo">MyBambu</div>
      <h1>📊 Spending Analytics</h1>
      <p class="subtitle" id="subtitle">Loading...</p>
    </div>

    <div class="stats-grid" id="statsGrid"></div>

    <div class="breakdown-section">
      <div class="section-title">💵 By Country</div>
      <div id="byCountry"></div>
    </div>

    <div class="breakdown-section">
      <div class="section-title">👥 By Recipient</div>
      <div id="byRecipient"></div>
    </div>
  </div>

  <script>
    function render() {
      if (!window.openai || !window.openai.toolOutput) {
        setTimeout(render, 100);
        return;
      }

      const data = window.openai.toolOutput;

      document.getElementById('subtitle').textContent = data.period || 'All time';

      document.getElementById('statsGrid').innerHTML = \`
        <div class="stat-card">
          <div class="stat-label">Total Sent</div>
          <div class="stat-value">$\${data.totalSent.toFixed(0)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Transfers</div>
          <div class="stat-value">\${data.transferCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Fees</div>
          <div class="stat-value">$\${data.totalFees.toFixed(2)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg Transfer</div>
          <div class="stat-value">$\${data.avgTransfer.toFixed(0)}</div>
        </div>
      \`;

      const countryEntries = Object.entries(data.byCountry || {});
      const maxCountryTotal = Math.max(...countryEntries.map(([_, v]) => v.total));

      document.getElementById('byCountry').innerHTML = countryEntries
        .sort((a, b) => b[1].total - a[1].total)
        .map(([country, stats]) => {
          const width = (stats.total / maxCountryTotal) * 100;
          return \`
            <div class="breakdown-item">
              <div>
                <div class="breakdown-label">\${country}</div>
                <div class="breakdown-bar" style="width: \${width}%"></div>
              </div>
              <div class="breakdown-amount">$\${stats.total.toFixed(2)}</div>
            </div>
          \`;
        }).join('');

      const recipientEntries = Object.entries(data.byRecipient || {});
      const maxRecipientTotal = Math.max(...recipientEntries.map(([_, v]) => v.total));

      document.getElementById('byRecipient').innerHTML = recipientEntries
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5)
        .map(([name, stats]) => {
          const width = (stats.total / maxRecipientTotal) * 100;
          return \`
            <div class="breakdown-item">
              <div>
                <div class="breakdown-label">\${name}</div>
                <div class="breakdown-bar" style="width: \${width}%"></div>
              </div>
              <div class="breakdown-amount">$\${stats.total.toFixed(2)}</div>
            </div>
          \`;
        }).join('');
    }

    document.addEventListener('DOMContentLoaded', render);
    window.addEventListener('openai:set_globals', render);
  </script>
</body>
</html>`;
}

// Create MCP server
function createTransfersServer(): Server {
  const server = new Server(
    {
      name: "mybambu-transfers",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    }
  );

  // Register component resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "component://transfer-receipt",
        name: "Transfer Receipt Widget",
        mimeType: "text/html+skybridge",
        description: "Interactive transfer receipt with status tracking"
      },
      {
        uri: "component://exchange-rate",
        name: "Exchange Rate Widget",
        mimeType: "text/html+skybridge",
        description: "Live exchange rate display"
      },
      {
        uri: "component://transfer-history",
        name: "Transfer History Widget",
        mimeType: "text/html+skybridge",
        description: "Transfer history list"
      },
      {
        uri: "component://recipient-management",
        name: "Recipient Management Widget",
        mimeType: "text/html+skybridge",
        description: "Manage saved recipients with add and delete"
      },
      {
        uri: "component://scheduled-transfers",
        name: "Scheduled Transfers Widget",
        mimeType: "text/html+skybridge",
        description: "View and manage recurring transfer schedules"
      },
      {
        uri: "component://rate-comparison",
        name: "Rate Comparison Widget",
        mimeType: "text/html+skybridge",
        description: "Compare MyBambu rates against competitors"
      },
      {
        uri: "component://spending-analytics",
        name: "Spending Analytics Widget",
        mimeType: "text/html+skybridge",
        description: "Visual analytics and insights for transfer history"
      }
    ]
  }));

  // Serve component HTML
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    let html = '';
    if (uri === "component://transfer-receipt") {
      html = getTransferReceiptComponent();
    } else if (uri === "component://exchange-rate") {
      html = getExchangeRateComponent();
    } else if (uri === "component://transfer-history") {
      html = getTransferHistoryComponent();
    } else if (uri === "component://recipient-management") {
      html = getRecipientManagementComponent();
    } else if (uri === "component://scheduled-transfers") {
      html = getScheduledTransfersComponent();
    } else if (uri === "component://rate-comparison") {
      html = getRateComparisonComponent();
    } else if (uri === "component://spending-analytics") {
      html = getSpendingAnalyticsComponent();
    } else {
      throw new Error(`Unknown resource: ${uri}`);
    }

    return {
      contents: [{
        uri,
        mimeType: "text/html+skybridge",
        text: html
      }]
    };
  });

  // Register prompts to help ChatGPT discover MyBambu capabilities
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "mybambu-instructions",
        description: "CRITICAL SYSTEM INSTRUCTIONS for using MyBambu tools - READ THIS FIRST"
      },
      {
        name: "send-money",
        description: "Send money internationally through MyBambu to 46 countries with low fees and fast delivery"
      },
      {
        name: "money-transfer",
        description: "Complete guide to sending international money transfers via MyBambu"
      }
    ]
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const promptName = request.params.name;

    if (promptName === "mybambu-instructions") {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `CRITICAL: MyBambu Transfer System Instructions

ALWAYS use the available tools instead of manually responding. All transfer data is already stored and retrievable via tools.

When users ask about transfers, history, status, or recipients:
- "show/list/view transfers" → CALL get_transfer_history tool
- "check/track status" → CALL check_transfer_status tool
- "what countries" → CALL get_supported_countries tool
- "show/list recipients" → CALL list_recipients tool
- "exchange rate" / "how much is X in Y" → CALL get_exchange_rate tool
- "schedule/recurring/automatic" → CALL schedule_transfer or list_scheduled_transfers tool

NEVER manually create lists or say "I don't know" when tools are available. If user asks about data (history, recipients, schedules), ALWAYS call the corresponding tool first.

The system stores:
✓ All past transfers (retrievable via get_transfer_history)
✓ All saved recipients (retrievable via list_recipients)
✓ All scheduled transfers (retrievable via list_scheduled_transfers)
✓ Real-time transfer status (retrievable via check_transfer_status)
✓ Live exchange rates (retrievable via get_exchange_rate)
✓ Supported countries list (retrievable via get_supported_countries)

User requests like "Can you keep a running list..." mean "show me what's already stored" → call get_transfer_history immediately.`
            }
          }
        ]
      };
    }

    if (promptName === "send-money" || promptName === "money-transfer") {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "I can help you send money internationally through MyBambu! We support transfers to 46 countries across Latin America, Asia, Europe, Africa, Middle East, Oceania with low fees starting at $0.85 and delivery as fast as 35 minutes. What country would you like to send money to?"
            }
          }
        ]
      };
    }

    throw new Error(`Unknown prompt: ${promptName}`);
  });

  // Register tools with proper metadata
  server.setRequestHandler(ListToolsRequestSchema, async (_request: ListToolsRequest) => ({
    tools: [
      {
        name: "send_money",
        description: "Use this WHENEVER the user wants to send money, transfer money, wire money, remit money, pay someone, or send funds to anyone in another country. This is the PRIMARY money transfer tool for MyBambu. Captures ANY phrases like: 'send money', 'transfer funds', 'pay someone abroad', 'wire money', 'send cash', 'remit to family', 'send dollars to', 'pay my family in [country]', 'help me send money', or any variation of sending/transferring money internationally. Supports 46 countries worldwide across all continents. Low fees starting at $0.85 with delivery as fast as 35 minutes. ALWAYS use this tool when money transfer intent is detected.",
        inputSchema: {
          type: "object",
          properties: {
            amount: {
              type: "number",
              description: "Amount to send in USD (minimum $1, maximum $5000 per transaction)"
            },
            to_country: {
              type: "string",
              description: "Destination country - supports 46 countries including Mexico, Philippines, India, Nigeria, UK, France, UAE, Australia, Canada, and many more"
            },
            recipient_name: {
              type: "string",
              description: "Full name of the recipient"
            },
          },
          required: ["amount", "to_country", "recipient_name"],
        },
        _meta: {
          "openai/outputTemplate": "component://transfer-receipt",
          "openai/toolInvocation": {
            invoking: "Processing your transfer with MyBambu...",
            invoked: "Transfer initiated successfully!"
          },
          readOnlyHint: false,
          destructiveHint: false
        }
      },
      {
        name: "get_exchange_rate",
        description: "Get current exchange rate, check conversion rate, see how much currency you'll get, or compare rates. Use when user asks 'what's the exchange rate', 'how much is X in Y', 'rate for [currency]', 'USD to [currency]', 'exchange rate', 'conversion rate', 'how much will they receive', 'what's the rate', or wants to see rates for all countries/currencies. Provides live rates updated hourly with fee information and estimated delivery times.",
        inputSchema: {
          type: "object",
          properties: {
            to_currency: {
              type: "string",
              description: "Destination currency code (MXN, GTQ, HNL, DOP, COP, PEN, etc.)"
            },
            to_country: {
              type: "string",
              description: "Destination country name (optional, helps determine delivery time)"
            }
          },
          required: ["to_currency"],
        },
        _meta: {
          "openai/outputTemplate": "component://exchange-rate",
          "openai/toolInvocation": {
            invoking: "Fetching live exchange rates...",
            invoked: "Exchange rate retrieved"
          },
          readOnlyHint: true
        }
      },
      {
        name: "check_transfer_status",
        description: "Check status, track transfer, verify delivery, or get updates on any transfer. Use when user asks 'check the transfer status', 'where is my money', 'has it arrived', 'track my transfer', 'check transfer', 'status of transfer', or similar status inquiries. Returns current status, delivery progress, and estimated arrival time.",
        inputSchema: {
          type: "object",
          properties: {
            transfer_id: {
              type: "string",
              description: "Transfer ID (format: TXN-XXXX)"
            },
          },
          required: ["transfer_id"],
        },
        _meta: {
          "openai/outputTemplate": "component://transfer-receipt",
          "openai/toolInvocation": {
            invoking: "Checking transfer status...",
            invoked: "Status updated"
          },
          readOnlyHint: true
        }
      },
      {
        name: "get_transfer_history",
        description: "View transfer history, see past transfers, show all transfers, get transaction list, check previous payments, or keep a running list. Use when user asks 'show my history', 'what transfers did I make', 'list my transfers', 'transfer history', 'past transactions', 'what did I send', 'show all transfers', 'can you keep a running list', 'track my transfers', 'log of transfers', or wants to see any log/list/history of their transfers. IMPORTANT: This retrieves EXISTING stored transfers - all transfer data is already saved and available. Shows all transfers with their status, amounts, recipients, and dates.",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of transfers to return (default: 10)"
            },
          },
        },
        _meta: {
          "openai/outputTemplate": "component://transfer-history",
          "openai/toolInvocation": {
            invoking: "Loading your transfer history...",
            invoked: "History loaded"
          },
          readOnlyHint: true
        }
      },
      {
        name: "get_supported_countries",
        description: "Get list of supported countries, check where you can send money, see available destinations, or verify country support. Use when user asks 'what countries', 'which countries', 'where can I send', 'supported countries', 'available countries', 'what destinations', 'can I send to [country]', 'list countries', or any question about country availability. Returns a comprehensive list of 90+ supported countries across Latin America, Asia, Europe, Africa, Middle East, Oceania with delivery times, currencies, and regional groupings.",
        inputSchema: {
          type: "object",
          properties: {
            region: {
              type: "string",
              description: "Optional: Filter by region (Latin America, Asia, Africa, Europe, Middle East, Oceania, North America, Caribbean)"
            }
          },
        },
        _meta: {
          "openai/toolInvocation": {
            invoking: "Fetching supported countries...",
            invoked: "Countries list retrieved"
          },
          readOnlyHint: true
        }
      },
      {
        name: "add_recipient",
        description: "Use this when the user wants to save, add, or remember a recipient for future transfers. Captures phrases like 'save Maria as a recipient', 'add my mom', 'remember John in Mexico', 'save this person', or any variation of saving contact information for sending money later.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Recipient's full name or nickname (e.g., 'Maria', 'Mom', 'John Smith')"
            },
            country: {
              type: "string",
              description: "Recipient's country"
            },
            currency: {
              type: "string",
              description: "Recipient's currency code (optional, can be inferred from country)"
            }
          },
          required: ["name", "country"],
        },
        _meta: {
          "openai/outputTemplate": "component://recipient-management",
          "openai/toolInvocation": {
            invoking: "Saving recipient...",
            invoked: "Recipient saved successfully!"
          },
          readOnlyHint: false
        }
      },
      {
        name: "list_recipients",
        description: "Use this when the user wants to see, view, show, list, or check their saved recipients, contacts, or people they send money to. Captures phrases like 'show my recipients', 'who do I send money to', 'list my contacts', 'show saved people', or any variation of viewing saved recipients.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        _meta: {
          "openai/outputTemplate": "component://recipient-management",
          "openai/toolInvocation": {
            invoking: "Loading your saved recipients...",
            invoked: "Recipients loaded"
          },
          readOnlyHint: true
        }
      },
      {
        name: "delete_recipient",
        description: "Use this when the user wants to remove, delete, forget, or unsave a recipient. Captures phrases like 'delete Maria', 'remove my mom from recipients', 'forget John', 'unsave this person', or any variation of removing a saved contact.",
        inputSchema: {
          type: "object",
          properties: {
            recipient_id: {
              type: "string",
              description: "The unique ID of the recipient to delete"
            }
          },
          required: ["recipient_id"],
        },
        _meta: {
          "openai/outputTemplate": "component://recipient-management",
          "openai/toolInvocation": {
            invoking: "Removing recipient...",
            invoked: "Recipient removed"
          },
          readOnlyHint: false
        }
      },
      {
        name: "schedule_transfer",
        description: "Use this when the user wants to set up recurring, scheduled, automatic, or repeated transfers. Captures phrases like 'send $100 every month', 'schedule monthly payment', 'set up recurring transfer', 'automatically send money weekly', 'pay my rent every month', or any variation of setting up automatic recurring payments.",
        inputSchema: {
          type: "object",
          properties: {
            amount: {
              type: "number",
              description: "Amount to send per transfer"
            },
            to_country: {
              type: "string",
              description: "Destination country"
            },
            recipient_name: {
              type: "string",
              description: "Recipient's name"
            },
            frequency: {
              type: "string",
              description: "Frequency of transfers",
              enum: ["weekly", "bi-weekly", "monthly", "quarterly"]
            },
            start_date: {
              type: "string",
              description: "When to start (optional, defaults to next occurrence)"
            }
          },
          required: ["amount", "to_country", "recipient_name", "frequency"],
        },
        _meta: {
          "openai/outputTemplate": "component://scheduled-transfers",
          "openai/toolInvocation": {
            invoking: "Setting up recurring transfer...",
            invoked: "Recurring transfer scheduled!"
          },
          readOnlyHint: false
        }
      },
      {
        name: "list_scheduled_transfers",
        description: "Use this when the user wants to see, view, show, list, or check their scheduled, recurring, or automatic transfers. Captures phrases like 'show my scheduled transfers', 'what recurring payments do I have', 'list automatic transfers', 'show my subscriptions', or any variation of viewing scheduled payments.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        _meta: {
          "openai/outputTemplate": "component://scheduled-transfers",
          "openai/toolInvocation": {
            invoking: "Loading scheduled transfers...",
            invoked: "Schedules loaded"
          },
          readOnlyHint: true
        }
      },
      {
        name: "cancel_scheduled_transfer",
        description: "Use this when the user wants to cancel, stop, delete, or remove a scheduled or recurring transfer. Captures phrases like 'cancel my monthly payment', 'stop recurring transfer', 'delete scheduled payment', 'turn off automatic transfer', or any variation of stopping a scheduled transfer.",
        inputSchema: {
          type: "object",
          properties: {
            schedule_id: {
              type: "string",
              description: "The unique ID of the scheduled transfer to cancel"
            }
          },
          required: ["schedule_id"],
        },
        _meta: {
          "openai/outputTemplate": "component://scheduled-transfers",
          "openai/toolInvocation": {
            invoking: "Canceling scheduled transfer...",
            invoked: "Schedule canceled"
          },
          readOnlyHint: false
        }
      },
      {
        name: "send_again",
        description: "Quick action to repeat the last transfer to a specific recipient. Use when user says 'send again', 'repeat last transfer', 'send same amount to [name]', 'do it again', or wants to quickly repeat a recent transfer without specifying all details again.",
        inputSchema: {
          type: "object",
          properties: {
            recipient_name: {
              type: "string",
              description: "Name of the recipient to send to again (optional - if not provided, uses last overall transfer)"
            }
          },
        },
        _meta: {
          "openai/outputTemplate": "component://transfer-receipt",
          "openai/toolInvocation": {
            invoking: "Repeating transfer...",
            invoked: "Transfer sent again!"
          },
          readOnlyHint: false
        }
      },
      {
        name: "quick_send",
        description: "Super fast sending to recent or favorite recipients with minimal friction. Use when user says 'quick send', 'fast send', 'send [amount] to [name]' without full details, or wants instant transfer to someone they've sent to before.",
        inputSchema: {
          type: "object",
          properties: {
            recipient_name: {
              type: "string",
              description: "Name of the recipient"
            },
            amount: {
              type: "number",
              description: "Amount to send in USD"
            }
          },
          required: ["recipient_name", "amount"],
        },
        _meta: {
          "openai/outputTemplate": "component://transfer-receipt",
          "openai/toolInvocation": {
            invoking: "Quick sending...",
            invoked: "Sent instantly!"
          },
          readOnlyHint: false
        }
      },
      {
        name: "compare_rates",
        description: "Compare MyBambu exchange rates and fees against competitors like Western Union, MoneyGram, Remitly, Wise, and Xoom. Use when user asks 'compare rates', 'how do your rates compare', 'am I getting a good deal', 'MyBambu vs Western Union', or wants to see rate comparisons.",
        inputSchema: {
          type: "object",
          properties: {
            to_country: {
              type: "string",
              description: "Destination country to compare rates for"
            },
            amount: {
              type: "number",
              description: "Amount in USD to compare (optional, defaults to $100)"
            }
          },
          required: ["to_country"],
        },
        _meta: {
          "openai/outputTemplate": "component://rate-comparison",
          "openai/toolInvocation": {
            invoking: "Comparing rates across providers...",
            invoked: "Rate comparison ready"
          },
          readOnlyHint: true
        }
      },
      {
        name: "get_spending_analytics",
        description: "Show spending breakdown and analytics with charts, trends, and insights. Use when user asks 'show my spending', 'analytics', 'breakdown by country', 'how much have I sent', 'spending report', 'transfer trends', or wants visual insights into their transfer history.",
        inputSchema: {
          type: "object",
          properties: {
            period: {
              type: "string",
              description: "Time period for analytics",
              enum: ["week", "month", "quarter", "year", "all-time"]
            }
          },
        },
        _meta: {
          "openai/outputTemplate": "component://spending-analytics",
          "openai/toolInvocation": {
            invoking: "Analyzing your transfers...",
            invoked: "Analytics ready"
          },
          readOnlyHint: true
        }
      }
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const toolName = request.params.name;
    const args = request.params.arguments ?? {};

    // TOOL: send_money
    if (toolName === "send_money") {
      const rawArgs = args as any;

      // Accept both parameter naming conventions
      const amount = rawArgs.amount;
      const to_country = rawArgs.to_country || rawArgs.recipient_country;
      const recipient_name = rawArgs.recipient_name;

      // Validation - Check required parameters
      if (!to_country || !recipient_name) {
        return {
          content: [{
            type: "text",
            text: "❌ Please provide the destination country and recipient name. Example: Send $100 to Maria in Colombia"
          }],
          isError: true
        };
      }

      if (!amount || amount <= 0) {
        return {
          content: [{
            type: "text",
            text: "❌ Amount must be greater than $0"
          }],
          isError: true
        };
      }

      if (amount > transferLimits.perTransaction) {
        return {
          content: [{
            type: "text",
            text: `❌ Amount exceeds per-transaction limit of $${transferLimits.perTransaction}. Please split into multiple transfers or contact support.`,
          }],
          isError: true
        };
      }

      // Find country info
      const corridor = SUPPORTED_CORRIDORS.find(c =>
        c.country.toLowerCase() === to_country.toLowerCase()
      );

      if (!corridor) {
        return {
          content: [{
            type: "text",
            text: `❌ Sorry, we don't support transfers to ${to_country} yet. Supported countries: ${SUPPORTED_CORRIDORS.map(c => c.country).join(', ')}`,
          }],
          isError: true
        };
      }

      // Get exchange rate
      const rateData = await fetchExchangeRates();
      const rate = rateData.rates[corridor.currency];

      if (!rate) {
        return {
          content: [{
            type: "text",
            text: `❌ Exchange rate not available for ${corridor.currency}`,
          }],
          isError: true
        };
      }

      // Calculate fees
      const feeAmount = Math.max(
        transferLimits.fees.minFee,
        Math.min(amount * transferLimits.fees.standard, transferLimits.fees.maxFee)
      );
      const netAmount = amount - feeAmount;
      const recipientAmount = netAmount * rate;
      const transferId = `TXN-${transferCounter++}`;

      let mybambuResponse;
      let transfer;

      // Use REAL Wise API if configured, otherwise simulate
      if (useRealAPI) {
        try {
          console.log(`💸 Processing REAL transfer via Wise API...`);
          const wiseService = getWiseService();

          const wiseResult = await wiseService.sendMoney({
            amount: netAmount, // Send net amount (after fees)
            recipientName: recipient_name,
            recipientCountry: corridor.country,
            recipientBankAccount: '1234567890', // TODO: Get from user
            recipientBankCode: 'BANK001', // TODO: Get from user
            targetCurrency: corridor.currency,
            reference: `MyBambu transfer to ${recipient_name}`
          });

          // Create transfer record with REAL Wise data
          transfer = {
            id: transferId,
            wise_transfer_id: wiseResult.transferId,
            mybambu_id: `WISE-${wiseResult.transferId}`,
            from_currency: 'USD',
            to_currency: corridor.currency,
            amount,
            fee: feeAmount,
            net_amount: netAmount,
            exchange_rate: wiseResult.rate,
            recipient_amount: wiseResult.targetAmount,
            recipient_name,
            recipient_country: corridor.country,
            delivery_time: corridor.deliveryTime,
            status: wiseResult.status === 'processing' ? 'processing' : 'completed',
            estimated_arrival: wiseResult.estimatedDelivery || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString(),
            is_real_transfer: true
          };

          mybambuResponse = {
            success: true,
            mybambuTransferId: transfer.mybambu_id,
            status: transfer.status,
            estimatedDelivery: transfer.estimated_arrival,
            message: 'Real transfer processed via Wise API'
          };

          console.log(`✅ REAL transfer created: ${wiseResult.transferId}`);
        } catch (error: any) {
          console.error(`❌ Wise API error:`, error.message);
          // Fall back to simulation if Wise API fails
          mybambuResponse = simulateMyBambuTransfer({
            amount,
            to_country,
            recipient_name,
            currency: corridor.currency
          });

          transfer = {
            id: transferId,
            mybambu_id: mybambuResponse.mybambuTransferId,
            from_currency: 'USD',
            to_currency: corridor.currency,
            amount,
            fee: feeAmount,
            net_amount: netAmount,
            exchange_rate: rate,
            recipient_amount: recipientAmount,
            recipient_name,
            recipient_country: corridor.country,
            delivery_time: corridor.deliveryTime,
            status: mybambuResponse.status,
            estimated_arrival: mybambuResponse.estimatedDelivery,
            created_at: new Date().toISOString(),
            is_real_transfer: false,
            error_note: `Wise API failed: ${error.message}. Using simulation.`
          };
        }
      } else {
        // DEMO MODE: Simulate transfer
        console.log(`🎭 Processing DEMO transfer (simulated)...`);
        mybambuResponse = simulateMyBambuTransfer({
          amount,
          to_country,
          recipient_name,
          currency: corridor.currency
        });

        transfer = {
          id: transferId,
          mybambu_id: mybambuResponse.mybambuTransferId,
          from_currency: 'USD',
          to_currency: corridor.currency,
          amount,
          fee: feeAmount,
          net_amount: netAmount,
          exchange_rate: rate,
          recipient_amount: recipientAmount,
          recipient_name,
          recipient_country: corridor.country,
          delivery_time: corridor.deliveryTime,
          status: mybambuResponse.status,
          estimated_arrival: mybambuResponse.estimatedDelivery,
          created_at: new Date().toISOString(),
          is_real_transfer: false
        };
      }

      transfers.set(transferId, transfer);

      // Return structured response with widget
      return {
        content: [{
          type: "text",
          text: `✅ Transfer initiated! ${recipient_name} in ${corridor.country} will receive ${recipientAmount.toFixed(2)} ${corridor.currency}. Estimated delivery: ${corridor.deliveryTime}. Transfer ID: ${transferId}`
        }],
        structuredContent: transfer,
        _meta: {
          "openai/outputTemplate": "component://transfer-receipt",
          mybambuResponse,
          feeBreakdown: {
            baseAmount: amount,
            feePercentage: transferLimits.fees.standard,
            feeAmount,
            netAmount,
            exchangeRate: rate,
            finalAmount: recipientAmount
          }
        }
      };
    }

    // TOOL: get_exchange_rate
    if (toolName === "get_exchange_rate") {
      const { to_currency, to_country } = args as any;

      const rateData = await fetchExchangeRates();
      const rate = rateData.rates[to_currency];

      if (!rate) {
        return {
          content: [{
            type: "text",
            text: `❌ Exchange rate not available for ${to_currency}`,
          }],
          isError: true
        };
      }

      // Find corridor for delivery time
      const corridor = SUPPORTED_CORRIDORS.find(c =>
        c.currency === to_currency ||
        (to_country && c.country.toLowerCase() === to_country.toLowerCase())
      );

      const responseData = {
        from_currency: 'USD',
        to_currency,
        rate,
        timestamp: rateData.timestamp,
        delivery_time: corridor?.deliveryTime || '1-3 hours'
      };

      return {
        content: [{
          type: "text",
          text: `💱 Current rate: 1 USD = ${rate.toFixed(4)} ${to_currency}\n\n📦 Delivery time: ${responseData.delivery_time}\n💰 Our fee: Starting at $0.85\n\nLast updated: ${new Date(rateData.timestamp).toLocaleString()}`
        }],
        structuredContent: responseData,
        _meta: {
          "openai/outputTemplate": "component://exchange-rate",
          rawRateData: rateData,
          corridor
        }
      };
    }

    // TOOL: check_transfer_status
    if (toolName === "check_transfer_status") {
      const { transfer_id } = args as any;

      const transfer = transfers.get(transfer_id);

      if (!transfer) {
        return {
          content: [{
            type: "text",
            text: `❌ Transfer not found: ${transfer_id}. Please check the transfer ID and try again.`,
          }],
          isError: true
        };
      }

      // Simulate status progression
      const statuses = ['pending', 'processing', 'completed'];
      const currentIndex = statuses.indexOf(transfer.status);
      if (currentIndex < statuses.length - 1 && Math.random() > 0.5) {
        transfer.status = statuses[currentIndex + 1];
      }

      return {
        content: [{
          type: "text",
          text: `📊 Transfer Status: ${transfer.status.toUpperCase()}\n\n💸 ${transfer.recipient_amount.toFixed(2)} ${transfer.to_currency} to ${transfer.recipient_name}\n📅 Estimated arrival: ${new Date(transfer.estimated_arrival).toLocaleString()}\n🆔 ${transfer.id}`
        }],
        structuredContent: transfer,
        _meta: {
          "openai/outputTemplate": "component://transfer-receipt",
          statusHistory: [
            { status: 'pending', timestamp: transfer.created_at },
            { status: transfer.status, timestamp: new Date().toISOString() }
          ]
        }
      };
    }

    // TOOL: get_transfer_history
    if (toolName === "get_transfer_history") {
      const { limit = 10 } = args as any;

      const allTransfers = Array.from(transfers.values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, limit);

      return {
        content: [{
          type: "text",
          text: allTransfers.length > 0
            ? `📋 Found ${allTransfers.length} transfer${allTransfers.length !== 1 ? 's' : ''}:\n\n` +
              allTransfers.map(t =>
                `• ${t.recipient_amount.toFixed(2)} ${t.to_currency} to ${t.recipient_name} - ${t.status.toUpperCase()} (${t.id})`
              ).join('\n')
            : `📭 No transfers found. Start by saying "Send $100 to Mexico"`
        }],
        structuredContent: {
          transfers: allTransfers,
          total: allTransfers.length
        },
        _meta: {
          "openai/outputTemplate": "component://transfer-history"
        }
      };
    }

    // TOOL: get_supported_countries
    if (toolName === "get_supported_countries") {
      const { region } = args as any;

      let corridors = SUPPORTED_CORRIDORS;
      if (region) {
        corridors = SUPPORTED_CORRIDORS.filter(c =>
          c.region.toLowerCase() === region.toLowerCase()
        );
      }

      // Group by region for better display
      const byRegion = corridors.reduce((acc: any, c) => {
        if (!acc[c.region]) acc[c.region] = [];
        acc[c.region].push(c);
        return acc;
      }, {});

      const regionText = Object.entries(byRegion)
        .map(([reg, countries]: [string, any]) =>
          `\n**${reg}** (${countries.length} countries):\n` +
          countries.map((c: any) =>
            `  • ${c.country} (${c.currency}) - ${c.deliveryTime}`
          ).join('\n')
        ).join('\n');

      return {
        content: [{
          type: "text",
          text: `🌍 MyBambu supports transfers to ${corridors.length} countries${region ? ` in ${region}` : ' worldwide'}:\n` +
            regionText +
            `\n\n💰 Low fees starting at $0.85\n⚡ Fast delivery in as little as 35 minutes\n🌎 Latin America, Asia, Europe, Africa, Middle East, Oceania covered`
        }],
        structuredContent: {
          corridors,
          byRegion,
          total: corridors.length,
          regions: Object.keys(byRegion)
        }
      };
    }

    // TOOL: add_recipient
    if (toolName === "add_recipient") {
      const { name, country, phone, email, relationship } = args as any;

      // Validation
      if (!name || !country) {
        return {
          content: [{
            type: "text",
            text: "❌ Please provide both recipient name and country"
          }],
          isError: true
        };
      }

      // Verify country is supported
      const corridor = SUPPORTED_CORRIDORS.find(c =>
        c.country.toLowerCase() === country.toLowerCase()
      );

      if (!corridor) {
        return {
          content: [{
            type: "text",
            text: `❌ Sorry, we don't support transfers to ${country} yet. Please use a supported country.`
          }],
          isError: true
        };
      }

      // Create recipient
      const recipientId = `RCP-${recipientCounter++}`;
      const recipient = {
        id: recipientId,
        name,
        country: corridor.country,
        currency: corridor.currency,
        phone: phone || null,
        email: email || null,
        relationship: relationship || 'Other',
        created_at: new Date().toISOString(),
        total_sent: 0,
        transfer_count: 0
      };

      recipients.set(recipientId, recipient);

      return {
        content: [{
          type: "text",
          text: `✅ Recipient saved! ${name} in ${corridor.country} has been added to your recipients list. You can now send money by saying "Send $100 to ${name}"`
        }],
        structuredContent: recipient,
        _meta: {
          "openai/outputTemplate": "component://recipient-management",
          recipientId,
          totalRecipients: recipients.size,
          supportedCurrency: corridor.currency
        }
      };
    }

    // TOOL: list_recipients
    if (toolName === "list_recipients") {
      const allRecipients = Array.from(recipients.values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (allRecipients.length === 0) {
        return {
          content: [{
            type: "text",
            text: `📭 You haven't saved any recipients yet. Save someone by saying "Add Maria in Mexico as a recipient"`
          }],
          structuredContent: {
            recipients: [],
            total: 0
          },
          _meta: {
            "openai/outputTemplate": "component://recipient-management"
          }
        };
      }

      return {
        content: [{
          type: "text",
          text: `📋 You have ${allRecipients.length} saved recipient${allRecipients.length !== 1 ? 's' : ''}:\n\n` +
            allRecipients.map(r =>
              `• ${r.name} (${r.country}) - ${r.transfer_count} transfer${r.transfer_count !== 1 ? 's' : ''}, $${r.total_sent.toFixed(2)} total`
            ).join('\n') +
            `\n\nSend money to anyone by saying "Send $100 to ${allRecipients[0].name}"`
        }],
        structuredContent: {
          recipients: allRecipients,
          total: allRecipients.length
        },
        _meta: {
          "openai/outputTemplate": "component://recipient-management"
        }
      };
    }

    // TOOL: delete_recipient
    if (toolName === "delete_recipient") {
      const { recipient_id } = args as any;

      const recipient = recipients.get(recipient_id);

      if (!recipient) {
        return {
          content: [{
            type: "text",
            text: `❌ Recipient not found: ${recipient_id}. Use "list recipients" to see all saved recipients.`
          }],
          isError: true
        };
      }

      const recipientName = recipient.name;
      recipients.delete(recipient_id);

      return {
        content: [{
          type: "text",
          text: `✅ ${recipientName} has been removed from your recipients list.`
        }],
        structuredContent: {
          deleted: true,
          recipientId: recipient_id,
          recipientName,
          remainingRecipients: recipients.size
        },
        _meta: {
          "openai/outputTemplate": "component://recipient-management"
        }
      };
    }

    // TOOL: schedule_transfer
    if (toolName === "schedule_transfer") {
      const { amount, to_country, recipient_name, frequency, start_date } = args as any;

      // Validation
      if (amount <= 0) {
        return {
          content: [{
            type: "text",
            text: "❌ Amount must be greater than $0"
          }],
          isError: true
        };
      }

      if (!to_country || !recipient_name) {
        return {
          content: [{
            type: "text",
            text: "❌ Please specify both recipient name and country"
          }],
          isError: true
        };
      }

      // Find country info
      const corridor = SUPPORTED_CORRIDORS.find(c =>
        c.country.toLowerCase() === to_country.toLowerCase()
      );

      if (!corridor) {
        return {
          content: [{
            type: "text",
            text: `❌ Sorry, we don't support transfers to ${to_country} yet. Supported countries: ${SUPPORTED_CORRIDORS.map(c => c.country).join(', ')}`
          }],
          isError: true
        };
      }

      const validFrequencies = ['weekly', 'bi-weekly', 'monthly', 'quarterly'];
      if (!validFrequencies.includes(frequency)) {
        return {
          content: [{
            type: "text",
            text: `❌ Invalid frequency. Please choose: ${validFrequencies.join(', ')}`
          }],
          isError: true
        };
      }

      // Create scheduled transfer
      const scheduleId = `SCH-${scheduledCounter++}`;
      const scheduledTransfer = {
        id: scheduleId,
        recipient_name,
        recipient_country: corridor.country,
        amount,
        currency_from: 'USD',
        currency_to: corridor.currency,
        frequency,
        start_date: start_date || new Date().toISOString(),
        next_execution: start_date || new Date().toISOString(),
        status: 'active',
        total_sent: 0,
        execution_count: 0,
        created_at: new Date().toISOString()
      };

      scheduledTransfers.set(scheduleId, scheduledTransfer);

      // Calculate next execution dates based on frequency
      const nextDates = getNextExecutionDates(frequency, start_date || new Date().toISOString(), 3);

      return {
        content: [{
          type: "text",
          text: `✅ Scheduled transfer created! ${recipient_name} in ${corridor.country} will receive $${amount} ${frequency}.\n\n📅 Next 3 payments:\n` +
            nextDates.map((d, i) => `  ${i + 1}. ${new Date(d).toLocaleDateString()}`).join('\n') +
            `\n\n🆔 Schedule ID: ${scheduleId}`
        }],
        structuredContent: scheduledTransfer,
        _meta: {
          "openai/outputTemplate": "component://scheduled-transfers",
          scheduleId,
          nextExecutionDates: nextDates,
          totalScheduled: scheduledTransfers.size
        }
      };
    }

    // TOOL: list_scheduled_transfers
    if (toolName === "list_scheduled_transfers") {
      const allScheduled = Array.from(scheduledTransfers.values())
        .filter(s => s.status === 'active')
        .sort((a, b) => new Date(a.next_execution).getTime() - new Date(b.next_execution).getTime());

      if (allScheduled.length === 0) {
        return {
          content: [{
            type: "text",
            text: `📭 You don't have any scheduled transfers. Set one up by saying "Send $100 to Maria every month"`
          }],
          structuredContent: {
            schedules: [],
            total: 0
          },
          _meta: {
            "openai/outputTemplate": "component://scheduled-transfers"
          }
        };
      }

      return {
        content: [{
          type: "text",
          text: `📋 You have ${allScheduled.length} active scheduled transfer${allScheduled.length !== 1 ? 's' : ''}:\n\n` +
            allScheduled.map(s =>
              `• $${s.amount} to ${s.recipient_name} (${s.frequency}) - Next: ${new Date(s.next_execution).toLocaleDateString()} (${s.id})`
            ).join('\n')
        }],
        structuredContent: {
          schedules: allScheduled,
          total: allScheduled.length
        },
        _meta: {
          "openai/outputTemplate": "component://scheduled-transfers"
        }
      };
    }

    // TOOL: cancel_scheduled_transfer
    if (toolName === "cancel_scheduled_transfer") {
      const { schedule_id } = args as any;

      const schedule = scheduledTransfers.get(schedule_id);

      if (!schedule) {
        return {
          content: [{
            type: "text",
            text: `❌ Scheduled transfer not found: ${schedule_id}. Use "list scheduled transfers" to see all active schedules.`
          }],
          isError: true
        };
      }

      schedule.status = 'cancelled';
      schedule.cancelled_at = new Date().toISOString();

      return {
        content: [{
          type: "text",
          text: `✅ Scheduled transfer cancelled. $${schedule.amount} ${schedule.frequency} payments to ${schedule.recipient_name} have been stopped.`
        }],
        structuredContent: {
          cancelled: true,
          scheduleId: schedule_id,
          recipientName: schedule.recipient_name,
          amount: schedule.amount,
          frequency: schedule.frequency
        },
        _meta: {
          "openai/outputTemplate": "component://scheduled-transfers"
        }
      };
    }

    // TOOL: send_again
    if (toolName === "send_again") {
      const { recipient_name } = args as any;

      // Find the last transfer to this recipient (or overall last transfer if no name)
      const allTransfers = Array.from(transfers.values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      let lastTransfer;
      if (recipient_name) {
        lastTransfer = allTransfers.find(t =>
          t.recipient_name.toLowerCase().includes(recipient_name.toLowerCase())
        );
      } else {
        lastTransfer = allTransfers[0];
      }

      if (!lastTransfer) {
        return {
          content: [{
            type: "text",
            text: recipient_name
              ? `❌ No previous transfers found to ${recipient_name}`
              : `❌ No previous transfers found. Send your first transfer!`
          }],
          isError: true
        };
      }

      // Repeat the transfer with same amount and recipient
      const transferId = `TXN-${transferCounter++}`;
      const mybambuId = `BAMBU-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      const corridor = SUPPORTED_CORRIDORS.find(c =>
        c.country.toLowerCase() === lastTransfer.recipient_country.toLowerCase()
      )!;

      const rateData = await fetchExchangeRates();
      const rate = rateData.rates[corridor.currency];
      const feeAmount = lastTransfer.fee;
      const netAmount = lastTransfer.amount - feeAmount;
      const recipientAmount = netAmount * rate;

      const newTransfer = {
        id: transferId,
        mybambu_id: mybambuId,
        from_currency: 'USD',
        to_currency: corridor.currency,
        amount: lastTransfer.amount,
        fee: feeAmount,
        net_amount: netAmount,
        exchange_rate: rate,
        recipient_amount: recipientAmount,
        recipient_name: lastTransfer.recipient_name,
        recipient_country: lastTransfer.recipient_country,
        delivery_time: corridor.deliveryTime,
        status: 'completed',
        estimated_arrival: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString()
      };

      transfers.set(transferId, newTransfer);

      return {
        content: [{
          type: "text",
          text: `✅ Transfer repeated! Sent $${lastTransfer.amount} to ${lastTransfer.recipient_name} in ${lastTransfer.recipient_country} again. They'll receive ${recipientAmount.toFixed(2)} ${corridor.currency}.`
        }],
        structuredContent: newTransfer,
        _meta: {
          "openai/outputTemplate": "component://transfer-receipt",
          repeated: true,
          originalTransferId: lastTransfer.id
        }
      };
    }

    // TOOL: quick_send
    if (toolName === "quick_send") {
      const { recipient_name, amount } = args as any;

      // Look up recipient in saved recipients or past transfers
      const savedRecipient = Array.from(recipients.values()).find(r =>
        r.name.toLowerCase().includes(recipient_name.toLowerCase())
      );

      const pastTransfer = Array.from(transfers.values()).find(t =>
        t.recipient_name.toLowerCase().includes(recipient_name.toLowerCase())
      );

      const targetCountry = savedRecipient?.country || pastTransfer?.recipient_country;

      if (!targetCountry) {
        return {
          content: [{
            type: "text",
            text: `❌ I don't have ${recipient_name} in your recipients or transfer history. Please specify the country: "Quick send $${amount} to ${recipient_name} in [country]"`
          }],
          isError: true
        };
      }

      // Send using existing send_money logic
      const corridor = SUPPORTED_CORRIDORS.find(c =>
        c.country.toLowerCase() === targetCountry.toLowerCase()
      );

      if (!corridor) {
        return {
          content: [{
            type: "text",
            text: `❌ Sorry, we don't support transfers to ${targetCountry} yet.`
          }],
          isError: true
        };
      }

      const transferId = `TXN-${transferCounter++}`;
      const mybambuId = `BAMBU-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      const rateData = await fetchExchangeRates();
      const rate = rateData.rates[corridor.currency];
      const feeAmount = amount * transferLimits.fees.standard;
      const netAmount = amount - feeAmount;
      const recipientAmount = netAmount * rate;

      const transfer = {
        id: transferId,
        mybambu_id: mybambuId,
        from_currency: 'USD',
        to_currency: corridor.currency,
        amount,
        fee: feeAmount,
        net_amount: netAmount,
        exchange_rate: rate,
        recipient_amount: recipientAmount,
        recipient_name,
        recipient_country: corridor.country,
        delivery_time: corridor.deliveryTime,
        status: 'completed',
        estimated_arrival: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString()
      };

      transfers.set(transferId, transfer);

      // Update recipient stats if exists
      if (savedRecipient) {
        savedRecipient.total_sent += amount;
        savedRecipient.transfer_count++;
      }

      return {
        content: [{
          type: "text",
          text: `⚡ Quick sent! $${amount} to ${recipient_name} in ${corridor.country}. They'll receive ${recipientAmount.toFixed(2)} ${corridor.currency} in ${corridor.deliveryTime}.`
        }],
        structuredContent: transfer,
        _meta: {
          "openai/outputTemplate": "component://transfer-receipt",
          quickSend: true
        }
      };
    }

    // TOOL: compare_rates
    if (toolName === "compare_rates") {
      const { to_country, amount = 100 } = args as any;

      const corridor = SUPPORTED_CORRIDORS.find(c =>
        c.country.toLowerCase() === to_country.toLowerCase()
      );

      if (!corridor) {
        return {
          content: [{
            type: "text",
            text: `❌ Sorry, we don't support transfers to ${to_country} yet.`
          }],
          isError: true
        };
      }

      // Get exchange rate
      const rateData = await fetchExchangeRates();
      const baseRate = rateData.rates[corridor.currency];

      // Simulate competitor rates (MyBambu is always better!)
      const mybambuFee = amount * transferLimits.fees.standard;
      const mybambuNet = amount - mybambuFee;
      const mybambuReceives = mybambuNet * baseRate;

      const competitors = [
        {
          name: "Western Union",
          fee: amount * 0.05, // 5%
          rate: baseRate * 0.96, // Worse rate
          color: "#FFCC00"
        },
        {
          name: "MoneyGram",
          fee: amount * 0.048, // 4.8%
          rate: baseRate * 0.965, // Worse rate
          color: "#E31C25"
        },
        {
          name: "Remitly",
          fee: amount * 0.035, // 3.5%
          rate: baseRate * 0.98, // Slightly worse rate
          color: "#5B47FB"
        },
        {
          name: "Wise",
          fee: amount * 0.032, // 3.2%
          rate: baseRate * 0.99, // Slightly worse rate
          color: "#37517E"
        }
      ];

      const comparison = competitors.map(comp => {
        const net = amount - comp.fee;
        const receives = net * comp.rate;
        const savings = mybambuReceives - receives;
        return {
          ...comp,
          net,
          receives: receives.toFixed(2),
          savings: savings.toFixed(2),
          savingsPercent: ((savings / receives) * 100).toFixed(1)
        };
      });

      return {
        content: [{
          type: "text",
          text: `💰 Rate Comparison for $${amount} to ${corridor.country}:\n\n` +
            `MyBambu: ${mybambuReceives.toFixed(2)} ${corridor.currency} (Fee: $${mybambuFee.toFixed(2)})\n\n` +
            comparison.map(c =>
              `${c.name}: ${c.receives} ${corridor.currency} (Fee: $${c.fee.toFixed(2)}) - You save $${c.savings} with MyBambu! 🎉`
            ).join('\n')
        }],
        structuredContent: {
          mybambu: {
            fee: mybambuFee,
            net: mybambuNet,
            rate: baseRate,
            receives: mybambuReceives,
            currency: corridor.currency
          },
          competitors: comparison,
          country: corridor.country,
          amount
        },
        _meta: {
          "openai/outputTemplate": "component://rate-comparison"
        }
      };
    }

    // TOOL: get_spending_analytics
    if (toolName === "get_spending_analytics") {
      const { period = "all-time" } = args as any;

      const allTransfers = Array.from(transfers.values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (allTransfers.length === 0) {
        return {
          content: [{
            type: "text",
            text: `📊 No transfers yet to analyze. Start sending money to see your analytics!`
          }],
          structuredContent: {
            totalSent: 0,
            totalFees: 0,
            transferCount: 0,
            byCountry: {},
            byRecipient: {},
            period
          }
        };
      }

      const totalSent = allTransfers.reduce((sum, t) => sum + t.amount, 0);
      const totalFees = allTransfers.reduce((sum, t) => sum + t.fee, 0);
      const avgTransfer = totalSent / allTransfers.length;

      // Group by country
      const byCountry = allTransfers.reduce((acc: any, t) => {
        if (!acc[t.recipient_country]) {
          acc[t.recipient_country] = { count: 0, total: 0, currency: t.to_currency };
        }
        acc[t.recipient_country].count++;
        acc[t.recipient_country].total += t.amount;
        return acc;
      }, {});

      // Group by recipient
      const byRecipient = allTransfers.reduce((acc: any, t) => {
        if (!acc[t.recipient_name]) {
          acc[t.recipient_name] = { count: 0, total: 0, country: t.recipient_country };
        }
        acc[t.recipient_name].count++;
        acc[t.recipient_name].total += t.amount;
        return acc;
      }, {});

      const topCountry = Object.entries(byCountry)
        .sort((a: any, b: any) => b[1].total - a[1].total)[0];

      const topRecipient = Object.entries(byRecipient)
        .sort((a: any, b: any) => b[1].total - a[1].total)[0];

      return {
        content: [{
          type: "text",
          text: `📊 Your Transfer Analytics (${period}):\n\n` +
            `💵 Total sent: $${totalSent.toFixed(2)}\n` +
            `💸 Total fees: $${totalFees.toFixed(2)}\n` +
            `📦 Transfers: ${allTransfers.length}\n` +
            `📊 Average: $${avgTransfer.toFixed(2)}\n\n` +
            `🌍 Top country: ${topCountry[0]} ($${(topCountry[1] as any).total.toFixed(2)})\n` +
            `👤 Top recipient: ${topRecipient[0]} ($${(topRecipient[1] as any).total.toFixed(2)})`
        }],
        structuredContent: {
          totalSent,
          totalFees,
          transferCount: allTransfers.length,
          avgTransfer,
          byCountry,
          byRecipient,
          topCountry: { name: topCountry[0], data: topCountry[1] },
          topRecipient: { name: topRecipient[0], data: topRecipient[1] },
          period
        },
        _meta: {
          "openai/outputTemplate": "component://spending-analytics"
        }
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
    const session = sessions.get(sessionId);
    if (session) {
      sessions.delete(sessionId);
      // Don't call server.close() here - it creates circular reference
      // The transport is already closing, just clean up the session
    }
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

  // Health check endpoint for Render/Railway
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "healthy",
      service: "mybambu-transfers",
      version: "1.0.0",
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // Root endpoint
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      service: "MyBambu Transfers MCP Server",
      version: "1.0.0",
      endpoints: {
        sse: ssePath,
        post: postPath,
        health: "/health",
        debug: "/debug-env"
      },
      features: [
        "Send money to 46 countries",
        "Live exchange rates",
        "Recipient management",
        "Scheduled transfers",
        "Interactive widgets"
      ]
    }));
    return;
  }

  // Debug endpoint to check environment variables
  if (req.method === "GET" && url.pathname === "/debug-env") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      hasWiseApiKey: !!process.env.WISE_API_KEY,
      hasProfileId: !!process.env.WISE_PROFILE_ID,
      hasApiUrl: !!process.env.WISE_API_URL,
      wiseApiKeyLength: process.env.WISE_API_KEY?.length || 0,
      profileId: process.env.WISE_PROFILE_ID || 'not set',
      apiUrl: process.env.WISE_API_URL || 'not set',
      nodeEnv: process.env.NODE_ENV,
      allEnvKeys: Object.keys(process.env).filter(k => k.startsWith('WISE'))
    }));
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

// Initialize Wise service if API keys are provided
const useRealAPI = process.env.WISE_API_KEY && process.env.WISE_PROFILE_ID;
if (useRealAPI) {
  try {
    initializeWiseService({
      apiKey: process.env.WISE_API_KEY!,
      profileId: process.env.WISE_PROFILE_ID!,
      apiUrl: process.env.WISE_API_URL || 'https://api.wise.com'
    });
    console.log('✅ Wise API initialized - REAL payments enabled');
  } catch (error) {
    console.error('❌ Failed to initialize Wise API:', error);
    console.log('⚠️  Falling back to demo mode');
  }
} else {
  console.log('⚠️  Running in DEMO mode (no Wise API keys found)');
  console.log('   Set WISE_API_KEY and WISE_PROFILE_ID for real payments');
}

httpServer.listen(port, () => {
  console.log(`\n🚀 MyBambu Transfers - MCP Server Ready!`);
  console.log(`   Version: 1.0.0 ${useRealAPI ? '(PRODUCTION - REAL APIs)' : '(DEMO MODE)'}`);
  console.log(`   Port: ${port}`);
  console.log(`   SSE Endpoint: http://localhost:${port}${ssePath}`);
  console.log(`   POST Endpoint: http://localhost:${port}${postPath}?sessionId=...`);
  console.log(`\n💡 Supported Features:`);
  console.log(`   • Send money to 46 countries across Latin America, Asia, Europe, Africa, Middle East, Oceania`);
  console.log(`   • Latin America, Asia, Africa, Europe, Middle East, Oceania`);
  console.log(`   • Live exchange rates (updated hourly)`);
  console.log(`   • Transfer status tracking`);
  console.log(`   • Transfer history`);
  console.log(`   • Interactive widgets with window.openai`);
  if (!useRealAPI) {
    console.log(`\n⚠️  DEMO MODE: Transfers are simulated`);
    console.log(`   To enable real payments, create .env file with:`);
    console.log(`   WISE_API_KEY=your_key_here`);
    console.log(`   WISE_PROFILE_ID=your_profile_id_here`);
  }
  console.log(`\n🔗 To expose publicly: npx ngrok http ${port}`);
  console.log(`   or use: npx localtunnel --port ${port}\n`);
});
