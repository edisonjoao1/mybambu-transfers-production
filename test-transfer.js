/**
 * Test script to send money via Wise Sandbox API
 *
 * Run: node test-transfer.js
 */

import { WiseService } from './src/services/wise.js';

const wiseService = new WiseService({
  apiKey: '1624cba2-cdfa-424f-91d8-787a5225d52e',
  profileId: '29182377',
  apiUrl: 'https://api.sandbox.transferwise.tech'
});

async function testTransfer() {
  console.log('🧪 Testing Wise Sandbox Transfer...\n');

  try {
    const result = await wiseService.sendMoney({
      amount: 100,
      recipientName: 'John Smith',
      recipientCountry: 'United Kingdom',
      recipientBankAccount: '31926819', // Wise sandbox test account
      recipientBankCode: '231470', // Wise sandbox test sort code
      targetCurrency: 'GBP',
      reference: 'Test transfer from MyBambu'
    });

    console.log('✅ Transfer Created Successfully!\n');
    console.log('📋 Transfer Details:');
    console.log(`   Transfer ID: ${result.transferId}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Amount Sent: $${result.amount} USD`);
    console.log(`   Amount Received: ${result.targetAmount} ${result.recipientCountry}`);
    console.log(`   Exchange Rate: ${result.rate}`);
    console.log(`   Fee: $${result.fee}`);
    console.log(`   Estimated Delivery: ${result.estimatedDelivery}`);
    console.log(`   Recipient: ${result.recipientName}`);
    console.log(`   Country: ${result.recipientCountry}`);

    console.log('\n📊 Check transfer status:');
    console.log(`   https://sandbox.transferwise.tech/transfers/${result.transferId}`);

    return result.transferId;

  } catch (error) {
    console.error('❌ Transfer Failed:', error.message);
    throw error;
  }
}

async function checkTransferStatus(transferId) {
  console.log(`\n🔍 Checking status for transfer ${transferId}...\n`);

  try {
    const status = await wiseService.getTransferStatus(transferId);

    console.log('📊 Transfer Status:');
    console.log(`   ID: ${status.id}`);
    console.log(`   Status: ${status.status}`);
    console.log(`   Source Amount: ${status.sourceValue} ${status.sourceCurrency}`);
    console.log(`   Target Amount: ${status.targetValue} ${status.targetCurrency}`);
    console.log(`   Created: ${new Date(status.created).toLocaleString()}`);

    return status;

  } catch (error) {
    console.error('❌ Status Check Failed:', error.message);
    throw error;
  }
}

// Run test
(async () => {
  try {
    // Test 1: Send money
    const transferId = await testTransfer();

    // Wait a moment
    console.log('\n⏳ Waiting 3 seconds before checking status...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Test 2: Check status
    await checkTransferStatus(transferId);

    console.log('\n✅ Test completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
})();
