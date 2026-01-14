import BN from 'bn.js';
import { Keypair } from './keypair.js';
import type * as hasher from '@lightprotocol/hasher.rs';
import { logger } from '../../middleware/logging.js';

const FIELD_SIZE = new BN(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

interface UtxoParams {
  lightWasm: hasher.LightWasm;
  amount?: string | number | BN;
  keypair?: Keypair;
  blinding?: string | BN;
  index?: number;
  mintAddress?: string;
  version?: 'v1' | 'v2';
}

export class Utxo {
  public amount: BN;
  public keypair: Keypair;
  public blinding: BN;
  public index: number;
  public mintAddress: string;
  public version: 'v1' | 'v2';
  private lightWasm: hasher.LightWasm;

  private commitment?: string;
  private nullifier?: string;

  constructor(params: UtxoParams) {
    this.lightWasm = params.lightWasm;
    this.amount = params.amount !== undefined ? new BN(params.amount.toString()) : new BN(0);
    this.keypair = params.keypair!;
    this.index = params.index ?? 0;
    // Use short format for SOL (matches SDK): '11111111111111111111111111111112'
    this.mintAddress = params.mintAddress ?? '11111111111111111111111111111112';
    this.version = params.version ?? 'v2';

    if (params.blinding) {
      this.blinding = new BN(params.blinding.toString());
    } else {
      // Generate random blinding factor
      const randomBytes = new Uint8Array(31);
      crypto.getRandomValues(randomBytes);
      this.blinding = new BN(Buffer.from(randomBytes).toString('hex'), 16).mod(FIELD_SIZE);
    }
  }

  async getCommitment(): Promise<string> {
    if (this.commitment) return this.commitment;

    // Include mintAddress in commitment (matches SDK)
    const mintAddressField = this.getMintAddressField();

    this.commitment = this.lightWasm.poseidonHashString([
      this.amount.toString(),
      this.keypair.pubkey.toString(),
      this.blinding.toString(),
      mintAddressField,
    ]);

    return this.commitment;
  }

  private getMintAddressField(): string {
    // For SOL, use the string directly
    if (this.mintAddress === '11111111111111111111111111111112') {
      return this.mintAddress;
    }
    // For SPL tokens, would need to process it, but for now just return as-is
    // This matches SDK behavior where getMintAddressField is called on PublicKey
    return this.mintAddress;
  }

  async getNullifier(): Promise<string> {
    if (this.nullifier) return this.nullifier;

    const commitment = await this.getCommitment();
    const signature = this.keypair.sign(commitment, String(this.index));

    this.nullifier = this.lightWasm.poseidonHashString([
      commitment,
      String(this.index),
      signature,
    ]);

    return this.nullifier;
  }

  async log(): Promise<void> {
    logger.debug('UTXO', {
      amount: this.amount.toString(),
      index: this.index,
      mintAddress: this.mintAddress,
      commitment: await this.getCommitment(),
    });
  }
}
