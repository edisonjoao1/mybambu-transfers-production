import axios, { AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';

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
  customerTransactionId?: string;
  details?: {
    reference?: string;
    sourceOfFunds?: string;
    address?: {
      country: string;
      postCode: string;
      firstLine: string;
      city: string;
    };
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
      const payload: any = {
        targetAccount: request.targetAccount,
        quoteUuid: request.quoteUuid,
        details: request.details || {}
      };

      // Only include customerTransactionId if provided
      if (request.customerTransactionId) {
        payload.customerTransactionId = request.customerTransactionId;
      }

      const response = await this.client.post('/v1/transfers', payload);
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

      // Determine recipient type and details based on currency
      let recipientType: string;
      let recipientDetails: any;

      switch (params.targetCurrency) {
        case 'MXN': // Mexico
          recipientType = 'mexican';
          recipientDetails = {
            legalType: 'PRIVATE',
            clabe: params.recipientBankAccount || '032180000118359719' // Wise sandbox test CLABE
          };
          break;

        case 'BRL': // Brazil
          recipientType = 'brazilian';
          recipientDetails = {
            legalType: 'PRIVATE',
            cpf: params.recipientBankCode || '12345678901',
            accountNumber: params.recipientBankAccount || '12345678',
            accountType: 'checking',
            bankCode: '001'
          };
          break;

        case 'GBP': // UK
          recipientType = 'sort_code';
          recipientDetails = {
            legalType: 'PRIVATE',
            sortCode: params.recipientBankCode || '231470',
            accountNumber: params.recipientBankAccount || '28821822'
          };
          break;

        case 'EUR': // Europe (IBAN)
          recipientType = 'iban';
          recipientDetails = {
            legalType: 'PRIVATE',
            iban: params.recipientBankAccount || 'DE89370400440532013000'
          };
          break;

        default:
          // Generic fallback - will likely fail for most currencies
          recipientType = 'sort_code';
          recipientDetails = {
            legalType: 'PRIVATE',
            accountNumber: params.recipientBankAccount,
            bankCode: params.recipientBankCode
          };
      }

      const recipient = await this.createRecipient({
        currency: params.targetCurrency,
        type: recipientType,
        accountHolderName: params.recipientName,
        details: recipientDetails
      });

      // Step 3: Create transfer
      console.log('Creating transfer...');

      const transfer = await this.createTransfer({
        targetAccount: recipient.id,
        quoteUuid: quote.id,
        customerTransactionId: randomUUID(), // Proper UUID v4
        details: {
          reference: params.reference || 'MyBambu Transfer',
          sourceOfFunds: 'verification.source.of.funds.other',
          // Sender address (required in sandbox)
          address: {
            country: 'US',
            postCode: '10001',
            firstLine: '50 W 23rd St',
            city: 'New York'
          }
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
