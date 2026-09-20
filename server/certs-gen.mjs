// One-time LAN cert generator: self-signed PEM for this machine's IPs.
// Run: node certs-gen.mjs   (outputs C:\metaloid\certs\key.pem + cert.pem)
// Phone browsers will show a warning on first open — Advanced → Proceed.
// After bypass, the origin counts as secure → mic + transcription unlock.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from 'selfsigned';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'certs');
fs.mkdirSync(dir, { recursive: true });

const ips = new Set(['127.0.0.1']);
for (const nets of Object.values(os.networkInterfaces())) {
  for (const n of nets || []) {
    if (n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')) {
      ips.add(n.address);
    }
  }
}
const pems = await generate([{ name: 'commonName', value: 'metaloid-local' }], {
  keySize: 2048,
  days: 825,
  algorithm: 'sha256',
  extensions: [
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
    },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        ...[...ips].map((ip) => ({ type: 7, ip })),
      ],
    },
  ],
});
fs.writeFileSync(path.join(dir, 'key.pem'), pems.private);
fs.writeFileSync(path.join(dir, 'cert.pem'), pems.cert);
console.log('wrote certs for:', [...ips].join(', '));
