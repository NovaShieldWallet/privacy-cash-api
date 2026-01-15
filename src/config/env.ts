import { PublicKey } from '@solana/web3.js';
import 'dotenv/config';

// Mainnet-only configuration - Privacy Cash only supports mainnet
export type NetworkType = 'mainnet';

// Hardcoded constants - these don't change
const PROGRAM_ID = new PublicKey('9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD');
const ALT_ADDRESS = new PublicKey('HEN49U2ySJ85Vc78qprSW9y6mFDhs1NczRxyppNHjofe');
const RELAYER_URL = 'https://api3.privacycash.org';

// Admin referral wallet - earns % fee on all transactions via Privacy Cash referral program
const ADMIN_REFERRAL_WALLET = 'HKBrbp3h8B9tMCn4ceKCtmF8jWxvpfrb7YNLbCgxLUJL';

// Token configurations - hardcoded
const TOKEN_CONFIGS = {
  sol: {
    name: 'SOL',
    mint: new PublicKey('So11111111111111111111111111111111111111112'),
    decimals: 9,
    unitsPerToken: 1e9,
  },
  usdc: {
    name: 'USDC',
    mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    decimals: 6,
    unitsPerToken: 1e6,
  },
  usdt: {
    name: 'USDT',
    mint: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
    decimals: 6,
    unitsPerToken: 1e6,
  },
  zec: {
    name: 'ZEC',
    mint: new PublicKey('A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS'),
    decimals: 8,
    unitsPerToken: 1e8,
  },
  ore: {
    name: 'ORE',
    mint: new PublicKey('oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp'),
    decimals: 11,
    unitsPerToken: 1e11,
  },
  store: {
    name: 'STORE',
    mint: new PublicKey('sTorERYB6xAZ1SSbwpK3zoK2EEwbBrc7TZAzg1uCGiH'),
    decimals: 11,
    unitsPerToken: 1e11,
  },
} as const;

export interface TokenConfig {
  name: string;
  mint: PublicKey;
  decimals: number;
  unitsPerToken: number;
}

class Config {
  readonly isProduction: boolean;
  readonly network: NetworkType;
  readonly rpcUrl: string;

  // Hardcoded values
  readonly programId = PROGRAM_ID;
  readonly altAddress = ALT_ADDRESS;
  readonly relayerUrl = RELAYER_URL;
  readonly adminReferralWallet = ADMIN_REFERRAL_WALLET;
  readonly port = 3000;
  readonly host = '0.0.0.0';

  private tokens: Map<string, TokenConfig>;

  constructor() {
    // Mainnet-only: Privacy Cash only supports mainnet
    this.isProduction = true;
    this.network = 'mainnet';
    
    // Mainnet RPC is required
    const mainnetRpc = process.env.MAINNET_RPC_URL;
    if (!mainnetRpc) {
      throw new Error('MAINNET_RPC_URL is required. Privacy Cash only supports mainnet.');
    }
    this.rpcUrl = mainnetRpc;

    // Initialize tokens
    this.tokens = new Map();
    for (const [key, tokenConfig] of Object.entries(TOKEN_CONFIGS)) {
      this.tokens.set(key, tokenConfig);
    }
  }

  get shouldLog(): boolean {
    // Enable logging in development, minimal in production
    return process.env.NODE_ENV !== 'production';
  }

  getToken(symbol: string): TokenConfig | undefined {
    return this.tokens.get(symbol.toLowerCase());
  }

  getTokenByMint(mint: string | PublicKey): TokenConfig | undefined {
    const mintStr = typeof mint === 'string' ? mint : mint.toBase58();
    for (const token of this.tokens.values()) {
      if (token.mint.toBase58() === mintStr) {
        return token;
      }
    }
    return undefined;
  }

  getAllTokens(): TokenConfig[] {
    return Array.from(this.tokens.values());
  }
}

export const config = new Config();
