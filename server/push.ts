// Web Push (notificações no celular com o app fechado), sem dependências: VAPID (RFC 8292) + aes128gcm (RFC 8291).
// Chaves e inscrições dos aparelhos ficam em data/push.json.
import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from './db.ts';

type Sub = { endpoint: string; keys: { p256dh: string; auth: string }; ua?: string; ts: number };
type Store = { publicKey: string; privateJwk: any; subs: Sub[] };

const FILE = join(DATA, 'push.json');
const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

function load(): Store {
  if (existsSync(FILE)) { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { /* recria */ } }
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const j = publicKey.export({ format: 'jwk' }) as any;
  const raw = Buffer.concat([Buffer.from([4]), fromB64u(j.x), fromB64u(j.y)]);
  const s: Store = { publicKey: b64u(raw), privateJwk: privateKey.export({ format: 'jwk' }), subs: [] };
  writeFileSync(FILE, JSON.stringify(s, null, 2));
  return s;
}
const st = load();
const save = () => writeFileSync(FILE, JSON.stringify(st, null, 2));
const priv = createPrivateKey({ key: st.privateJwk, format: 'jwk' });

export const publicKey = () => st.publicKey;
export const count = () => st.subs.length;

export function subscribe(s: any, ua = '') {
  if (typeof s?.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || typeof s?.keys?.p256dh !== 'string' || typeof s?.keys?.auth !== 'string') throw new Error('inscrição inválida');
  st.subs = st.subs.filter((x) => x.endpoint !== s.endpoint);
  st.subs.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, ua: ua.slice(0, 200), ts: Date.now() });
  save();
}
export function unsubscribe(endpoint: string) { st.subs = st.subs.filter((x) => x.endpoint !== endpoint); save(); }

// JWT ES256 para o serviço de push (Google, Mozilla, Apple) saber quem envia
function vapid(endpoint: string) {
  const aud = new URL(endpoint).origin;
  const enc = (o: object) => b64u(Buffer.from(JSON.stringify(o)));
  const data = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:gubots@example.com' })}`;
  const sig = sign('sha256', Buffer.from(data), { key: priv, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${st.publicKey}`;
}

// criptografa a mensagem só para aquele aparelho (RFC 8291)
function encrypt(sub: Sub, payload: Buffer) {
  const ua = fromB64u(sub.keys.p256dh), auth = fromB64u(sub.keys.auth);
  const ecdh = createECDH('prime256v1');
  const asPub = ecdh.generateKeys();
  const secret = ecdh.computeSecret(ua);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([payload, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}

async function deliver(sub: Sub, data: object) {
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: vapid(sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
    body: encrypt(sub, Buffer.from(JSON.stringify(data))),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 404 || r.status === 410) unsubscribe(sub.endpoint); // aparelho saiu / desinstalou
  else if (!r.ok) throw new Error(`push ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export type Note = { title: string; body: string; convId?: string; tag?: string; icon?: string };
// envia para todos os aparelhos inscritos (ou só um endpoint, no teste); erros só vão para o log
export async function notify(n: Note, only?: string) {
  const list = st.subs.filter((s) => !only || s.endpoint === only);
  if (only && !list.length) throw new Error('este aparelho não está inscrito');
  const res = await Promise.allSettled(list.map((s) => deliver(s, { ...n, ts: Date.now() })));
  for (const r of res) if (r.status === 'rejected') console.error('[push]', r.reason?.message ?? r.reason);
  if (only && res[0]?.status === 'rejected') throw res[0].reason;
}

// texto da resposta → linha de notificação (sem markdown)
export const plain = (t: string) => t
  .replace(/```[\s\S]*?```/g, ' [código] ').replace(/`([^`]+)`/g, '$1').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^\s*[#>|-]+\s*/gm, '').replace(/[*_~|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);

export const _test = { encrypt, vapid }; // só para os testes
