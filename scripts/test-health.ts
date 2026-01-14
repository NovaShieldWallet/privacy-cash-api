/**
 * Health check script for Nova Privacy Cash API
 * Tests all endpoints are responding correctly
 */

import 'dotenv/config';

const API_URL = process.env.API_URL || 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({
      name,
      passed: true,
      duration: Date.now() - start,
    });
    console.log(`✅ ${name} (${Date.now() - start}ms)`);
  } catch (error: any) {
    results.push({
      name,
      passed: false,
      duration: Date.now() - start,
      error: error.message,
    });
    console.log(`❌ ${name}: ${error.message}`);
  }
}

async function main() {
  console.log(`\n🔍 Testing Nova Privacy Cash API at ${API_URL}\n`);
  console.log('='.repeat(50));

  // Test health endpoint
  await test('GET /v1/health', async () => {
    const res = await fetch(`${API_URL}/v1/health`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error('Status not ok');
    console.log(`   Network: ${data.network}`);
  });

  // Test tokens endpoint
  await test('GET /v1/tokens', async () => {
    const res = await fetch(`${API_URL}/v1/tokens`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.tokens || !Array.isArray(data.tokens)) {
      throw new Error('Invalid tokens response');
    }
    console.log(`   Tokens: ${data.tokens.map((t: any) => t.name).join(', ')}`);
  });

  // Test deposit/prepare validation
  await test('POST /v1/deposit/prepare (validation)', async () => {
    const res = await fetch(`${API_URL}/v1/deposit/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Should return 400 for missing fields
    if (res.status !== 400) {
      throw new Error(`Expected 400, got ${res.status}`);
    }
    const data = await res.json();
    if (!data.error) throw new Error('Expected error message');
  });

  // Test withdraw/prepare validation
  await test('POST /v1/withdraw/prepare (validation)', async () => {
    const res = await fetch(`${API_URL}/v1/withdraw/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.status !== 400) {
      throw new Error(`Expected 400, got ${res.status}`);
    }
    const data = await res.json();
    if (!data.error) throw new Error('Expected error message');
  });

  // Test balance validation
  await test('POST /v1/balance (validation)', async () => {
    const res = await fetch(`${API_URL}/v1/balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.status !== 400) {
      throw new Error(`Expected 400, got ${res.status}`);
    }
  });

  // Test 404
  await test('GET /v1/nonexistent (404)', async () => {
    const res = await fetch(`${API_URL}/v1/nonexistent`);
    if (res.status !== 404) {
      throw new Error(`Expected 404, got ${res.status}`);
    }
  });

  // Summary
  console.log('\n' + '='.repeat(50));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  console.log('\n✅ All health checks passed!\n');
}

main().catch(console.error);
