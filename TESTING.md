# Testing Guide - MyBambu Transfers

## Current Status

✅ **What's Working:**
- Wise Sandbox API connected
- MCP server deployed on Railway
- Environment variables configured
- Quote creation (exchange rates) ✅
- Server can talk to Wise API ✅

❌ **What's NOT Working:**
- Recipient creation (hardcoded bank details are invalid)
- Full end-to-end transfers

## The Recipient Details Problem

Our code currently uses:
```javascript
recipientBankAccount: '1234567890',  // ❌ Not a real account
recipientBankCode: 'BANK001'          // ❌ Not valid
```

Each country needs specific fields. Examples:

### Mexico (MXN)
Requires ONE of:
- **CLABE:** 18-digit standardized account number
  - Example: `012345678901234567`
- **OR Card Number:** 16-digit debit card
  - Example: `1234567890123456`

### Brazil (BRL)
Requires:
- **CPF:** Tax ID (11 digits)
- **Account Number:** Bank account
- **Account Type:** checking or savings
- **Bank Code:** 3 digits

### Colombia (COP)
Requires:
- **Account Number**
- **Account Type:** checking or savings
- **Bank Code**

## Testing Options

### Option 1: Test Quote Creation Only

This works NOW without real recipient details:

```bash
# Create a simple test that just gets exchange rates
curl -X POST https://mybambu-transfers-production-production.up.railway.app/mcp/messages \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "get_exchange_rate",
      "arguments": {
        "source_currency": "USD",
        "target_currency": "MXN"
      }
    }
  }'
```

### Option 2: Use Wise Sandbox Dashboard

1. Go to https://sandbox.transferwise.tech/
2. Log in with your Wise account
3. Manually create a test recipient with proper details
4. View test transfers there

### Option 3: Get Required Fields from Wise API

Wise has an endpoint that tells you what fields each country needs:

```bash
GET https://api.sandbox.transferwise.tech/v1/account-requirements?source=USD&target=MXN&sourceAmount=100
```

This returns the exact fields needed for Mexico.

### Option 4: Test with ChatGPT/Claude (Recommended for UX testing)

1. **Add MCP server to ChatGPT:**
   - Go to ChatGPT settings
   - Add MCP server: `https://mybambu-transfers-production-production.up.railway.app/mcp`

2. **Test the conversation flow:**
   ```
   User: "I want to send money to my family in Mexico"
   ChatGPT: Shows transfer widget, asks for amount, recipient
   User: "Send $100 to Maria Rodriguez"
   ChatGPT: Shows exchange rate, fees, delivery time
   ```

   Currently this will fail at the recipient creation step, but you can see the UX flow.

## What You Need for Production

### 1. Recipient Management System

Add tools to collect recipient details via ChatGPT:

```javascript
// New MCP tool: add_recipient
{
  name: "add_recipient",
  description: "Collect and save recipient bank details",
  inputSchema: {
    recipient_name: "string",
    country: "string",
    currency: "string",
    // Country-specific fields collected dynamically based on Wise requirements
    account_details: "object"
  }
}
```

### 2. User Authentication

Track who's sending money:

- User signs up via MyBambu website
- Gets API key or session token
- ChatGPT includes user ID in requests
- Server validates user before processing transfers

### 3. Balance Management

- Users deposit funds into MyBambu account (or you charge their card)
- Check balance before allowing transfers
- Deduct from balance after successful transfer

### 4. Webhook Handling

Get notified when transfers complete:

```javascript
// Add webhook endpoint
POST /webhooks/wise
// Wise calls this when transfer status changes
// Update your database, notify user
```

### 5. Real Bank Account Collection

For each recipient, collect:
- Full legal name (as appears on bank account)
- Bank account number (format varies by country)
- Bank code (SWIFT, routing number, sort code, etc.)
- Address (some countries require)
- Tax ID (some countries require)

## Next Steps

**Immediate (This Week):**
1. ✅ Test quote creation (exchange rates) - WORKING
2. ⬜ Add tool to get required fields for each country
3. ⬜ Test conversation flow in ChatGPT (even if transfers fail)

**Short Term (Next 2 Weeks):**
1. ⬜ Build recipient management UI
2. ⬜ Add user authentication
3. ⬜ Implement proper recipient detail collection
4. ⬜ Test full end-to-end transfer with real sandbox recipient

**Before Going Live:**
1. ⬜ Switch to production Wise API
2. ⬜ Add balance management
3. ⬜ Set up webhook handling
4. ⬜ Add transaction history storage
5. ⬜ Implement fraud detection / limits
6. ⬜ Legal compliance check

## Testing the MCP Connection (No Transfer)

You can test the MCP connection WITHOUT doing transfers:

1. Add your server to ChatGPT
2. Ask: "What countries can I send money to?"
3. Ask: "What's the exchange rate for USD to MXN?"
4. Ask: "Show me my recent transfers" (will be empty)

These will work and show you the widgets without needing real bank accounts.

## Questions?

- Wise API Docs: https://docs.wise.com/
- Wise Sandbox: https://sandbox.transferwise.tech/
- Check your transfer history: GET /v1/profiles/{profileId}/transfers
