import * as snarkjs from 'snarkjs';
import { readFileSync } from 'fs';
import { logger } from '../middleware/logging.js';
import { getCircuitBasePath } from '../utils/constants.js';

interface ProofResult {
  proof: any;
  publicSignals: string[];
}

/**
 * Generate a ZK proof for a transaction
 * This is the heavy computation that runs on the server
 */
export async function generateProof(input: Record<string, any>): Promise<ProofResult> {
  const basePath = getCircuitBasePath();
  const wasmPath = `${basePath}.wasm`;
  const zkeyPath = `${basePath}.zkey`;

  logger.debug('Generating ZK proof', { wasmPath, zkeyPath });

  const startTime = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  const duration = Date.now() - startTime;

  logger.debug('Proof generated', { duration: `${duration}ms` });

  return { proof, publicSignals };
}

/**
 * Parse proof to bytes array format for on-chain submission
 */
export function parseProofToBytesArray(proof: any): {
  proofA: number[];
  proofB: number[][];
  proofC: number[];
} {
  const proofA = [
    ...bigIntToLeBytes(BigInt(proof.pi_a[0]), 32),
    ...bigIntToLeBytes(BigInt(proof.pi_a[1]), 32),
  ];

  const proofB = [
    [
      ...bigIntToLeBytes(BigInt(proof.pi_b[0][1]), 32),
      ...bigIntToLeBytes(BigInt(proof.pi_b[0][0]), 32),
    ],
    [
      ...bigIntToLeBytes(BigInt(proof.pi_b[1][1]), 32),
      ...bigIntToLeBytes(BigInt(proof.pi_b[1][0]), 32),
    ],
  ];

  const proofC = [
    ...bigIntToLeBytes(BigInt(proof.pi_c[0]), 32),
    ...bigIntToLeBytes(BigInt(proof.pi_c[1]), 32),
  ];

  return { proofA, proofB, proofC };
}

/**
 * Parse public signals to bytes array
 */
export function parseToBytesArray(publicSignals: string[]): number[][] {
  return publicSignals.map((signal) => {
    return Array.from(bigIntToLeBytes(BigInt(signal), 32));
  });
}

function bigIntToLeBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return bytes;
}
