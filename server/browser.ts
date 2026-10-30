// Navegador por bot: Chrome instalado via Playwright (spawn direto do chrome.exe, nunca .cmd), perfil persistente
// (logins salvos), screencast CDP ao vivo para a UI. Nunca espera 'load'/'networkidle'.
import { chromium, type BrowserContext, type Page, type CDPSession } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { extname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { DATA, emit } from './db.ts';
import { settings } from './settings.ts';

const PROFILES = join(DATA, 'profiles');
const NAV_TIMEOUT = 20_000;
const ACT_TIMEOUT = 8_000;

// Bloqueio de anúncios/rastreadores: casa só pelo host (nunca path/query do site). Desliga em Configurações ou GUBOTS_ADBLOCK=0.
// ponytail: lista fixa curta; se faltar algo, acrescente o host aqui. connect.facebook.net também é o SDK de
// "Entrar com Facebook" em sites de terceiros: se um login desses quebrar, use GUBOTS_ADBLOCK=0.
export const AD_RE = /^https?:\/\/([^/?#]*\.)?(doubleclick|googlesyndication|googleadservices|googletagmanager|google-analytics|adservice\.google|facebook\.net|connect\.facebook|taboola|outbrain|criteo|amazon-adsystem|adnxs|rubiconproject|pubmatic|openx|scorecardresearch|hotjar|quantserve|moatads|teads|smartadserver)\b[^/?#]*([/?#]|$)/i;
const KEEP = new Set(['image', 'stylesheet', 'font']);

type S = { ctx: BrowserContext; page: Page; cdp?: CDPSession; watchers: number; focus?: { x: number; y: number; w: number; h: number; ts: number }; dl: Promise<string>[] };

// ---- downloads: salvos em data/bots/<bot>/downloads/ (nome sugerido, sem sobrescrever) e avisados no retorno da ferramenta ----
const DL_WAIT = 120_000;
const CLICK_DL_WAIT = 15_000; // teto de espera depois do clique enquanto há XHR/fetch em andamento
const taken = new Set<string>();
// nome livre na pasta: "a.pdf", "a (1).pdf"… (reserva em memória contra downloads simultâneos)
export function freeName(dir: string, name: string) {
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(-150) || 'download';
  const ext = extname(name), base = name.slice(0, name.length - ext.length);
  for (let i = 0; ; i++) {
    const n = i ? `${base} (${i})${ext}` : name, p = join(dir, n);
    if (!taken.has(p) && !existsSync(p)) { taken.add(p); return n; }
  }
}
async function keep(botId: string, name: string, save: (path: string) => Promise<unknown>) {
  const dir = join(DATA, 'bots', botId, 'downloads');
  mkdirSync(dir, { recursive: true });
  let n = freeName(dir, name), p = join(dir, n);
  try {
    await save(p);
    // blob sem nome (nova aba/popup): nome é um GUID sem extensão; PDF ganha ".pdf"
    if (!extname(n) && readFileSync(p).subarray(0, 5).toString() === '%PDF-') {
      const n2 = freeName(dir, n + '.pdf'); renameSync(p, join(dir, n2)); taken.delete(p); taken.delete(join(dir, n2)); n = n2; p = join(dir, n2);
    }
    log(botId, `download salvo: downloads/${n}`, 'info');
    return `download salvo: downloads/${n} (${p}) · link /api/bots/${botId}/files/downloads/${encodeURIComponent(n)}`;
  } catch (e: any) { return `download falhou (${n}): ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`; }
  finally { taken.delete(p); }
}
// espera até `wait` ms um download começar; devolve os terminados (os lentos ficam para o próximo retorno)
async function drain(s: S, wait = 0) {
  for (let t = 0; t < wait && !s.dl.length; t += 100) await new Promise(r => setTimeout(r, 100));
  if (!s.dl.length) return '';
  const items = s.dl.splice(0), late = Symbol();
  const out = await Promise.all(items.map(p => Promise.race([p, new Promise<typeof late>(r => setTimeout(() => r(late), DL_WAIT).unref())])));
  out.forEach((r, i) => { if (r === late) s.dl.push(items[i]); });
  return '\n---\n' + out.map(r => r === late ? 'download ainda baixando (aparece no próximo retorno)' : r).join('\n');
}
const sessions = new Map<string, Promise<S>>();

// Chrome zumbi de execução anterior trava o perfil (exit 21): mata qualquer chrome.exe usando nossos perfis.
export function sweepZombies() {
  if (process.platform !== 'win32') return;
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${PROFILES.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 15_000, stdio: 'ignore' }); } catch {}
}

// Identificação de Chrome comum (mesma versão do Chrome instalado), para o bot não ser barrado como robô.
let ua: string | undefined | null = null;
function normalUA() {
  if (ua !== null) return ua;
  ua = undefined;
  try {
    const dir = join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application');
    const v = readdirSync(dir).filter(d => /^\d+\.\d+\.\d+\.\d+$/.test(d)).sort((a, b) => parseInt(b) - parseInt(a))[0];
    if (v) ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v.split('.')[0]}.0.0.0 Safari/537.36`;
  } catch {}
  return ua;
}

// PDF (aba, popup, blob, POST) baixa em vez de abrir no visualizador: o visualizador não gera evento 'download'
// e o corpo dele é HTML. Preferência do perfil, gravada antes de abrir o Chrome (só se o arquivo for legível).
function pdfAsDownload(dir: string) {
  const f = join(dir, 'Default', 'Preferences');
  let p: any = {};
  if (existsSync(f)) try { p = JSON.parse(readFileSync(f, 'utf8')); } catch { return; }
  if (p.plugins?.always_open_pdf_externally) return;
  p.plugins = { ...p.plugins, always_open_pdf_externally: true };
  mkdirSync(join(dir, 'Default'), { recursive: true });
  writeFileSync(f, JSON.stringify(p));
}

async function launch(botId: string): Promise<S> {
  try { pdfAsDownload(join(PROFILES, botId)); } catch {}
  const ctx = await chromium.launchPersistentContext(join(PROFILES, botId), {
    channel: process.env.GUBOTS_CHROME ? undefined : 'chrome',
    executablePath: process.env.GUBOTS_CHROME || undefined,
    headless: !(settings.headed || process.env.GUBOTS_HEADED === '1'), viewport: { width: 1280, height: 800 }, timeout: 15_000,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-features=Translate', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'], acceptDownloads: true,
    userAgent: normalUA(), // sem "HeadlessChrome": sites como o x.com recusam (403) o Chrome sem tela
  });
  if (settings.adblock && process.env.GUBOTS_ADBLOCK !== '0') await ctx.route(AD_RE, r => {
    const q = r.request();
    // imagem/CSS/fonte passam (o painel ao vivo precisa delas) e a página principal nunca é bloqueada
    if (KEEP.has(q.resourceType()) || (q.isNavigationRequest() && !q.frame().parentFrame())) return r.fallback();
    return r.abort('blockedbyclient');
  });
  ctx.setDefaultTimeout(ACT_TIMEOUT);
  ctx.setDefaultNavigationTimeout(NAV_TIMEOUT);
  const s: S = { ctx, page: ctx.pages()[0] ?? await ctx.newPage(), watchers: 0, dl: [] };
  // pop-up (ex.: "Entrar com Google") vira a aba ativa; quando fecha, volta para a aba que continua aberta
  const follow = (p: Page) => p.on('download', d => { s.dl.push(keep(botId, d.suggestedFilename(), f => d.saveAs(f))); }).on('close', () => {
    if (s.page !== p) return;
    const open = ctx.pages().filter(x => !x.isClosed());
    if (open.length) { s.page = open[open.length - 1]; restartCast(botId, s); }
  });
  follow(s.page);
  ctx.on('page', p => { s.page = p; follow(p); restartCast(botId, s); });
  ctx.on('close', () => sessions.delete(botId));
  return s;
}

// Chrome parado gasta ~1 GB: fecha depois de 5 min sem uso, se ninguém assiste o painel e o bot não está trabalhando.
// Os logins ficam no perfil em disco; a próxima navegação só reabre o Chrome (~2-4 s).
const IDLE = 5 * 60_000;
const lastUse = new Map<string, number>();
let busy: (botId: string) => boolean = () => false;
export const setBusy = (f: (botId: string) => boolean) => { busy = f; };
setInterval(async () => {
  for (const [id, p] of sessions) {
    const s = await p.catch(() => null);
    if (!s || s.watchers || busy(id) || Date.now() - (lastUse.get(id) ?? 0) < IDLE) continue;
    await close(id);
    emit({ t: 'activity', botId: id, item: { ts: Date.now(), kind: 'info', text: 'navegador fechado após 5 min parado (logins mantidos)' } });
  }
}, 60_000).unref();

export function get(botId: string): Promise<S> {
  lastUse.set(botId, Date.now());
  let p = sessions.get(botId);
  if (!p) { p = launch(botId); sessions.set(botId, p); p.catch(() => sessions.delete(botId)); }
  return p;
}

export async function closeAll() { await Promise.all([...sessions.values()].map(p => p.then(s => s.ctx.close()).catch(() => {}))); }
// Fecha o navegador de um bot (reabre sozinho no próximo uso, já com as configurações novas).
export async function close(botId: string) { const p = sessions.get(botId); sessions.delete(botId); await p?.then(s => s.ctx.close()).catch(() => {}); }
export const openBots = () => [...sessions.keys()];
// Apaga o perfil (cookies/logins salvos) do bot.
export async function wipeProfile(botId: string) { await close(botId); rmSync(join(PROFILES, botId), { recursive: true, force: true }); }

// ---- screencast ----
async function startCast(botId: string, s: S) {
  const page = s.page;
  const cdp = await page.context().newCDPSession(page);
  s.cdp = cdp;
  let sent = 0;
  cdp.on('Page.screencastFrame', (f: any) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    if (Date.now() - sent < 80) return; // ~12 fps basta e poupa banda no celular
    sent = Date.now();
    const focus = s.focus && Date.now() - s.focus.ts < 2500 ? s.focus : undefined;
    emit({ t: 'frame', botId, data: f.data, w: f.metadata.deviceWidth, h: f.metadata.deviceHeight, url: page.url(), focus });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
}
async function stopCast(s: S) { const c = s.cdp; s.cdp = undefined; await c?.send('Page.stopScreencast').catch(() => {}); await c?.detach().catch(() => {}); }
async function restartCast(botId: string, s: S) { if (!s.watchers) return; await stopCast(s); await startCast(botId, s).catch(() => {}); }

export async function watch(botId: string, on: boolean) {
  const s = await get(botId);
  s.watchers = Math.max(0, s.watchers + (on ? 1 : -1));
  if (on && !s.cdp) await startCast(botId, s);
  if (!s.watchers) await stopCast(s);
  if (on) emit({ t: 'activity', botId, item: { ts: Date.now(), kind: 'nav', text: s.page.url().slice(0, 160) } });
}

// "Assumir controle": eventos da UI em coordenadas CSS da página
export async function input(botId: string, ev: any) {
  const { page } = await get(botId);
  if (ev.type === 'click') await page.mouse.click(ev.x, ev.y);
  else if (ev.type === 'wheel') await page.mouse.wheel(0, ev.dy || 0);
  else if (ev.type === 'key') await page.keyboard.press(ev.key);
  else if (ev.type === 'text') await page.keyboard.insertText(ev.text);
}

// ---- ferramentas do agente ----
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + `\n…[+${s.length - n} caracteres; use browser_get_text com selector]` : s);
const log = (botId: string, text: string, kind = 'tool') => emit({ t: 'activity', botId, item: { ts: Date.now(), kind, text: text.length > 160 ? text.slice(0, 160) + '…' : text } }); // URLs de login são enormes

async function markFocus(s: S, loc: ReturnType<Page['locator']>) {
  const b = await loc.boundingBox().catch(() => null);
  if (b) s.focus = { x: b.x, y: b.y, w: b.width, h: b.height, ts: Date.now() };
}
const target = (page: Page, a: { ref?: string; selector?: string; text?: string }) =>
  a.ref ? page.locator(`aria-ref=${a.ref}`) : a.selector ? page.locator(a.selector).first() : page.getByText(a.text!, { exact: false }).first();

export async function open(botId: string, url: string) {
  const s = await get(botId);
  if (url === 'back') await s.page.goBack({ waitUntil: 'domcontentloaded' });
  else {
    if (!/^[a-z]+:/i.test(url)) url = 'https://' + url;
    log(botId, `abrir ${url}`, 'nav');
    try {
      await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } catch (e: any) {
      // URL de arquivo: o Chrome baixa em vez de abrir (o evento 'download' já está guardando)
      if (!/Download is starting|ERR_ABORTED/i.test(String(e?.message))) throw e;
      const got = await drain(s, 3000);
      if (!got) throw e;
      return `${await s.page.title().catch(() => '')}\n${s.page.url()}${got}`;
    }
  }
  const text = await s.page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  // links com texto de verdade (manchetes, itens de lista): evita clicar em cada um só para descobrir a URL
  const links: string[] = await s.page.evaluate(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const a of Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]) {
      const t = (a.innerText || '').replace(/\s+/g, ' ').trim();
      if (t.length < 25 || seen.has(a.href) || !a.href.startsWith('http') || !a.getClientRects().length) continue;
      seen.add(a.href); out.push(`- ${t.slice(0, 140)} → ${a.href}`);
      if (out.length >= 25) break;
    }
    return out;
  }).catch(() => []);
  return `${await s.page.title().catch(() => '')}\n${s.page.url()}\n---\n${clip(text.replace(/\n{3,}/g, '\n\n'), 2500)}${links.length ? `\n---\nLinks:\n${links.join('\n')}` : ''}${await drain(s)}`;
}
export async function snapshot(botId: string) {
  const s = await get(botId);
  log(botId, 'snapshot');
  return clip(await s.page.ariaSnapshot({ mode: 'ai', timeout: ACT_TIMEOUT }), 12000) + await drain(s);
}
export async function click(botId: string, a: { ref?: string; selector?: string; text?: string }) {
  const s = await get(botId);
  const loc = target(s.page, a);
  await markFocus(s, loc);
  log(botId, `clicar ${a.ref || a.selector || a.text}`);
  // botão que gera o arquivo por XHR/fetch (ex.: Receita) só baixa segundos depois: espera essas chamadas acabarem
  const inflight = new Set<unknown>(); let last = Date.now();
  const on = (r: any) => { if (['xhr', 'fetch', 'document'].includes(r.resourceType())) { inflight.add(r); last = Date.now(); } };
  const off = (r: any) => { if (inflight.delete(r)) last = Date.now(); };
  s.ctx.on('request', on); s.ctx.on('requestfinished', off); s.ctx.on('requestfailed', off);
  try {
    await loc.click({ timeout: ACT_TIMEOUT });
    await s.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    const t0 = Date.now();
    while (!s.dl.length && Date.now() - t0 < CLICK_DL_WAIT && (inflight.size || Date.now() - Math.max(last, t0) < 800 || Date.now() - t0 < 1500)) await new Promise(r => setTimeout(r, 100));
  } finally { s.ctx.off('request', on); s.ctx.off('requestfinished', off); s.ctx.off('requestfailed', off); }
  return `ok · ${s.page.url()}${await drain(s)}`;
}
export async function type(botId: string, a: { ref?: string; selector?: string; text: string; submit?: boolean }) {
  const s = await get(botId);
  const loc = target(s.page, { ref: a.ref, selector: a.selector || (a.ref ? undefined : 'input:visible, textarea:visible') });
  await markFocus(s, loc);
  log(botId, `digitar em ${a.ref || a.selector}`);
  await loc.fill(a.text, { timeout: ACT_TIMEOUT });
  if (a.submit) { await loc.press('Enter'); await s.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {}); }
  return `ok · ${s.page.url()}${await drain(s, a.submit ? 1500 : 0)}`;
}
export async function getText(botId: string, selector?: string, max = 6000) {
  const { page } = await get(botId);
  log(botId, `ler texto ${selector || 'página'}`);
  const t = await page.locator(selector || 'body').first().innerText({ timeout: ACT_TIMEOUT });
  return clip(t.replace(/\n{3,}/g, '\n\n'), max);
}
export async function screenshot(botId: string) {
  const { page } = await get(botId);
  log(botId, 'screenshot');
  return (await page.screenshot({ type: 'jpeg', quality: 60, timeout: ACT_TIMEOUT })).toString('base64');
}
