# Production Setup Guide

## Quick Start

Your production repo is ready! It works in **2 modes**:

### 1. DEMO MODE (Current)
- ✅ Works out of the box
- 🎭 Simulates transfers
- 🧪 Perfect for testing
- 💡 No API keys needed

### 2. PRODUCTION MODE (Real Money)
- 💸 Real Wise API transfers
- 🏦 Real bank accounts
- ✅ Live exchange rates from Wise
- 🔐 Requires API keys

## How to Enable Real Payments

### Step 1: Get Wise API Access

1. **Create Wise Business Account**
   - Go to https://wise.com/business
   - Sign up for a business account
   - Complete verification

2. **Enable API Access**
   - Log in to Wise Business dashboard
   - Go to Settings → API tokens
   - Create a new API token
   - Copy the API key (starts with `sk_...` or similar)

3. **Get Profile ID**
   - In Wise dashboard, go to Settings → Account details
   - Copy your Profile ID (numeric ID)

### Step 2: Configure Environment

1. **Create `.env` file** in project root:
   ```bash
   cp .env.example .env
   ```

2. **Add your Wise credentials**:
   ```env
   WISE_API_KEY=your_wise_api_key_here
   WISE_PROFILE_ID=your_wise_profile_id_here
   WISE_API_URL=https://api.wise.com
   ```

3. **Restart the server**:
   ```bash
   npm start
   ```

You'll see: `✅ Wise API initialized - REAL payments enabled`

## Testing Real Payments

### Start with Wise Sandbox

Before using real money, test with Wise's sandbox environment:

1. Use sandbox API key from Wise dashboard
2. Set `WISE_API_URL=https://api.sandbox.transferwise.tech`
3. Test transfers with fake accounts
4. Verify everything works

### Then Go Live

1. Switch to production API key
2. Set `WISE_API_URL=https://api.wise.com`
3. Fund your Wise balance
4. Process real transfers!

## Current Limitations (TODOs)

The code currently has placeholders for:
- ❌ Recipient bank account (hardcoded: '1234567890')
- ❌ Recipient bank code (hardcoded: 'BANK001')

**To fix**: You'll need to collect these from users via ChatGPT conversation or add recipient management tools.

## Wise API Costs

- **Per transfer**: ~1-2% fee + small fixed fee
- **Example**: $100 transfer = ~$1-2 in fees
- **Much cheaper than**: Western Union, MoneyGram, etc.

## Security Notes

- ⚠️ Never commit `.env` file (already in .gitignore)
- 🔐 Use environment variables on deployment platforms
- 🛡️ Wise API keys are secret - treat like passwords
- ✅ Server validates all transfers before processing

## What's Working Now

✅ Dual-mode operation (demo/production)
✅ Wise API integration
✅ Automatic fallback if API fails
✅ Same beautiful widgets in both modes
✅ Error handling and logging
✅ Transfer history tracking

## Next Steps

1. **Get Wise API access** (sandbox first)
2. **Test in sandbox mode**
3. **Add recipient management** (collect bank details)
4. **Deploy to production** (Render, Railway, etc.)
5. **Monitor transfers** via Wise dashboard

## Questions?

- Wise API Docs: https://api-docs.wise.com/
- Wise Sandbox: https://sandbox.transferwise.tech/
- Need help? Check the code comments in `src/services/wise.ts`

---

**Ready to go!** Start with demo mode to test, then add Wise keys when ready for real transfers.
