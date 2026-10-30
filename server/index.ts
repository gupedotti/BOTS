// Servidor local: REST + WebSocket + MCP + app estático (PWA). 127.0.0.1 por padrão; token quando exposto.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, watchFile, writeFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { execFile, spawn } from 'node:child_process';
try { process.loadEnvFile(join(import.meta.dirname, '..', '.env')); } catch {}
// log recente em memória para Configurações → Sistema (o arquivo de log fica com o start.vbs)
const LOG: string[] = [];
for (const k of ['log', 'error'] as const) { const orig = console[k]; console[k] = (...a: any[]) => { LOG.push(`${new Date().toTimeString().slice(0, 8)} ${a.map(x => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`); if (LOG.length > 300) LOG.shift(); orig(...a); }; }
const { bus, bots, convs, tasks, facts, messages, searchMessages, emit, DATA, pubConv, markRead, setCheck } = await import('./db.ts');
const { preview } = await import('./preview.ts');
const office = await import('./office.ts');
const { vault, askMeta, answer } = await import('./vault.ts');
const hub = await import('./hub.ts');
const br = await import('./browser.ts');
const mem = await import('./memory.ts');
const { models, ask, stopCodex, closeClaude } = await import('./engines.ts');
const { handleMcp } = await import('./mcp.ts');
const composio = await import('./composio.ts');
const cfg = await import('./settings.ts');
const stt = await import('./stt.ts');
const push = await import('./push.ts');
const sched = await import('./schedule.ts');
const mission = await import('./mission.ts');
const ROOT = join(import.meta.dirname, '..');
const pkgVersion = (p: string) => { try { return JSON.parse(readFileSync(join(ROOT, p, 'package.json'), 'utf8')).version as string; } catch { return undefined; } };
const run = (cmd: string, args: string[]) => new Promise<string>(ok => execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (e, out) => ok(e ? '' : String(out).trim())));
let tailnet: Promise<string | undefined> | undefined; // URL https do `tailscale serve`, se houver
const tailscaleUrl = () => (tailnet ??= run('tailscale', ['status', '--json']).then(o => { try { const n = JSON.parse(o).Self?.DNSName?.replace(/\.$/, ''); return n ? `https://${n}` : undefined; } catch { return undefined; } }));
const started = Date.now();

const HOST = process.env.HOST || '127.0.0.1';
const DIST = join(import.meta.dirname, '..', 'web', 'dist');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
// arquivos dos bots (download pelo chat)
const FILE_MIME: Record<string, string> = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.zip': 'application/zip' };

// Local = conexão direta de loopback sem proxy. Túnel Cloudflare / tailscale serve chegam pelo loopback, mas com cabeçalhos de proxy.
const isLocal = (req: IncomingMessage) => /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip']
  && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '');
const cookie = (req: IncomingMessage, name: string) => (req.headers.cookie ?? '').split(/;\s*/).find(c => c.startsWith(name + '='))?.slice(name.length + 1);
// remoto: cookie de sessão (login por senha); x-gubots-token fica para chamadas internas
const authed = (req: IncomingMessage) => isLocal(req) || req.headers['x-gubots-token'] === hub.TOKEN || cfg.validSession(cookie(req, 'gubots_s'));
const secure = (req: IncomingMessage) => req.headers['x-forwarded-proto'] === 'https' || !!req.headers['cf-connecting-ip'];
const setSession = (req: IncomingMessage, res: ServerResponse, v: string, maxAge: number) =>
  res.setHeader('set-cookie', `gubots_s=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`);
// tentativas de senha: 5 erros por IP → espera 5 min
const fails = new Map<string, { n: number; until: number }>();
const clientIp = (req: IncomingMessage) => String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();

const json = (res: ServerResponse, code: number, v: any) => { res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(v)); };
const readBody = (req: IncomingMessage, max = 50 * 1024 * 1024) => new Promise<Buffer>((ok, ko) => {
  const parts: Buffer[] = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > max) { ko(new Error('corpo grande demais')); req.destroy(); } else parts.push(c); });
  req.on('end', () => ok(Buffer.concat(parts))); req.on('error', ko);
});
const state = () => ({ bots: bots.all().map(hub.publicBot), convs: convs.all().sort((a, b) => b.lastTs - a.lastTs).map(pubConv), tasks: tasks.all().slice(-200).reverse(), schedules: sched.schedules.all() });

type H = (p: { req: IncomingMessage; res: ServerResponse; m: RegExpMatchArray; url: URL; body: () => Promise<any>; raw: () => Promise<Buffer> }) => any;
const routes: [string, RegExp, H][] = [];
const r = (method: string, path: string, h: H) => routes.push([method, new RegExp(`^${path.replace(/:(\w+)/g, '([^/]+)')}$`), h]);

r('GET', '/api/state', () => state());
r('GET', '/api/models', ({ url }) => models(url.searchParams.has('refresh')));
r('POST', '/api/bots', async ({ body }) => hub.publicBot(hub.createBot(await body())));
r('PUT', '/api/bots/:id', async ({ m, body }) => hub.publicBot(hub.updateBot(m[1], await body())));
r('DELETE', '/api/bots/:id', ({ m }) => (hub.deleteBot(m[1]), { ok: true }));
r('POST', '/api/bots/draft', async ({ body }) => {
  const { description } = await body();
  const out = await ask(`Crie a configuração de um bot a partir desta descrição de trabalho: """${String(description).slice(0, 2000)}"""\n` +
    `JSON: {"name":"nome curto","avatar":"um de ${hub.AVATARS.join('|')}","job":"uma frase","engine":"claude|codex","tools":[subconjunto de ${hub.TOOLS.join(',')}],"composio":[slugs de toolkits Composio se precisar de apps, ex gmail, slack],"profile":"3-5 linhas de instruções do bot"}`);
  return JSON.parse(out.replace(/^```(json)?|```$/g, '').trim());
});
r('POST', '/api/bots/:id/login', async ({ m, body }) => {
  const b = bots.get(m[1]); if (!b) throw new Error('bot não existe');
  const { domain } = await body(); const d = String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const tools = b.tools.includes('browser') ? b.tools : [...b.tools, 'browser'];
  hub.updateBot(b.id, { logins: [...b.logins, d], tools });
  br.open(b.id, d).catch(() => {}); // usuário loga pelo painel ao vivo ("Assumir controle")
  return { ok: true };
});
r('DELETE', '/api/bots/:id/login/:domain', ({ m }) => { const b = bots.get(m[1])!; hub.updateBot(b.id, { logins: b.logins.filter(d => d !== decodeURIComponent(m[2])) }); return { ok: true }; });
r('GET', '/api/bots/:id/files', ({ m }) => {
  const dir = hub.botDir(m[1]); if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile() && !/^(CLAUDE|AGENTS)\.md$/.test(e.name) && !/[\\/]\.|^\./.test(join(e.parentPath, e.name).slice(dir.length + 1)))
    .map(e => { const p = join(e.parentPath, e.name); const s = statSync(p); return { name: p.slice(dir.length + 1).split(sep).join('/'), size: s.size, mtime: s.mtimeMs }; });
});
r('GET', '/api/bots/:id/files/(.+)', ({ m, res }) => {
  const dir = hub.botDir(m[1]); const p = normalize(join(dir, decodeURIComponent(m[2])));
  if (!p.startsWith(dir + sep) || !existsSync(p)) return json(res, 404, { error: 'não encontrado' });
  res.writeHead(200, { 'content-type': FILE_MIME[extname(p).toLowerCase()] ?? MIME[extname(p)] ?? 'application/octet-stream', 'cache-control': 'private, no-store',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(p.split(sep).pop()!)}` });
  createReadStream(p).pipe(res);
});
r('POST', '/api/convs', async ({ body }) => {
  const c = await body(); const id = Math.random().toString(36).slice(2, 10);
  const botIds = (c.botIds ?? []).filter((b: string) => bots.get(b)); if (!botIds.length) throw new Error('escolha ao menos um bot');
  const conv = convs.put({ id, kind: 'bot', title: c.title || botIds.map((b: string) => bots.get(b)!.name).join(', '), botIds: botIds.slice(0, 1), lastTs: Date.now(), readTs: Date.now() });
  emit({ t: 'conv', conv: pubConv(conv) }); return pubConv(conv);
});
r('DELETE', '/api/convs/:id', ({ m }) => (convs.del(m[1]), { ok: true })); // histórico bruto fica no banco e em raw/
r('GET', '/api/convs/:id/messages', ({ m }) => messages(m[1]));
r('POST', '/api/convs/:id/read', ({ m }) => markRead(m[1]) ?? { ok: false });
r('POST', '/api/convs/:id/messages', async ({ m, body, res }) => {
  const b = await body(), text = String(b.text ?? '').trim(), files = Array.isArray(b.files) ? b.files.map(String) : [];
  (convs.get(m[1])?.kind === 'mission' ? mission.send : hub.send)(m[1], text, files); json(res, 202, { ok: true });
});
// missão: grupo visível orquestrado pelo chefe (problema + 2 a 6 bots); encerrar = síntese final na memória
r('POST', '/api/missions', async ({ body }) => mission.createMission(await body()));
r('POST', '/api/convs/:id/close', ({ m }) => mission.closeMission(m[1]));
// anexo: corpo = bytes do arquivo; devolve o nome a mandar em "files" na mensagem
r('POST', '/api/convs/:id/upload', async ({ m, url, raw }) => {
  if (!convs.get(m[1])) throw new Error('conversa não existe');
  const name = (url.searchParams.get('name') ?? 'arquivo').split(/[\\/]/).pop()!.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'arquivo';
  const b = await raw(); if (!b.length) throw new Error('arquivo vazio');
  const dir = join(hub.UPLOADS, m[1]); mkdirSync(dir, { recursive: true });
  const file = `${Date.now()}-${name}`; writeFileSync(join(dir, file), b);
  const { path, ...a } = hub.attachment(m[1], file);
  return { file, ...a };
});
// arquivo do chat (do bot ou anexo) → caminho no disco, só dentro da pasta dele; perfis do bot não
function chatFile(url: string) {
  let m = /^\/api\/bots\/([\w-]+)\/files\/(.+)$/.exec(url);
  if (m && bots.get(m[1])) {
    const dir = hub.botDir(m[1]); const p = normalize(join(dir, decodeURIComponent(m[2])));
    return p.startsWith(dir + sep) && !/^(CLAUDE|AGENTS)\.md$/i.test(p.slice(dir.length + 1)) ? p : null;
  }
  m = /^\/api\/convs\/([\w-]+)\/files\/([^/]+)$/.exec(url);
  if (m) { const dir = join(hub.UPLOADS, m[1]); const p = normalize(join(dir, decodeURIComponent(m[2]))); return p.startsWith(dir + sep) ? p : null; }
  return null;
}
// prévia de pptx/xlsx no chat: converte pelo Office do PC e devolve o PDF (cache por arquivo+data)
r('GET', '/api/office-pdf', async ({ url, res }) => {
  const p = chatFile(url.searchParams.get('url') ?? ''); if (!p || !existsSync(p)) return json(res, 404, { error: 'não encontrado' });
  const pdf = await office.toPdf(p);
  res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'private, no-store' });
  createReadStream(pdf).pipe(res);
});
r('POST', '/api/files/exists', async ({ body }) => { const urls: string[] = ((await body()).urls ?? []).slice(0, 300).map(String); return Object.fromEntries(urls.map(u => { const p = chatFile(u); return [u, !!p && existsSync(p)]; })); });
r('POST', '/api/files/delete', async ({ body }) => {
  const p = chatFile(String((await body()).url ?? '')); if (!p) throw new Error('arquivo inválido');
  if (existsSync(p)) unlinkSync(p);
  return { ok: true };
});
r('GET', '/api/convs/:id/files/:name', ({ m, res }) => {
  const a = hub.attachment(m[1], decodeURIComponent(m[2]));
  res.writeHead(200, { 'content-type': a.mime, 'cache-control': 'private, max-age=86400', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.name)}` });
  createReadStream(a.path).pipe(res);
});
r('POST', '/api/convs/:id/stop', ({ m }) => ((convs.get(m[1])?.kind === 'mission' ? mission.stop : hub.stop)(m[1]), { ok: true }));
r('DELETE', '/api/queue/:id', ({ m }) => (hub.cancelQueued(Number(m[1])), { ok: true })); // tira um pedido da fila antes de rodar
// tarefas agendadas (cron por bot): criar, editar/pausar, excluir, rodar agora
r('GET', '/api/schedules', () => sched.schedules.all());
r('POST', '/api/schedules', async ({ body }) => sched.createSchedule(await body()));
r('PATCH', '/api/schedules/:id', async ({ m, body }) => sched.updateSchedule(Number(m[1]), await body()));
r('DELETE', '/api/schedules/:id', ({ m }) => (sched.deleteSchedule(Number(m[1])), { ok: true }));
r('POST', '/api/schedules/:id/run', ({ m }) => { const id = Number(m[1]); if (!sched.schedules.get(id)) throw new Error('agenda não existe'); if (sched.isRunning(id)) throw new Error('já está rodando'); sched.fire(id, true).catch(() => {}); return { ok: true }; });
r('GET', '/api/tasks', () => tasks.all().reverse());
r('POST', '/api/tasks/:id/reassign', async ({ m, body }) => (hub.reassign(Number(m[1]), (await body()).assignee), { ok: true }));
r('POST', '/api/tasks/:id/cancel', ({ m }) => (hub.cancelTask(Number(m[1])), { ok: true }));
r('DELETE', '/api/tasks/:id', ({ m }) => (hub.deleteTask(Number(m[1])), { ok: true }));
// cofre de senhas: a API nunca devolve o valor
r('GET', '/api/vault', () => vault.list());
r('POST', '/api/vault', async ({ body }) => { const b = await body(); return vault.save({ id: b.id, name: b.name, site: b.site, username: b.username, password: b.password, botIds: Array.isArray(b.botIds) ? b.botIds : [] }); });
r('DELETE', '/api/vault/:id', ({ m }) => (vault.del(m[1]), { ok: true }));
// resposta a um cartão de pedido do bot (senha ou "assuma o navegador"); a ferramenta que esperava continua
r('POST', '/api/asks/:req', async ({ m, body }) => {
  const b = await body(), meta = askMeta(m[1]);
  if (!meta) throw new Error('pedido expirou ou já foi respondido');
  if (meta.kind === 'secret-request' && b.action === 'save') {
    const sec = vault.save({ name: meta.name, site: meta.site, username: b.username ?? meta.username, password: String(b.password ?? ''), botIds: b.allBots ? [] : [meta.botId] });
    answer(m[1], 'saved', { name: sec.name });
  } else if (meta.kind === 'takeover' && b.action === 'done') answer(m[1], 'done', { ok: true, note: b.note });
  else answer(m[1], 'canceled', meta.kind === 'takeover' ? { ok: false, note: b.note } : {});
  return { ok: true };
});
r('POST', '/api/messages/:id/check', async ({ m, body }) => { const b = await body(); setCheck(Number(m[1]), String(b.key ?? ''), !!b.on); return { ok: true }; });
r('GET', '/api/preview', ({ url }) => preview(url.searchParams.get('url') ?? '')); // prévia de link (só endereços públicos)
r('GET', '/api/memory/search', ({ url }) => { const q = url.searchParams.get('q') ?? ''; return { facts: facts.search(q, 20, true), messages: searchMessages(q, 20), notes: mem.searchNotes(q) }; });
r('GET', '/api/memory/facts', () => facts.all());
r('POST', '/api/memory/facts', async ({ body }) => { const b = await body(); return facts.add(String(b.text), 'user', { by: 'usuário' }, !!b.pinned); });
r('PATCH', '/api/memory/facts/:id', async ({ m, body }) => (facts.pin(Number(m[1]), !!(await body()).pinned), { ok: true }));
r('DELETE', '/api/memory/facts/:id', ({ m, url }) => (url.searchParams.has('hard') ? facts.del(Number(m[1])) : facts.obsolete(Number(m[1])), { ok: true })); // ?hard = apagar de vez (só obsoleto)
r('POST', '/api/memory/inbox', async ({ req, url, raw }) => {
  const b = await raw();
  if ((req.headers['content-type'] ?? '').includes('json')) await mem.inboxAdd(JSON.parse(b.toString('utf8')));
  else await mem.inboxAdd({ name: url.searchParams.get('name') ?? 'arquivo', bytes: b });
  return { ok: true };
});
r('GET', '/api/memory/graph', () => mem.graph());
r('POST', '/api/memory/graph/update', () => { mem.graphUpdate().catch(e => emit({ t: 'activity', botId: '', item: { ts: Date.now(), kind: 'error', text: e.message } })); return { ok: true }; });
r('POST', '/api/memory/obsidian', () => ({ path: mem.writeFactsMd() }));
r('GET', '/api/composio/apps', async () => composio.isConnect()
  ? { mode: 'connect', apps: await composio.connectedApps(true), dashboard: composio.DASHBOARD }
  : { mode: cfg.composioKey() ? 'project' : 'none', apps: [], dashboard: composio.DASHBOARD });
r('GET', '/api/composio/toolkits', ({ url }) => hub.composioToolkits(url.searchParams.get('q') ?? ''));
r('POST', '/api/stt', async ({ raw, req, res, url }) => { // ditado: áudio no corpo (WAV 16 kHz do navegador; webm/mp4 como reserva), só em memória
  if (Number(req.headers['content-length'] ?? 0) > stt.MAX_BYTES) return json(res, 413, { error: 'áudio grande demais (máx. ~5 min)' });
  try {
    const text = await stt.transcribe(await raw(), String(req.headers['content-type'] || 'audio/wav'));
    if (url.searchParams.has('partial')) return { text }; // texto ao vivo enquanto grava: sem refino
    return { text: await stt.refine(text, url.searchParams.get('conv') ?? undefined), raw: text };
  }
  catch (e: any) { return json(res, e.status ?? 500, { error: String(e?.message ?? e) }); }
});
r('POST', '/api/stt/warm', () => (stt.warm(), { ok: true })); // começou a gravar: já carrega o modelo
r('POST', '/api/login', async ({ req, res, body }) => {
  const ip = clientIp(req); const f = fails.get(ip);
  if (f && f.until > Date.now()) return json(res, 429, { error: 'muitas tentativas; espere alguns minutos' });
  if (!cfg.hasPassword()) return json(res, 503, { error: 'senha ainda não definida no servidor' });
  if (!cfg.checkPassword(String((await body()).password ?? ''))) {
    const n = (f?.n ?? 0) + 1; fails.set(ip, { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    return json(res, 401, { error: 'senha incorreta' });
  }
  fails.delete(ip); setSession(req, res, cfg.newSession(), 30 * 86400);
  return { ok: true };
});
r('POST', '/api/logout', ({ req, res }) => { setSession(req, res, '', 0); return { ok: true }; });
r('POST', '/api/password', async ({ req, res, body }) => {
  const { current, next } = await body();
  if (cfg.hasPassword() && !cfg.checkPassword(String(current ?? ''))) return json(res, 400, { error: 'senha atual incorreta' });
  cfg.setPassword(String(next ?? '')); // invalida todas as sessões; renova a deste aparelho
  setSession(req, res, cfg.newSession(), 30 * 86400);
  return { ok: true };
});
// notificações push (celular): chave pública, inscrever/remover este aparelho e teste
r('GET', '/api/push/key', () => ({ key: push.publicKey(), devices: push.count() }));
r('POST', '/api/push/subscribe', async ({ req, body }) => { push.subscribe(await body(), String(req.headers['user-agent'] ?? '')); return { ok: true, devices: push.count() }; });
r('POST', '/api/push/unsubscribe', async ({ body }) => { push.unsubscribe(String((await body()).endpoint ?? '')); return { ok: true }; });
r('POST', '/api/push/test', async ({ body }) => {
  const chief = [...bots.all()].find((b) => b.isChief) ?? bots.all()[0];
  await push.notify({ title: chief?.name ?? 'Gubots', body: 'Notificações ativas. Quando um pedido seu terminar, aviso por aqui.', tag: 'teste', icon: `/avatars/${(chief?.avatar ?? 'orion').split('#')[0]}.png` }, String((await body()).endpoint ?? ''));
  return { ok: true };
});
r('GET', '/api/settings', () => cfg.pub());
r('PUT', '/api/settings', async ({ body }) => {
  const before = { a: cfg.settings.adblock, h: cfg.settings.headed };
  const out = cfg.update(await body());
  // navegador muda de modo: fecha os ociosos agora (reabrem sozinhos já com a configuração nova)
  if (before.a !== cfg.settings.adblock || before.h !== cfg.settings.headed) for (const id of br.openBots()) if (!hub.isBusy(id)) br.close(id);
  return out;
});
r('GET', '/api/system', async () => {
  const m = await models();
  const gv = await run('graphify', ['--version']);
  const ts = await tailscaleUrl();
  return {
    version: pkgVersion('.'), dataDir: DATA, uptime: Date.now() - started,
    engines: {
      claude: { ok: !m.errors.claude && m.claude.length > 0, version: pkgVersion('node_modules/@anthropic-ai/claude-agent-sdk'), models: m.claude.length, error: m.errors.claude },
      codex: { ok: !m.errors.codex && m.codex.length > 0, version: pkgVersion('node_modules/@openai/codex'), models: m.codex.length, error: m.errors.codex },
    },
    graphify: { ok: !!gv, version: gv.replace(/^graphify\s*/i, '') || undefined },
    remote: { urls: [`http://127.0.0.1:${hub.PORT}`, ...(process.env.GUBOTS_PUBLIC_URL ? [process.env.GUBOTS_PUBLIC_URL] : []), ...(ts ? [ts] : [])] },
  };
});
r('GET', '/api/logs', () => ({ lines: LOG.slice(-200) }));
r('POST', '/api/browser/restart', async () => { await Promise.all(br.openBots().filter(id => !hub.isBusy(id)).map(br.close)); return { ok: true }; });
r('DELETE', '/api/bots/:id/profile', async ({ m }) => {
  const b = bots.get(m[1]); if (!b) throw new Error('bot não existe');
  if (hub.isBusy(b.id)) throw new Error(`${b.name} está trabalhando; tente quando terminar`);
  await br.wipeProfile(b.id); hub.updateBot(b.id, { logins: [] });
  return { ok: true };
});
r('POST', '/api/system/open-data', ({ req }) => {
  if (!isLocal(req)) throw new Error('só no próprio PC');
  spawn('explorer.exe', [DATA], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true };
});
r('POST', '/api/quit', ({ res }) => { json(res, 200, { ok: true }); setTimeout(shutdown, 100); });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (url.pathname.startsWith('/mcp/')) {
      if (req.headers['x-gubots-token'] !== hub.TOKEN) return json(res, 401, { error: 'token' });
      const raw = await readBody(req);
      const cm = /^\/mcp\/([^/]+)\/composio$/.exec(url.pathname);
      if (cm) return await composio.handleComposio(decodeURIComponent(cm[1]), req, res, raw.length ? JSON.parse(raw.toString('utf8')) : undefined);
      return await handleMcp(decodeURIComponent(url.pathname.slice(5)), url.searchParams.get('conv') ?? '', req, res, raw.length ? JSON.parse(raw.toString('utf8')) : undefined);
    }
    if (url.pathname.startsWith('/api/')) {
      if (!authed(req) && !['/api/login', '/api/logout'].includes(url.pathname)) return json(res, 401, { error: 'login' });
      for (const [method, re, h] of routes) {
        const m = url.pathname.match(re);
        if (m && method === req.method) {
          let buf: Promise<Buffer> | undefined; const raw = () => (buf ??= readBody(req));
          const out = await h({ req, res, m, url, raw, body: async () => { const b = await raw(); return b.length ? JSON.parse(b.toString('utf8')) : {}; } });
          if (!res.headersSent && out !== undefined) json(res, 200, out);
          return;
        }
      }
      return json(res, 404, { error: 'rota não existe' });
    }
    // estático + fallback SPA
    let p = normalize(join(DIST, decodeURIComponent(url.pathname)));
    if (!p.startsWith(DIST) || !existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
    if (!existsSync(p)) return res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('UI não compilada: rode npm run build');
    const fresh = p.endsWith('index.html') || p.endsWith('sw.js');
    // só /assets/ tem hash no nome; ícones e manifest mudam sem mudar de nome, então revalidam
    const hashed = url.pathname.startsWith('/assets/');
    res.writeHead(200, {
      'content-type': MIME[extname(p)] ?? 'application/octet-stream', 'cache-control': fresh ? 'no-store' : hashed ? 'max-age=31536000, immutable' : 'no-cache',
      // /sw.js sem ?v= só é pedido pelo service worker do app ANTIGO deste domínio (o Jarvis anterior): o navegador
      // sempre busca esse arquivo na rede, então aproveitamos para mandar apagar o cache velho do site.
      ...(url.pathname === '/sw.js' && !url.search ? { 'clear-site-data': '"cache"' } : {}),
    });
    createReadStream(p).pipe(res);
  } catch (e: any) {
    if (!res.headersSent) json(res, 400, { error: String(e?.message ?? e) });
  }
});

// ---- WebSocket: eventos ao vivo; frames do screencast só para quem assiste aquele bot ----
const wss = new WebSocketServer({ noServer: true });
const watching = new Map<WebSocket, string | null>();
server.on('upgrade', (req, sock, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname !== '/ws') return sock.destroy();
  if (!authed(req)) return wss.handleUpgrade(req, sock, head, ws => ws.close(4401, 'login')); // UI mostra a tela Entrar
  wss.handleUpgrade(req, sock, head, ws => wss.emit('connection', ws));
});
wss.on('connection', ws => {
  watching.set(ws, null);
  ws.send(JSON.stringify({ t: 'build', id: buildId() }));
  const unwatch = () => { const b = watching.get(ws); if (b && bots.get(b)?.tools.includes('browser')) br.watch(b, false).catch(() => {}); };
  ws.on('message', async d => {
    let m: any; try { m = JSON.parse(String(d)); } catch { return; }
    try {
      if (m.t === 'watch') { unwatch(); watching.set(ws, m.botId ?? null); if (bots.get(m.botId)?.tools.includes('browser')) await br.watch(m.botId, true); }
      else if (m.t === 'input' && bots.get(m.botId)) await br.input(m.botId, m.ev);
      else if (m.t === 'nav' && bots.get(m.botId)) await br.open(m.botId, String(m.url));
    } catch (e: any) { ws.send(JSON.stringify({ t: 'activity', botId: m.botId, item: { ts: Date.now(), kind: 'error', text: String(e.message).split('\n')[0] } })); }
  });
  ws.on('close', () => { unwatch(); watching.delete(ws); });
  ws.on('pong', () => alive.add(ws));
  alive.add(ws);
});
// heartbeat: o Cloudflare derruba WS ocioso (~100 s); a cada 25 s um ping de texto mantém vivo e o ping/pong
// do protocolo acha cliente morto (celular dormiu, túnel caiu) para fechar e parar o screencast dele
const alive = new Set<WebSocket>();
setInterval(() => {
  for (const ws of watching.keys()) {
    if (!alive.delete(ws)) { ws.terminate(); continue; }
    ws.ping();
    if (ws.readyState === 1) ws.send('{"t":"ping"}');
  }
}, 25_000).unref();
bus.on('ws', (o: any) => {
  const s = JSON.stringify(o);
  for (const [ws, b] of watching) if (ws.readyState === 1 && (o.t !== 'frame' || b === o.botId)) ws.send(s);
});

// ---- ciclo de vida: nunca deixar Chrome/codex órfãos ----
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  stopCodex(); closeClaude();
  await Promise.race([br.closeAll(), new Promise(r => setTimeout(r, 3000))]);
  br.sweepZombies();
  process.exit(0);
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(s, shutdown);
process.on('uncaughtException', e => console.error('uncaught', e));
process.on('unhandledRejection', e => console.error('unhandled', e));

// reinício pedido pelo bot de manutenção: espera os bots terminarem, sobe um novo servidor (start.vbs, oculto) e sai
bus.on('restart', (why: string) => {
  console.log('reinício pedido:', why);
  const iv = setInterval(() => {
    if (hub.active.size) return;
    clearInterval(iv);
    spawn('wscript.exe', [join(ROOT, 'start.vbs'), 'restart'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    shutdown();
  }, 1000);
});
// build novo da UI (ex.: o bot de manutenção rodou npm run build): avisa as abas abertas
const buildId = () => { try { return String(statSync(join(DIST, 'index.html')).mtimeMs) } catch { return '' } };
watchFile(join(DIST, 'index.html'), { interval: 3000 }, () => emit({ t: 'build', id: buildId() }));

br.setBusy(id => [...hub.active.values()].some(r => r.botId === id));
br.sweepZombies();
sched.startScheduler();
// grafo em lote às 03:00
setInterval(() => { if (cfg.settings.graphNightly && new Date().getHours() === 3 && new Date().getMinutes() === 0) mem.graphUpdate().catch(() => {}); }, 60_000);

server.on('error', (e: any) => { console.error(e.code === 'EADDRINUSE' ? `porta ${hub.PORT} ocupada: o Gubots já está rodando?` : e); process.exit(1); });
server.listen(hub.PORT, HOST, () => {
  console.log(`Gubots em http://${HOST}:${hub.PORT}${cfg.hasPassword() ? '' : '  (sem senha: acesso remoto bloqueado até definir uma)'}`);
  models().catch(() => {}); // aquece listas de modelos
});
