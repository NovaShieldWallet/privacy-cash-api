import * as crypto from 'crypto';
import { WasmFactory } from '@lightprotocol/hasher.rs';
import { keccak256 } from '@ethersproject/keccak256';
import { Keypair as UtxoKeypair } from './models/keypair.js';
import { Utxo } from './models/utxo.js';

/**
 * Encryption service that derives keys from a signature
 * The signature is provided by the iOS client (signed locally with their private key)
 * This is safe - the signature doesn't expose the private key
 */
export class EncryptionService {
  public static readonly ENCRYPTION_VERSION_V2 = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02]);

  private encryptionKeyV1: Uint8Array | null = null;
  private encryptionKeyV2: Uint8Array | null = null;
  private utxoPrivateKeyV1: string | null = null;
  private utxoPrivateKeyV2: string | null = null;

  /**
   * Initialize encryption from a signature provided by the client
   * The client signs the message "Privacy Money account sign in" locally
   */
  public deriveEncryptionKeyFromSignature(signature: Uint8Array): void {
    // V1: Extract first 31 bytes (legacy)
    const encryptionKeyV1 = signature.slice(0, 31);
    this.encryptionKeyV1 = encryptionKeyV1;

    const hashedSeedV1 = crypto.createHash('sha256').update(encryptionKeyV1).digest();
    this.utxoPrivateKeyV1 = '0x' + hashedSeedV1.toString('hex');

    // V2: Use Keccak256 for full 32-byte key
    const encryptionKeyV2 = Buffer.from(keccak256(signature).slice(2), 'hex');
    this.encryptionKeyV2 = encryptionKeyV2;

    const hashedSeedV2 = Buffer.from(keccak256(encryptionKeyV2).slice(2), 'hex');
    this.utxoPrivateKeyV2 = '0x' + hashedSeedV2.toString('hex');
  }

  public encrypt(data: Buffer | string): Buffer {
    if (!this.encryptionKeyV2) {
      throw new Error('Encryption key not set');
    }

    const dataBuffer = typeof data === 'string' ? Buffer.from(data) : data;
    const iv = crypto.randomBytes(12);
    const key = Buffer.from(this.encryptionKeyV2);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encryptedData = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([
      EncryptionService.ENCRYPTION_VERSION_V2,
      iv,
      authTag,
      encryptedData,
    ]);
  }

  public decrypt(encryptedData: Buffer): Buffer {
    if (encryptedData.length >= 8 && encryptedData.subarray(0, 8).equals(EncryptionService.ENCRYPTION_VERSION_V2)) {
      return this.decryptV2(encryptedData);
    }
    return this.decryptV1(encryptedData);
  }

  private decryptV1(encryptedData: Buffer): Buffer {
    if (!this.encryptionKeyV1) {
      throw new Error('V1 encryption key not set');
    }

    const iv = encryptedData.slice(0, 16);
    const authTag = encryptedData.slice(16, 32);
    const data = encryptedData.slice(32);

    const hmacKey = Buffer.from(this.encryptionKeyV1).slice(16, 31);
    const hmac = crypto.createHmac('sha256', hmacKey);
    hmac.update(iv);
    hmac.update(data);
    const calculatedTag = hmac.digest().slice(0, 16);

    if (!this.timingSafeEqual(authTag, calculatedTag)) {
      throw new Error('Decryption failed - invalid key or corrupted data');
    }

    const key = Buffer.from(this.encryptionKeyV1).slice(0, 16);
    const decipher = crypto.createDecipheriv('aes-128-ctr', key, iv);

    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  private decryptV2(encryptedData: Buffer): Buffer {
    if (!this.encryptionKeyV2) {
      throw new Error('V2 encryption key not set');
    }

    const iv = encryptedData.slice(8, 20);
    const authTag = encryptedData.slice(20, 36);
    const data = encryptedData.slice(36);

    const key = Buffer.from(this.encryptionKeyV2);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  private timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff === 0;
  }

  public encryptUtxo(utxo: Utxo): Buffer {
    const utxoString = `${utxo.amount.toString()}|${utxo.blinding.toString()}|${utxo.index}|${utxo.mintAddress}`;
    return this.encrypt(utxoString);
  }

  public async decryptUtxo(encryptedData: Buffer | string, lightWasm?: any): Promise<Utxo> {
    const encryptedBuffer = typeof encryptedData === 'string'
      ? Buffer.from(encryptedData, 'hex')
      : encryptedData;

    const utxoVersion = this.getEncryptionKeyVersion(encryptedBuffer);
    const decrypted = this.decrypt(encryptedBuffer);

    const decryptedStr = decrypted.toString();
    const parts = decryptedStr.split('|');

    if (parts.length !== 4) {
      throw new Error('Invalid UTXO format');
    }

    const [amount, blinding, index, mintAddress] = parts;
    const wasmInstance = lightWasm || await WasmFactory.getInstance();
    const privateKey = this.getUtxoPrivateKeyWithVersion(utxoVersion);

    return new Utxo({
      lightWasm: wasmInstance,
      amount,
      blinding,
      keypair: new UtxoKeypair(privateKey, wasmInstance),
      index: Number(index),
      mintAddress,
      version: utxoVersion,
    });
  }

  public getEncryptionKeyVersion(encryptedData: Buffer | string): 'v1' | 'v2' {
    const buffer = typeof encryptedData === 'string' ? Buffer.from(encryptedData, 'hex') : encryptedData;
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(EncryptionService.ENCRYPTION_VERSION_V2)) {
      return 'v2';
    }
    return 'v1';
  }

  public getUtxoPrivateKeyWithVersion(version: 'v1' | 'v2'): string {
    if (version === 'v1') {
      if (!this.utxoPrivateKeyV1) throw new Error('V1 key not set');
      return this.utxoPrivateKeyV1;
    }
    if (!this.utxoPrivateKeyV2) throw new Error('V2 key not set');
    return this.utxoPrivateKeyV2;
  }

  public deriveUtxoPrivateKey(): string {
    if (!this.utxoPrivateKeyV1) throw new Error('Key not set');
    return this.utxoPrivateKeyV1;
  }

  public getUtxoPrivateKeyV2(): string {
    if (!this.utxoPrivateKeyV2) throw new Error('V2 key not set');
    return this.utxoPrivateKeyV2;
  }

  public hasKeys(): boolean {
    return this.encryptionKeyV1 !== null && this.encryptionKeyV2 !== null;
  }
}
