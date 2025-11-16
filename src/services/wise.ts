import axios, { AxiosInstance } from 'axios';

interface WiseConfig {
  apiKey: string;
  profileId: string;
  apiUrl: string;
}

interface QuoteRequest {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
}

interface RecipientRequest {
  currency: string;
  type: string;
  accountHolderName: string;
  details: {
    legalType: string;
    accountNumber: string;
    bankCode?: string;
  };
}

interface TransferRequest {
  targetAccount: number;
  quoteUuid: string;
  customerTransactionId: string;
  details?: {
    reference?: string;
  };
}

export class WiseService {
  private client: AxiosInstance;
  private profileId: string;

  constructor(config: WiseConfig) {
    this.profileId = config.profileId;
    this.client = axios.create({
      baseURL: config.apiUrl,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Create a quote for a transfer
   */
  async createQuote(request: QuoteRequest) {
    try {
      const response = await this.client.post('/v2/quotes', {
        sourceCurrency: request.sourceCurrency,
        targetCurrency: request.targetCurrency,
        sourceAmount: request.sourceAmount,
        targetAmount: null,
        profile: this.profileId
      });
      return response.data;
    } catch (error: any) {
      console.error('Wise Quote Error:', error.response?.data || error.message);
      throw new Error(`Failed to create quote: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Create a recipient
   */
  async createRecipient(request: RecipientRequest) {
    try {
      const response = await this.client.post('/v1/accounts', {
        currency: request.currency,
        type: request.type,
        profile: this.profileId,
        accountHolderName: request.accountHolderName,
        details: request.details
      });
      return response.data;
    } catch (error: any) {
      console.error('Wise Recipient Error:', error.response?.data || error.message);
      throw new Error(`Failed to create recipient: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Create a transfer
   */
  async createTransfer(request: TransferRequest) {
    try {
      const response = await this.client.post('/v1/transfers', {
        targetAccount: request.targetAccount,
        quoteUuid: request.quoteUuid,
        customerTransactionId: request.customerTransactionId,
        details: request.details || {}
      });
      return response.data;
    } catch (error: any) {
      console.error('Wise Transfer Error:', error.response?.data || error.message);
      throw new Error(`Failed to create transfer: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Fund a transfer (move money from your Wise balance)
   */
  async fundTransfer(transferId: number) {
    try {
      const response = await this.client.post(`/v3/profiles/${this.profileId}/transfers/${transferId}/payments`, {
        type: 'BALANCE'
      });
      return response.data;
    } catch (error: any) {
      console.error('Wise Funding Error:', error.response?.data || error.message);
      throw new Error(`Failed to fund transfer: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get transfer status
   */
  async getTransferStatus(transferId: number) {
    try {
      const response = await this.client.get(`/v1/transfers/${transferId}`);
      return response.data;
    } catch (error: any) {
      console.error('Wise Status Error:', error.response?.data || error.message);
      throw new Error(`Failed to get transfer status: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get all transfers
   */
  async getTransfers(limit: number = 10) {
    try {
      const response = await this.client.get(`/v1/profiles/${this.profileId}/transfers`, {
        params: { limit, offset: 0 }
      });
      return response.data;
    } catch (error: any) {
      console.error('Wise Transfers Error:', error.response?.data || error.message);
      throw new Error(`Failed to get transfers: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Simplified method to send money (combines all steps)
   */
  async sendMoney(params: {
    amount: number;
    recipientName: string;
    recipientCountry: string;
    recipientBankAccount: string;
    recipientBankCode?: string;
    targetCurrency: string;
    reference?: string;
  }) {
    try {
      // Step 1: Create quote
      console.log('Creating quote...');
      const quote = await this.createQuote({
        sourceCurrency: 'USD',
        targetCurrency: params.targetCurrency,
        sourceAmount: params.amount
      });

      // Step 2: Create recipient
      console.log('Creating recipient...');
      const recipient = await this.createRecipient({
        currency: params.targetCurrency,
        type: 'sort_code', // This varies by country
        accountHolderName: params.recipientName,
        details: {
          legalType: 'PRIVATE',
          accountNumber: params.recipientBankAccount,
          bankCode: params.recipientBankCode
        }
      });

      // Step 3: Create transfer
      console.log('Creating transfer...');
      const transfer = await this.createTransfer({
        targetAccount: recipient.id,
        quoteUuid: quote.id,
        customerTransactionId: `TXN-${Date.now()}`,
        details: {
          reference: params.reference || 'MyBambu Transfer'
        }
      });

      // Step 4: Fund transfer
      console.log('Funding transfer...');
      await this.fundTransfer(transfer.id);

      return {
        transferId: transfer.id,
        status: transfer.status,
        amount: params.amount,
        targetAmount: quote.targetAmount,
        rate: quote.rate,
        fee: quote.fee,
        estimatedDelivery: quote.estimatedDelivery,
        recipientName: params.recipientName,
        recipientCountry: params.recipientCountry
      };
    } catch (error: any) {
      console.error('Send Money Error:', error.message);
      throw error;
    }
  }
}

// Export singleton instance (will be initialized in server.ts)
let wiseService: WiseService | null = null;

export function initializeWiseService(config: WiseConfig) {
  wiseService = new WiseService(config);
  return wiseService;
}

export function getWiseService(): WiseService {
  if (!wiseService) {
    throw new Error('Wise service not initialized. Call initializeWiseService first.');
  }
  return wiseService;
}
