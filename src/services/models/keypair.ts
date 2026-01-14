import BN from 'bn.js';
import type * as hasher from '@lightprotocol/hasher.rs';

const FIELD_SIZE = new BN(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

export class Keypair {
  public privkey: BN;
  public pubkey: BN;
  private lightWasm: hasher.LightWasm;

  constructor(privkeyHex: string, lightWasm: hasher.LightWasm) {
    const rawDecimal = BigInt(privkeyHex);
    this.privkey = new BN((rawDecimal % BigInt(FIELD_SIZE.toString())).toString());
    this.lightWasm = lightWasm;
    this.pubkey = new BN(this.lightWasm.poseidonHashString([this.privkey.toString()]));
  }

  sign(commitment: string, merklePath: string): string {
    return this.lightWasm.poseidonHashString([this.privkey.toString(), commitment, merklePath]);
  }
}
