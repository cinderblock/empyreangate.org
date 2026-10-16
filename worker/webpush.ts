/**
 * Web Push from a Worker, with nothing but WebCrypto: the message encryption
 * of RFC 8291 (`aes128gcm`, RFC 8188) and the VAPID authorization of
 * RFC 8292. Enough to tell an installed PWA about a submission; not a
 * general push library.
 */

/** What `PushSubscription.toJSON()` gives the page. */
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The server's VAPID identity. Keys are base64url: the public one is the
 * raw 65-byte P-256 point (what `applicationServerKey` wants), the private
 * one the 32-byte scalar. `bun run vapid` makes a pair. */
export interface Vapid {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or an https origin the push service may contact. */
  subject: string;
}

const te = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** HKDF-SHA256 (extract + expand) to `bits`. */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bits: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    ikm as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: salt as BufferSource,
        info: info as BufferSource,
      },
      key,
      bits,
    ),
  );
}

/** Encrypt `plaintext` for `sub` as one `aes128gcm` record (RFC 8291 §3,
 * RFC 8188): salt ‖ rs ‖ idlen ‖ our public key ‖ ciphertext. */
export async function encrypt(
  sub: PushSubscriptionJSON,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const uaPublic = unb64url(sub.keys.p256dh);
  const authSecret = unb64url(sub.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) {
    throw new Error("subscription keys have the wrong size");
  }
  const local = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const asPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", local.publicKey),
  );
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaKey },
      local.privateKey,
      256,
    ),
  );
  // RFC 8291 §3.3–3.4: IKM from the ECDH secret and the auth secret.
  const ikm = await hkdf(
    authSecret,
    shared,
    concat(te.encode("WebPush: info\0"), uaPublic, asPublic),
    256,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(
    salt,
    ikm,
    te.encode("Content-Encoding: aes128gcm\0"),
    128,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    te.encode("Content-Encoding: nonce\0"),
    96,
  );
  // One record: the padding delimiter 0x02 marks the last one.
  const padded = concat(plaintext, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey(
    "raw",
    cek as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      aes,
      padded as BufferSource,
    ),
  );
  const rs = Math.max(4096, ciphertext.length + 1);
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

/** A VAPID JWT for `audience` (the push service's origin), ES256-signed. */
export async function vapidToken(
  vapid: Vapid,
  audience: string,
  now = Date.now(),
): Promise<string> {
  const pub = unb64url(vapid.publicKey);
  if (pub.length !== 65 || pub[0] !== 4)
    throw new Error("VAPID public key is not a raw P-256 point");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: b64url(pub.subarray(1, 33)),
    y: b64url(pub.subarray(33, 65)),
    d: vapid.privateKey,
  };
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64url(
    te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })),
  );
  const claims = b64url(
    te.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: vapid.subject,
      }),
    ),
  );
  const signing = `${header}.${claims}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    te.encode(signing),
  );
  return `${signing}.${b64url(sig)}`;
}

export interface PushOptions {
  /** Seconds the push service keeps an undelivered message. */
  ttl?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  /** Replaces an earlier message with the same topic. */
  topic?: string;
  /** For tests: where the request goes. */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

/** Send `payload` to one subscription. The push service's response comes
 * back as is: 201 delivered; 404 or 410 mean the subscription is gone. */
export async function sendPush(
  sub: PushSubscriptionJSON,
  payload: string,
  vapid: Vapid,
  options: PushOptions = {},
): Promise<Response> {
  const body = await encrypt(sub, te.encode(payload));
  const token = await vapidToken(vapid, new URL(sub.endpoint).origin);
  const headers: Record<string, string> = {
    "content-type": "application/octet-stream",
    "content-encoding": "aes128gcm",
    ttl: String(options.ttl ?? 24 * 3600),
    urgency: options.urgency ?? "normal",
    authorization: `vapid t=${token}, k=${vapid.publicKey}`,
  };
  if (options.topic) headers.topic = options.topic;
  return (options.fetch ?? fetch)(sub.endpoint, {
    method: "POST",
    headers,
    body: body as BufferSource,
  });
}

/** A fresh VAPID key pair (base64url, as `Vapid` wants them). */
export async function generateVapidKeys(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pub = await crypto.subtle.exportKey("raw", pair.publicKey);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64url(pub), privateKey: jwk.d! };
}
