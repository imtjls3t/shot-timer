import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const certDir = resolve('.local-certs');
const ip = readFileSync(resolve(certDir, 'phone-ip.txt'), 'utf8').trim();
const ca = readFileSync(resolve(certDir, 'shot-timer-local-ca.crt'));
const port = 5172;

const page = `<!doctype html><meta name="viewport" content="width=device-width"><title>Shot Timer phone setup</title>
<style>body{font:16px system-ui;max-width:640px;margin:40px auto;padding:0 22px;line-height:1.6;color:#243126;background:#f5f5ef}a{display:inline-block;background:#294b30;color:white;padding:12px 16px;border-radius:8px;text-decoration:none;font-weight:700}code{background:#e5eadc;padding:3px 6px;border-radius:4px}</style>
<h1>Shot Timer phone setup</h1><p>Download and install this temporary local development CA certificate:</p>
<p><a href="/shot-timer-local-ca.crt" download>Download certificate</a></p>
<p>Then open Android Settings and search for <strong>Install a certificate</strong>. Choose <strong>CA certificate</strong>, select the downloaded file, and restart Chrome.</p>
<p>Finally open <a href="https://${ip}:5174/">https://${ip}:5174/</a>.</p>
<p>You can remove the certificate after testing from Android's trusted credentials settings.</p>`;

createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/shot-timer-local-ca.crt') {
    response.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="shot-timer-local-ca.crt"' });
    response.end(ca);
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(page);
}).listen(port, '0.0.0.0', () => {
  console.log(`Certificate setup page: http://${ip}:${port}/`);
  console.log(`Shot Timer after certificate install: https://${ip}:5174/`);
});
