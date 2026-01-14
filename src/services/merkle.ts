import type * as hasher from '@lightprotocol/hasher.rs';
import { MERKLE_TREE_DEPTH } from '../utils/constants.js';

/**
 * Simple Merkle tree implementation for ZK proofs
 */
export class MerkleTree {
  public levels: number;
  private lightWasm: hasher.LightWasm;
  private zeroValues: string[];

  constructor(levels: number, lightWasm: hasher.LightWasm) {
    this.levels = levels;
    this.lightWasm = lightWasm;
    this.zeroValues = this.computeZeroValues();
  }

  private computeZeroValues(): string[] {
    const zeros: string[] = ['0'];
    for (let i = 1; i <= this.levels; i++) {
      zeros[i] = this.lightWasm.poseidonHashString([zeros[i - 1], zeros[i - 1]]);
    }
    return zeros;
  }

  getZeroValue(level: number): string {
    return this.zeroValues[level];
  }

  /**
   * Create a zero-filled merkle path for dummy UTXOs
   */
  getZeroPath(): string[] {
    return new Array(this.levels).fill('0');
  }
}

export function createMerkleTree(lightWasm: hasher.LightWasm): MerkleTree {
  return new MerkleTree(MERKLE_TREE_DEPTH, lightWasm);
}
