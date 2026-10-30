// Configurações do usuário em data/settings.json. Chaves de API ficam só aqui (nunca voltam inteiras para a UI);
// variáveis do .env continuam valendo como reserva.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { DATA } from './db.ts';

const FILE = join(DATA, 'settings.json');
const DEF = { userName: '', sendOnEnter: true, animations: true, notify: false, adblock: true, headed: false, graphNightly: true, composioKey: '', elevenlabsKey: '', openaiKey: '', groqKey: '', sttEngine: 'local', sttModel: 'small', sttRefine: true, passwordHash: '', sessionSecret: '' };
const PRIVATE = new Set(['passwordHash', 'sessionSecret']); // nunca editáveis via PUT nem devolvidos à UI
const ONE_OF: Record<string, string[]> = { sttEngine: ['local', 'groq', 'openai', 'elevenlabs'], sttModel: ['base', 'small', 'turbo'] };
type S = typeof DEF;
export const settings: S = { ...DEF, ...(existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}) };

export function update(patch: Record<string, unknown>) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEF) || PRIVATE.has(k) || typeof v !== typeof (DEF as any)[k]) continue; // só chaves conhecidas, com o tipo certo
    if (ONE_OF[k] && !ONE_OF[k].includes(v as string)) continue;
    (settings as any)[k] = typeof v === 'string' ? v.trim().slice(0, 500) : v;
  }
  save();
  return pub();
}
const save = () => writeFileSync(FILE, JSON.stringify(settings, null, 2));

const mask = (k: string) => (k ? { set: true, last4: k.slice(-4) } : { set: false });
export const pub = () => {
  const { composioKey, elevenlabsKey, openaiKey, groqKey, passwordHash, sessionSecret, ...rest } = settings;
  return { ...rest, composio: mask(composioKey || process.env.COMPOSIO_API_KEY || ''), elevenlabs: mask(elevenlabsKey || process.env.ELEVENLABS_API_KEY || ''), openai: mask(openaiKey || process.env.OPENAI_API_KEY || ''), groq: mask(groqKey || process.env.GROQ_API_KEY || '') };
};
export const composioKey = () => settings.composioKey || process.env.COMPOSIO_API_KEY || '';
export const elevenlabsKey = () => settings.elevenlabsKey || process.env.ELEVENLABS_API_KEY || '';
export const openaiKey = () => settings.openaiKey || process.env.OPENAI_API_KEY || '';
export const groqKey = () => settings.groqKey || process.env.GROQ_API_KEY || '';

// ---- senha (scrypt) e sessão por cookie assinado (HMAC; trocar a senha invalida todas as sessões) ----
export const hasPassword = () => !!settings.passwordHash;
export function checkPassword(pw: string) {
  const [salt, hash] = settings.passwordHash.split(':');
  if (!salt || !hash) return false;
  const got = scryptSync(pw, salt, 32), want = Buffer.from(hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}
export function setPassword(pw: string) {
  if (pw.length < 6) throw new Error('a senha precisa de pelo menos 6 caracteres');
  const salt = randomBytes(16).toString('hex');
  settings.passwordHash = `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`;
  settings.sessionSecret = randomBytes(32).toString('hex');
  save();
}
const sign = (exp: number) => createHmac('sha256', settings.sessionSecret || 'x').update(String(exp)).digest('base64url');
export const newSession = (days = 30) => { const exp = Date.now() + days * 864e5; return `${exp}.${sign(exp)}`; };
export function validSession(v?: string) {
  if (!v || !settings.sessionSecret) return false;
  const [exp, sig] = v.split('.'); const want = sign(Number(exp));
  return Number(exp) > Date.now() && !!sig && sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
