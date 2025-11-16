/**
 * Defines required bank account fields for each country/currency
 * Based on Wise API requirements
 */

export interface BankFieldRequirement {
  name: string;
  label: string;
  description: string;
  required: boolean;
  example: string;
}

export interface CountryBankRequirements {
  country: string;
  currency: string;
  accountType: string;
  fields: BankFieldRequirement[];
  instructions: string;
}

export const COUNTRY_BANK_REQUIREMENTS: Record<string, CountryBankRequirements> = {
  // Mexico
  'MXN': {
    country: 'Mexico',
    currency: 'MXN',
    accountType: 'mexican',
    fields: [
      {
        name: 'clabe',
        label: 'CLABE Number',
        description: 'Mexican standardized 18-digit bank account number',
        required: true,
        example: '032180000118359719'
      }
    ],
    instructions: 'For Mexico, we need the recipient\'s CLABE number (18 digits). This is the standardized Mexican bank account number. The recipient can find it on their bank statement or by calling their bank.'
  },

  // Brazil
  'BRL': {
    country: 'Brazil',
    currency: 'BRL',
    accountType: 'brazilian',
    fields: [
      {
        name: 'cpf',
        label: 'CPF',
        description: 'Brazilian tax ID (11 digits)',
        required: true,
        example: '12345678901'
      },
      {
        name: 'accountNumber',
        label: 'Account Number',
        description: 'Bank account number',
        required: true,
        example: '12345678'
      },
      {
        name: 'accountType',
        label: 'Account Type',
        description: 'checking or savings',
        required: true,
        example: 'checking'
      },
      {
        name: 'bankCode',
        label: 'Bank Code',
        description: '3-digit bank code',
        required: true,
        example: '001'
      }
    ],
    instructions: 'For Brazil, we need the recipient\'s CPF (tax ID), bank account number, account type (checking or savings), and the 3-digit bank code.'
  },

  // United Kingdom
  'GBP': {
    country: 'United Kingdom',
    currency: 'GBP',
    accountType: 'sort_code',
    fields: [
      {
        name: 'sortCode',
        label: 'Sort Code',
        description: '6-digit UK bank sort code',
        required: true,
        example: '231470'
      },
      {
        name: 'accountNumber',
        label: 'Account Number',
        description: '8-digit UK account number',
        required: true,
        example: '31926819'
      }
    ],
    instructions: 'For UK transfers, we need the recipient\'s 6-digit sort code and 8-digit account number. These can be found on their bank statement or card.'
  },

  // Europe (IBAN)
  'EUR': {
    country: 'Europe',
    currency: 'EUR',
    accountType: 'iban',
    fields: [
      {
        name: 'iban',
        label: 'IBAN',
        description: 'International Bank Account Number',
        required: true,
        example: 'DE89370400440532013000'
      }
    ],
    instructions: 'For European transfers, we need the recipient\'s IBAN (International Bank Account Number). This can be found on their bank statement.'
  },

  // Add more countries as needed...
};

/**
 * Get bank requirements for a specific currency
 */
export function getBankRequirements(currency: string): CountryBankRequirements | null {
  return COUNTRY_BANK_REQUIREMENTS[currency] || null;
}

/**
 * Validate bank details for a currency
 */
export function validateBankDetails(currency: string, details: Record<string, any>): { valid: boolean; missingFields: string[] } {
  const requirements = getBankRequirements(currency);

  if (!requirements) {
    return { valid: false, missingFields: ['Unknown currency'] };
  }

  const missingFields: string[] = [];

  for (const field of requirements.fields) {
    if (field.required && !details[field.name]) {
      missingFields.push(field.label);
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields
  };
}

/**
 * Format bank details for display
 */
export function formatBankDetails(currency: string, details: Record<string, any>): string {
  const requirements = getBankRequirements(currency);

  if (!requirements) {
    return 'Unknown currency';
  }

  const lines: string[] = [];
  for (const field of requirements.fields) {
    if (details[field.name]) {
      lines.push(`${field.label}: ${details[field.name]}`);
    }
  }

  return lines.join('\n');
}
