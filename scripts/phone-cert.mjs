import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ip = process.argv[2];
if (!ip || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) || ip.split('.').some(part => Number(part) > 255)) {
  console.error('Usage: npm run phone:cert -- <LAN IPv4 address>');
  process.exit(1);
}

const certDir = resolve('.local-certs');
const caKey = resolve(certDir, 'shot-timer-local-ca-key.pem');
const caCert = resolve(certDir, 'shot-timer-local-ca.crt');
const serverKey = resolve(certDir, 'shot-timer-server-key.pem');
const serverCsr = resolve(certDir, 'shot-timer-server.csr');
const serverCert = resolve(certDir, 'shot-timer-server.crt');
const serial = resolve(certDir, 'shot-timer-local-ca.srl');
mkdirSync(certDir, { recursive: true });

function openssl(args) {
  const result = spawnSync('openssl', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(caKey) || !existsSync(caCert)) {
  openssl(['genrsa', '-out', caKey, '3072']);
  chmodSync(caKey, 0o600);
  openssl([
    'req', '-x509', '-new', '-sha256', '-days', '3650', '-key', caKey, '-out', caCert,
    '-subj', '/CN=Shot Timer Local Development CA',
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    '-addext', 'subjectKeyIdentifier=hash',
  ]);
}

openssl(['genrsa', '-out', serverKey, '2048']);
chmodSync(serverKey, 0o600);
openssl([
  'req', '-new', '-sha256', '-key', serverKey, '-out', serverCsr, '-subj', `/CN=${ip}`,
  '-addext', `subjectAltName=IP:${ip},DNS:localhost`,
  '-addext', 'basicConstraints=critical,CA:FALSE',
  '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
  '-addext', 'extendedKeyUsage=serverAuth',
]);
openssl([
  'x509', '-req', '-sha256', '-days', '825', '-in', serverCsr, '-CA', caCert, '-CAkey', caKey,
  '-CAcreateserial', '-out', serverCert, '-copy_extensions', 'copy',
]);
rmSync(serverCsr, { force: true });
rmSync(serial, { force: true });
writeFileSync(resolve(certDir, 'phone-ip.txt'), `${ip}\n`, { mode: 0o600 });

const fingerprint = spawnSync('openssl', ['x509', '-in', caCert, '-noout', '-fingerprint', '-sha256'], { encoding: 'utf8' });
if (fingerprint.status !== 0) process.exit(fingerprint.status ?? 1);
console.log(`\nLocal certificate ready for ${ip}.`);
console.log(readFileSync(caCert, 'utf8').includes('BEGIN CERTIFICATE') ? fingerprint.stdout.trim() : 'Certificate generation failed.');
