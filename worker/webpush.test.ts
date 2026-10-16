import { describe, expect, test } from "bun:test";
import {
  b64url,
  encrypt,
  generateVapidKeys,
  sendPush,
  unb64url,
  vapidToken,
  type PushSubscriptionJSON,
} from "./webpush";

const te = new TextEncoder();
const td = new TextDecoder();

/** A browser-side subscription: its ECDH key pair and auth secret, with the
 * private half kept so the test can decrypt like a push service's client. */
async function subscriber(endpoint = "https://push.example/send/abc") {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const sub: PushSubscriptionJSON = {
    endpoint,
    keys: {
      p256dh: b64url(await crypto.subtle.exportKey("raw", pair.publicKey)),
      auth: b64url(auth),
    },
  };
  return { sub, pair, auth };
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bits: number,
) {
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

/** RFC 8291 decryption, as a user agent would do it. */
async function decrypt(
  body: Uint8Array,
  s: Awaited<ReturnType<typeof subscriber>>,
): Promise<string> {
  const salt = body.subarray(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  expect(rs).toBeGreaterThanOrEqual(4096);
  const idlen = body[20];
  expect(idlen).toBe(65);
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const asKey = await crypto.subtle.importKey(
    "raw",
    asPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: asKey },
      s.pair.privateKey,
      256,
    ),
  );
  const uaPublic = unb64url(s.sub.keys.p256dh);
  const info = new Uint8Array([
    ...te.encode("WebPush: info\0"),
    ...uaPublic,
    ...asPublic,
  ]);
  const ikm = await hkdf(s.auth, shared, info, 256);
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
  const aes = await crypto.subtle.importKey(
    "raw",
    cek as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const padded = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      aes,
      ciphertext as BufferSource,
    ),
  );
  // The last record ends with the 0x02 delimiter and no padding here.
  expect(padded[padded.length - 1]).toBe(2);
  return td.decode(padded.subarray(0, padded.length - 1));
}

describe("webpush", () => {
  test("base64url round-trips", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(unb64url(b64url(bytes))).toEqual(bytes);
    expect(b64url(bytes)).not.toMatch(/[+/=]/);
  });

  test("what it encrypts, the subscriber can decrypt", async () => {
    const s = await subscriber();
    const body = await encrypt(
      s.sub,
      te.encode('{"title":"New pattern","body":"from Ada"}'),
    );
    expect(await decrypt(body, s)).toBe(
      '{"title":"New pattern","body":"from Ada"}',
    );
    // A second message uses a fresh salt and key: different bytes.
    const again = await encrypt(s.sub, te.encode("x"));
    expect(b64url(again)).not.toBe(b64url(body));
  });

  test("the VAPID token is an ES256 JWT for the push service, verifiable with the public key", async () => {
    const keys = await generateVapidKeys();
    const vapid = { ...keys, subject: "mailto:crew@empyreangate.org" };
    const token = await vapidToken(
      vapid,
      "https://push.example",
      1_700_000_000_000,
    );
    const [h, c, sig] = token.split(".");
    expect(JSON.parse(td.decode(unb64url(h)))).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    const claims = JSON.parse(td.decode(unb64url(c)));
    expect(claims.aud).toBe("https://push.example");
    expect(claims.sub).toBe(vapid.subject);
    expect(claims.exp).toBe(1_700_000_000 + 12 * 3600);
    const pub = unb64url(keys.publicKey);
    const key = await crypto.subtle.importKey(
      "raw",
      pub as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      unb64url(sig) as BufferSource,
      te.encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  test("sendPush posts the encrypted body with the push headers", async () => {
    const s = await subscriber("https://push.example/send/xyz");
    const vapid = {
      ...(await generateVapidKeys()),
      subject: "https://empyreangate.org",
    };
    let seen: { url: string; init: RequestInit } | null = null;
    const res = await sendPush(s.sub, "hello", vapid, {
      topic: "submissions",
      fetch: async (url, init) => {
        seen = { url: String(url), init: init! };
        return new Response(null, { status: 201 });
      },
    });
    expect(res.status).toBe(201);
    expect(seen!.url).toBe(s.sub.endpoint);
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.ttl).toBe(String(24 * 3600));
    expect(headers.topic).toBe("submissions");
    expect(headers.authorization).toMatch(
      new RegExp(`^vapid t=[^,]+, k=${vapid.publicKey}$`),
    );
    expect(
      await decrypt(new Uint8Array(seen!.init.body as ArrayBuffer), s),
    ).toBe("hello");
  });
});
