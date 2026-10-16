/**
 * Prints a fresh VAPID key pair for the Worker's push notifications
 * (worker/webpush.ts). Run once, then set the two keys as Worker secrets
 * (and the admin token the /admin page asks for):
 *
 *   bun run vapid
 *   wrangler secret put VAPID_PUBLIC_KEY
 *   wrangler secret put VAPID_PRIVATE_KEY
 *   wrangler secret put ADMIN_TOKEN
 *
 * (`wrangler preview secret put ... --name dev` for the dev Preview.) The
 * public key is not secret, but keeping both in one place means a rotation
 * is two commands. Never commit the private key.
 */

import { generateVapidKeys } from "../worker/webpush";

const keys = await generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`ADMIN_TOKEN=${crypto.randomUUID().replace(/-/g, "")}`);
