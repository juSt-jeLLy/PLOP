import 'dotenv/config';
import { BitGoAPI } from '@bitgo/sdk-api';
import { Teth, Hteth } from '@bitgo/sdk-coin-eth';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`[Config] Missing ${name}`);
  return value;
}

function optionalEnv(name) {
  return process.env[name];
}

async function checkFileverse(serverUrl) {
  const url = serverUrl.replace(/\/+$/, '') + '/ping';
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.reply !== 'pong') {
    throw new Error(`[Fileverse] ping failed: ${res.status} ${JSON.stringify(body)}`);
  }
  console.log('[Check] Fileverse ping OK');
}

async function checkEns(rpcUrl, resolverAddress) {
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const resolver = await client.getEnsResolver({ name: 'plop.eth' });
  if (!resolver) {
    throw new Error('[ENS] No resolver set for plop.eth');
  }
  if (resolver.toLowerCase() !== resolverAddress.toLowerCase()) {
    throw new Error(`[ENS] Resolver mismatch: ${resolver} != ${resolverAddress}`);
  }
  console.log('[Check] ENS resolver OK');
}

async function checkBitgo(accessToken, coinName, walletId) {
  const bitgo = new BitGoAPI({ env: 'test' });
  bitgo.register('teth', Teth.createInstance);
  bitgo.register('hteth', Hteth.createInstance);
  await bitgo.authenticateWithAccessToken({ accessToken });

  const coin = bitgo.coin(coinName);
  const wallet = await coin.wallets().get({ id: walletId });
  await wallet.refresh();

  const balance = wallet.balance();
  if (balance === undefined) {
    console.warn('[Check] BitGo wallet balance unavailable (undefined)');
  } else {
    console.log('[Check] BitGo wallet balance:', balance);
  }

  const baseUrl = 'https://app.bitgo-test.com';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };

  const walletDetailsRes = await fetch(`${baseUrl}/api/v2/${coinName}/wallet/${walletId}`, { headers });
  if (walletDetailsRes.ok) {
    const details = await walletDetailsRes.json().catch(() => ({}));
    const rules = Array.isArray(details?.admin?.policy?.rules) ? details.admin.policy.rules : [];
    const hasWhitelist = rules.some((r) => r?.id === 'plop-destination-whitelist');
    const hasVelocity = rules.some((r) => r?.id === 'plop-velocity-limit');
    console.log('[Check] BitGo whitelist policy:', hasWhitelist ? 'OK' : 'MISSING');
    console.log('[Check] BitGo velocity policy:', hasVelocity ? 'OK' : 'MISSING');
  } else {
    console.warn('[Check] BitGo policy check skipped (API returned', walletDetailsRes.status + ')');
  }

  const webhooksRes = await fetch(`${baseUrl}/api/v2/${coinName}/wallet/${walletId}/webhooks`, { headers });
  if (!webhooksRes.ok) {
    console.warn('[Check] BitGo webhooks check skipped (API returned', webhooksRes.status + ')');
    return;
  }
  const webhooks = await webhooksRes.json().catch(() => ([]));
  const count = Array.isArray(webhooks) ? webhooks.length : (webhooks?.webhooks?.length ?? 'unknown');
  console.log('[Check] BitGo webhooks count:', count);
}

async function checkEngine(engineUrl) {
  const url = engineUrl.replace(/\/+$/, '') + '/health';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[Engine] health failed: ${res.status}`);
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error('[Engine] health returned not ok');
  console.log('[Check] Engine health OK');
}

async function main() {
  const fileverseUrl = requireEnv('FILEVERSE_SERVER_URL');
  const rpcUrl = requireEnv('ETH_SEPOLIA_RPC');
  const resolverAddress = requireEnv('DARK_POOL_RESOLVER_ADDRESS');
  const accessToken = requireEnv('BITGO_ACCESS_TOKEN');
  const walletId = requireEnv('BITGO_WALLET_ID');
  const coinName = optionalEnv('BITGO_WALLET_COIN') || 'hteth';
  const engineUrl = optionalEnv('ENGINE_URL');

  await checkFileverse(fileverseUrl);
  await checkEns(rpcUrl, resolverAddress);
  await checkBitgo(accessToken, coinName, walletId);

  if (engineUrl) {
    await checkEngine(engineUrl);
  } else {
    console.log('[Check] Engine URL not set; skipped engine health');
  }

  console.log('\n✅ Verify complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
