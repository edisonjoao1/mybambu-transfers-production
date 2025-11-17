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
    const payload = {
      currency: request.currency,
      type: request.type,
      profile: this.profileId,
      accountHolderName: request.accountHolderName,
      details: request.details
    };

    try {
      console.error('🔍 Creating recipient with payload:', JSON.stringify(payload, null, 2));
      const response = await this.client.post('/v1/accounts', payload);
      console.error('✅ Recipient created:', response.data.id);
      return response.data;
    } catch (error: any) {
      console.error('❌ Wise Recipient Error:');
      console.error('Status:', error.response?.status);
      console.error('Errors:', JSON.stringify(error.response?.data?.errors, null, 2));
      console.error('Payload sent:', JSON.stringify(payload, null, 2));

      // Include detailed error in thrown message
      const errorDetails = error.response?.data?.errors
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      throw new Error(`Wise recipient creation failed: ${errorDetails}`);
    }
  }

  /**
   * Create a transfer
   */
  async createTransfer(request: TransferRequest) {
    const payload: any = {
      targetAccount: request.targetAccount,
      quoteUuid: request.quoteUuid,
      details: request.details || {}
    };

    // Only include customerTransactionId if provided
    if (request.customerTransactionId) {
      payload.customerTransactionId = request.customerTransactionId;
    }

    try {
      console.log('🔍 Transfer payload:', JSON.stringify(payload, null, 2));

      const response = await this.client.post('/v1/transfers', payload);
      return response.data;
    } catch (error: any) {
      console.error('Wise Transfer Error:', error.response?.data || error.message);
      console.error('Payload that failed:', JSON.stringify(payload, null, 2));
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
    phoneNumber?: string;
    idDocumentNumber?: string;
    address?: string;
    city?: string;
    postCode?: string;
    accountType?: string;
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

        case 'COP': // Colombia
          recipientType = 'colombia';
          recipientDetails = {
            legalType: 'PRIVATE',
            bankCode: 'COLOCOBM', // Only Bancolombia supported in sandbox
            accountNumber: params.recipientBankAccount,
            accountType: params.accountType || 'SAVINGS',
            phoneNumber: params.phoneNumber,
            idDocumentType: 'CC', // Cédula de Ciudadanía (Colombian ID card)
            idDocumentNumber: params.idDocumentNumber,
            address: {
              country: 'CO',
              city: params.city,
              firstLine: params.address,
              postCode: params.postCode
            }
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
          sourceOfFunds: 'verification.source.of.funds.other'
        }
      });

      // Step 4: Fund transfer
      // Note: Personal API tokens cannot fund transfers due to PSD2 regulations.
      // The transfer is created and awaiting payment. In production with OAuth tokens,
      // you would call fundTransfer() here.
      console.log('Transfer created successfully. Funding requires OAuth token or manual action.');

      // Try to fund, but don't fail if it returns 403
      try {
        await this.fundTransfer(transfer.id);
        console.log('✅ Transfer funded successfully');
      } catch (fundingError: any) {
        if (fundingError.message.includes('403') || fundingError.message.includes('forbidden')) {
          console.log('⚠️  Funding requires OAuth token (personal tokens cannot fund due to PSD2)');
        } else {
          // Re-throw other errors
          throw fundingError;
        }
      }

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
