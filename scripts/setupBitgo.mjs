import 'dotenv/config';
import { BitGoAPI } from '@bitgo/sdk-api';
import { Teth, Hteth } from '@bitgo/sdk-coin-eth';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`[Config] Missing ${name}`);
  return value;
}

async function main() {
  const accessToken  = requireEnv('BITGO_ACCESS_TOKEN');
  const enterpriseId = requireEnv('BITGO_ENTERPRISE_ID');
  const walletIdFromEnv = process.env.BITGO_WALLET_ID;
  const passphrase   = walletIdFromEnv
    ? process.env.BITGO_WALLET_PASSPHRASE
    : requireEnv('BITGO_WALLET_PASSPHRASE');
  const engineUrl    = requireEnv('ENGINE_URL');

  const bitgo = new BitGoAPI({ env: 'test' });
  bitgo.register('teth', Teth.createInstance);
  bitgo.register('hteth', Hteth.createInstance);
  await bitgo.authenticateWithAccessToken({ accessToken });

  const coinName = process.env.BITGO_WALLET_COIN || 'hteth';
  const coin     = bitgo.coin(coinName);

  let wallet;
  if (walletIdFromEnv) {
    console.log(`Using existing wallet: ${walletIdFromEnv}`);
    wallet = await coin.wallets().get({ id: walletIdFromEnv });
  } else {
    // Step 1: MPC key creation
    console.log('Creating MPC keychains...');
    const keychains = await coin.keychains().createMpc({
      multisigType: 'tss',
      passphrase,
      enterprise: enterpriseId,
    });

    // Step 2: Create wallet
    console.log('Creating wallet...');
    const walletResponse = await coin.wallets().add({
      label: 'plop-pool-wallet',
      enterprise: enterpriseId,
      keys: [
        keychains.userKeychain.id,
        keychains.backupKeychain.id,
        keychains.bitgoKeychain.id,
      ],
      m: 2,
      n: 3,
      multisigType: 'tss',
    });
    wallet = walletResponse.wallet;
    console.log('Wallet created:', wallet.id());
  }

  const walletId = wallet.id();

  // ── Policies (REST) + Webhook (SDK) ──────────────────────────────────────
  const baseUrl = 'https://app.bitgo-test.com';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };

  // Step 3: Create whitelist policy
  console.log('Creating whitelist policy...');
  const whitelistRes = await fetch(
    `${baseUrl}/api/v2/${coinName}/wallet/${walletId}/policy/rule`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: 'plop-destination-whitelist',
        type: 'advancedWhitelist',
        condition: {
          add: { type: 'address', item: '0x0000000000000000000000000000000000000001' },
        },
        action: { type: 'deny' },
      }),
    }
  );
  const whitelist = await whitelistRes.json();
  if (!whitelistRes.ok) {
    console.error('Whitelist policy error:', whitelist);
    throw new Error('Failed to create whitelist policy');
  }
  console.log('Whitelist policy created:', whitelist.id || 'plop-destination-whitelist');

  // Step 4: Create velocity limit policy
  console.log('Creating velocity limit policy...');
  try {
    const velocityRes = await fetch(
      `${baseUrl}/api/v2/${coinName}/wallet/${walletId}/policy/rule`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: 'plop-velocity-limit',
          type: 'velocityLimit',
          condition: {
            amount: '1000000000000000000',
            timeWindow: 3600,
            grouping: 'walletId',
          },
          action: { type: 'deny' },
        }),
      }
    );
    const velocity = await velocityRes.json();
    if (!velocityRes.ok) {
      console.warn('[BitGo] Velocity policy not supported for this wallet/coin:', velocity);
    } else {
      console.log('Velocity policy created:', velocity.id || 'plop-velocity-limit');
    }
  } catch (err) {
    console.warn('[BitGo] Velocity policy not supported for this wallet/coin:', err?.message || err);
  }

  // Step 5: Add webhook (SDK)
  console.log('Adding webhook...');
  const webhook = await wallet.addWebhook({
    type: 'transfer',
    url: `${engineUrl.replace(/\/$/, '')}/webhooks/bitgo`,
    label: 'plop-transfer-events',
    numConfirmations: 1,
  });
  console.log('Webhook created:', webhook.id);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n✅ Setup complete. Add these to your .env:\n');
  console.log(`BITGO_WALLET_ID=${walletId}`);
  console.log(`WHITELIST_POLICY_ID=plop-destination-whitelist`);
  console.log(`VELOCITY_POLICY_ID=plop-velocity-limit`);
  console.log(`BITGO_WEBHOOK_ID=${webhook.id}`);
  console.log(`# BITGO_WEBHOOK_SECRET — copy from BitGo dashboard if shown`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
