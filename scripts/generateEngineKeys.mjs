import fs from 'node:fs';
import nacl from 'tweetnacl';

const envPath = '.env';
const keypair = nacl.box.keyPair();
const publicKey = Buffer.from(keypair.publicKey).toString('base64');
const secretKey = Buffer.from(keypair.secretKey).toString('base64');

console.log('ENGINE_PUBLIC_KEY=', publicKey);
console.log('ENGINE_SECRET_KEY=', secretKey);

if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  const hasSecret = env.includes('ENGINE_SECRET_KEY=');
  const hasPublic = env.includes('ENGINE_PUBLIC_KEY=');
  if (!hasSecret || !hasPublic) {
    const lines = [];
    if (!hasPublic) lines.push(`ENGINE_PUBLIC_KEY=${publicKey}`);
    if (!hasSecret) lines.push(`ENGINE_SECRET_KEY=${secretKey}`);
    fs.appendFileSync(envPath, `\n${lines.join('\n')}\n`, 'utf8');
    console.log('Appended engine keys to .env');
  }
}
