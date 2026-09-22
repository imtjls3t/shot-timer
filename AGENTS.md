# Local phone testing

- This workspace runs in a container. `hostname -I`, `ip route`, and the Vite `Network:` line currently show `192.168.139.172`, which is the container's private address, **not** the address the phone can reach.
- On 2026-09-22, the phone-reachable LAN address is `192.168.1.72`. It may change. Confirm the address from the host/phone before giving the user a preview link; do not assume the container IP is usable from the phone.
- Generate the HTTPS certificate for the **phone-reachable** address: `npm run phone:cert -- <LAN-IP>`. The certificate setup page (`npm run phone:cert-server`, port 5172) and production preview (`npm run preview:phone`, port 5174) must refer to that same address. Check the certificate SAN and fetch the page through the phone-reachable URL before handing it over.
- If that URL serves the current build but the phone still shows an older UI, check the PWA service worker/cache. Use the in-app **Update now** prompt or a fresh port/origin for testing. A fresh port has separate localStorage, so existing profiles and stage history will not appear there. Do not clear browser site storage without warning because it contains those records.

# GitHub Pages deployments

- Every deployment to GitHub Pages must bump the displayed app version by one `v0.x` step. Run `npm run version:next` once for that deployment and include the updated `package.json` and `package-lock.json` in the deployed commit.
- Treat the minor component as a counter: `v0.9` becomes `v0.10`, then `v0.11`. Do not advance to `v1.0` unless the user explicitly asks for it.
- Verify the published site serves the new version after the GitHub Pages workflow completes. Do not claim a deployment succeeded until that check passes.
