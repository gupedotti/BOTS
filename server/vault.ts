// Cofre de senhas: credenciais criptografadas (AES-256-GCM) em data/vault.json, chave aleatória em data/vault.key.
// O modelo nunca recebe o valor: só nome, site e usuário. fill_secret digita direto no navegador do bot.
// Pedidos ao usuário (senha ou "assuma o navegador") viram cartões no chat e a ferramenta espera a resposta.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, addMsg, db, emit, type Msg } from './db.ts';

export type Secret = { id: string; name: string; site: string; username?: string; enc: string; botIds: string[]; ts: number };
export type PubSecret = Omit<Secret, 'enc'>;
const FILE = join(DATA, 'vault.json'), KEYF = join(DATA, 'vault.key');
if (!existsSync(KEYF)) writeFileSync(KEYF, randomBytes(32).toString('base64'));
const KEY = Buffer.from(readFileSync(KEYF, 'utf8').trim(), 'base64');

const load = (): Secret[] => { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return []; } };
const store = (l: Secret[]) => { writeFileSync(FILE, JSON.stringify(l, null, 1)); emit({ t: 'vault' }); };
const pub = ({ enc, ...s }: Secret): PubSecret => s;
function seal(v: string) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', KEY, iv);
  const out = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), out].map(b => b.toString('base64')).join('.');
}
function open(e: string) {
  const [iv, tag, data] = e.split('.').map(x => Buffer.from(x, 'base64'));
  const d = createDecipheriv('aes-256-gcm', KEY, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}
// "https://www.app.exemplo.com/login" → "app.exemplo.com"
export const siteOf = (s: string) => { const v = String(s ?? '').trim().toLowerCase(); try { return new URL(/^[a-z]+:\/\//.test(v) ? v : 'https://' + v).hostname.replace(/^www\./, ''); } catch { return v.replace(/^www\./, ''); } };
export const siteMatch = (host: string, site: string) => { const h = host.toLowerCase().replace(/^www\./, ''); return h === site || h.endsWith('.' + site); };

export const vault = {
  list: (botId?: string): PubSecret[] => load().filter(s => !botId || !s.botIds.length || s.botIds.includes(botId)).map(pub),
  find: (botId: string, name: string) => load().find(s => (!s.botIds.length || s.botIds.includes(botId)) && (s.name.toLowerCase() === name.toLowerCase() || s.id === name || s.site === siteOf(name))),
  save(a: { id?: string; name: string; site: string; username?: string; password: string; botIds?: string[] }): PubSecret {
    const name = String(a.name ?? '').trim().slice(0, 60), site = siteOf(a.site);
    if (!name || !site || !a.password) throw new Error('nome, site e senha são obrigatórios');
    const l = load();
    const old = l.find(s => s.id === a.id) ?? l.find(s => s.name.toLowerCase() === name.toLowerCase());
    const s: Secret = { id: old?.id ?? randomUUID().slice(0, 8), name, site, username: a.username?.trim() || undefined, enc: seal(String(a.password)), botIds: (a.botIds ?? []).map(String), ts: Date.now() };
    store([...l.filter(x => x !== old), s]);
    return pub(s);
  },
  del(id: string) { store(load().filter(s => s.id !== id)); },
  reveal: (s: Secret) => open(s.enc),
};

// senha em texto de memória: recusa (o lugar dela é o cofre)
export const hasSecret = (t: string) => /\b(senha|password|passwd|pwd|token|api.?key)\b\s*(é|e|:|=|-)?\s*["'`]?[^\s"'`,.;]{4,}/i.test(t) && !/\b(no cofre|request_secret|fill_secret)\b/i.test(t);

// ---------- pedidos ao usuário que a ferramenta espera (cartão no chat) ----------
type Wait = { msgId: number; done: (r: any) => void };
const waits = new Map<string, Wait>();
function setStatus(msgId: number, patch: Record<string, unknown>) {
  const r: any = db.prepare('select * from messages where id=?').get(msgId); if (!r) return;
  const meta = { ...(r.meta ? JSON.parse(r.meta) : {}), ...patch };
  db.prepare('update messages set meta=? where id=?').run(JSON.stringify(meta), msgId);
  emit({ t: 'msg', msg: { id: r.id, convId: r.conv_id, role: r.role, botId: r.bot_id ?? undefined, text: r.text, taskId: r.task_id ?? undefined, ts: r.ts, meta } satisfies Msg });
}
export function ask<T>(m: { convId: string; botId: string; text: string; meta: Record<string, unknown> }, ms: number): { msg: Msg; result: Promise<T | 'timeout'> } {
  const req = randomUUID().slice(0, 12);
  const msg = addMsg({ convId: m.convId, role: 'system', botId: m.botId, text: m.text, meta: { ...m.meta, req, status: 'open' } });
  const result = new Promise<T | 'timeout'>(done => {
    const t = setTimeout(() => { waits.delete(req); setStatus(msg.id, { status: 'expired' }); done('timeout'); }, ms);
    waits.set(req, { msgId: msg.id, done: r => { clearTimeout(t); done(r); } });
  });
  return { msg, result };
}
export function answer(req: string, status: string, r: unknown) {
  const w = waits.get(req); if (!w) throw new Error('pedido expirou ou já foi respondido');
  waits.delete(req); setStatus(w.msgId, { status }); w.done(r);
}
export function askMeta(req: string): Record<string, any> | undefined {
  const w = waits.get(req); if (!w) return;
  const r: any = db.prepare('select meta, bot_id, conv_id from messages where id=?').get(w.msgId);
  return r && { ...JSON.parse(r.meta ?? '{}'), botId: r.bot_id, convId: r.conv_id };
}
// reinício do servidor: cartões que ficaram abertos não têm mais quem espere a resposta
for (const r of db.prepare(`select id, meta from messages where meta like '%"status":"open"%' and (meta like '%secret-request%' or meta like '%"takeover"%')`).all() as any[])
  db.prepare('update messages set meta=? where id=?').run(JSON.stringify({ ...JSON.parse(r.meta), status: 'expired' }), r.id);
