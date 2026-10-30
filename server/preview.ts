// Prévia de link no chat: título, descrição, imagem e site (og:/twitter:/<title>), com cache em memória.
// Só http(s) públicos: nada de localhost, rede local ou link-local (o servidor não vira ponte para a rede de casa).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type Preview = { url: string; title?: string; description?: string; image?: string; site?: string };
const cache = new Map<string, { at: number; p: Preview }>();
const TTL = 6 * 3600_000;

export function privateIp(ip: string) {
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (isIP(ip) === 6) return ip === '::1' || ip === '::' || /^(fc|fd|fe8|fe9|fea|feb)/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function safeUrl(raw: string) {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error('só http(s)');
  const h = u.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.local$|\.internal$/i.test(h)) throw new Error('endereço local');
  const ips = isIP(h) ? [h] : (await lookup(h, { all: true })).map(a => a.address);
  if (!ips.length || ips.some(privateIp)) throw new Error('endereço local');
  return u;
}

const ent = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
export function parseMeta(html: string, base: string): Omit<Preview, 'url'> {
  const meta = (k: string) => {
    for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
      const tag = m[0];
      const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
      if (key === k) { const c = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]; if (c) return ent(c); }
    }
  };
  const title = meta('og:title') ?? meta('twitter:title') ?? (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ? ent(/<title[^>]*>([^<]*)<\/title>/i.exec(html)![1]) : undefined);
  let image = meta('og:image') ?? meta('og:image:url') ?? meta('twitter:image');
  try { if (image) image = new URL(image, base).href; } catch { image = undefined; }
  if (image && !/^https:/.test(image)) image = undefined; // imagem só https (sem conteúdo misto)
  const cut = (s?: string, n = 200) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);
  return { title: cut(title, 160), description: cut(meta('og:description') ?? meta('twitter:description') ?? meta('description')), image, site: cut(meta('og:site_name'), 60) };
}

export async function preview(raw: string): Promise<Preview> {
  const hit = cache.get(raw);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  let u = await safeUrl(raw), res: Response | undefined;
  for (let i = 0; i < 4; i++) { // segue redirecionamento conferindo cada destino
    res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36', accept: 'text/html,*/*;q=0.5', 'accept-language': 'pt-BR,pt;q=0.9' } });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { u = await safeUrl(new URL(loc, u).href); continue; }
    break;
  }
  let p: Preview = { url: raw };
  if (res?.ok && /html/i.test(res.headers.get('content-type') ?? '')) {
    // só o começo da página (as metas ficam no <head>)
    const reader = res.body!.getReader(); let html = '', n = 0;
    while (n < 400_000) { const { done, value } = await reader.read(); if (done) break; n += value.length; html += new TextDecoder().decode(value, { stream: true }); if (/<\/head>/i.test(html)) break; }
    reader.cancel().catch(() => {});
    p = { url: raw, ...parseMeta(html, u.href) };
  }
  cache.set(raw, { at: Date.now(), p });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return p;
}
