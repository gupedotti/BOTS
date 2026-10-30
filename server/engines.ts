// Dois motores, um stream: Claude (Agent SDK, login do `claude`) e Codex (`codex app-server` JSON-RPC, login do `codex`).
import { query } from '@anthropic-ai/claude-agent-sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';

export type Ev = { k: 'delta'; text: string } | { k: 'tool'; name: string; input?: any } | { k: 'session'; sid: string } | { k: 'final'; text: string };
export type Mcp = { name: string; url: string; headers?: Record<string, string> };
export type Attachment = { name: string; path: string; mime: string; size: number; url: string };
export type RunOpts = { attachments?: Attachment[]; key: string; model: string; effort?: string; cwd: string; system: string; prompt: string; sid?: string; tools: string[]; mcp: Mcp[]; signal: AbortSignal };

// design = skills de slides/docs/mockups (rodam scripts): Skill + terminal + arquivos
const BUILTIN: Record<string, string[]> = { files: ['Read', 'Write', 'Edit', 'Glob', 'Grep'], shell: ['Bash', 'PowerShell'], web: ['WebSearch', 'WebFetch'], design: ['Skill', 'Bash', 'PowerShell', 'Read', 'Write', 'Edit', 'Glob', 'Grep'] };

// ---------------- anexos ----------------
const TEXT_EXT = /^\.(txt|md|csv|tsv|json|jsonl|xml|html?|css|js|mjs|ts|tsx|jsx|py|java|c|cpp|h|cs|go|rs|rb|php|sql|ya?ml|toml|ini|log|sh|ps1|bat)$/i;
const isImage = (a: Attachment) => /^image\/(png|jpe?g|gif|webp)$/.test(a.mime) && a.size <= 5_000_000;
const isPdf = (a: Attachment) => a.mime === 'application/pdf' && a.size <= 25_000_000;
const isText = (a: Attachment) => TEXT_EXT.test(extname(a.name)) && a.size <= 200_000;
const fileNote = (a: Attachment) => `Arquivo anexado "${a.name}" salvo em ${a.path} (${Math.round(a.size / 1024)} KB).`;
const textBlock = (a: Attachment) => `Arquivo anexado "${a.name}":\n\`\`\`\n${readFileSync(a.path, 'utf8')}\n\`\`\``;
// Claude: imagem e PDF vão como blocos nativos; texto vai inline; o resto, caminho no disco
function claudeContent(prompt: string, files: Attachment[] = []) {
  if (!files.length) return prompt;
  const blocks: any[] = [{ type: 'text', text: prompt || '(veja os anexos)' }];
  for (const a of files) {
    if (isImage(a)) blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mime.replace('jpg', 'jpeg'), data: readFileSync(a.path).toString('base64') } });
    else if (isPdf(a)) blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: readFileSync(a.path).toString('base64') }, title: a.name });
    else blocks.push({ type: 'text', text: isText(a) ? textBlock(a) : fileNote(a) });
  }
  return blocks;
}
// Codex: imagem como localImage; texto inline; o resto (PDF incluso), caminho no disco
function codexInput(prompt: string, files: Attachment[] = []) {
  const extra = files.filter(a => !isImage(a)).map(a => (isText(a) ? textBlock(a) : fileNote(a)));
  const text = [prompt || '(veja os anexos)', ...extra].join('\n\n');
  return [{ type: 'text', text, text_elements: [] }, ...files.filter(isImage).map(a => ({ type: 'localImage', path: a.path }))];
}

// ---------------- Claude ----------------
// Um processo vivo por (bot, conversa) em modo streaming: evita ~3s de spawn por turno. O turno acaba no
// stop_reason=end_turn do stream (o 'result' só chega depois do resumo pós-turno, ~2-3s depois, e é descartado).
type Live = { cfg: string; push: (m: any) => void; close: () => void; q: any; it: AsyncIterator<any>; skip: number; last: number; busy: number };
const lives = new Map<string, Live>();
// fecha só processo PARADO há 3 min (~285 MB cada; reabrir custa ~3-4 s e retoma a sessão). Turno em andamento nunca:
// antes, trabalho com mais de 3 min era morto no meio ("processo do Claude encerrou").
setInterval(() => { for (const [k, l] of lives) if (!l.busy && Date.now() - l.last > 3 * 60_000) { l.close(); lives.delete(k); } }, 30_000).unref();
export const closeClaude = () => { for (const l of lives.values()) l.close(); lives.clear(); };
export const closeLive = (key: string) => { lives.get(key)?.close(); lives.delete(key); }; // subagente terminou

function openLive(o: RunOpts, cfg: string): Live {
  const builtins = [...new Set(o.tools.flatMap(t => BUILTIN[t] ?? []))];
  const buf: any[] = []; let wake = () => {}; let closed = false;
  const input = { async *[Symbol.asyncIterator]() { for (;;) { while (!buf.length && !closed) await new Promise<void>(r => (wake = r)); if (!buf.length) return; yield buf.shift(); } } };
  const q = query({
    prompt: input as any,
    options: {
      cwd: o.cwd, model: o.model, effort: o.effort as any, resume: o.sid,
      systemPrompt: o.system, settingSources: ['project'], // só o CLAUDE.md do bot
      tools: builtins, allowedTools: [...builtins, ...o.mcp.map(m => `mcp__${m.name}`)], permissionMode: 'dontAsk',
      mcpServers: Object.fromEntries(o.mcp.map(m => [m.name, { type: 'http', url: m.url, headers: m.headers, timeout: 900_000, alwaysLoad: true }])) as any,
      strictMcpConfig: true, includePartialMessages: true,
    },
  });
  return { cfg, q, it: q[Symbol.asyncIterator](), skip: 0, last: Date.now(), busy: 0, push: m => { buf.push(m); wake(); }, close: () => { closed = true; wake(); q.close?.(); } };
}

// Processo do Claude morreu (suspensão do PC, atualização do CLI, falta de memória…): reabre retomando a sessão, uma vez.
// Antes de responder qualquer coisa: reenvia a mesma mensagem. No meio do trabalho: pede para continuar de onde parou.
export const RESUME = 'O processo foi reiniciado no meio do seu trabalho. Continue exatamente de onde parou (o que já fez está no histórico), sem repetir passos já concluídos, e termine a tarefa.';
export async function* runClaude(o: RunOpts): AsyncGenerator<Ev> {
  let got = false, sid = o.sid;
  try { for await (const ev of claudeTurn(o)) { got = true; if (ev.k === 'session') sid = ev.sid; yield ev; } }
  catch (e: any) {
    if (o.signal.aborted || !/processo do Claude encerrou|exited with code|ECONNRESET|EPIPE/i.test(String(e?.message ?? e))) throw e;
    lives.get(o.key)?.close(); lives.delete(o.key);
    yield* claudeTurn(got ? { ...o, sid, prompt: RESUME, attachments: undefined } : { ...o, sid });
  }
}

async function* claudeTurn(o: RunOpts): AsyncGenerator<Ev> {
  const cfg = JSON.stringify([o.model, o.effort, o.system, o.tools, o.mcp, o.cwd]);
  let l = lives.get(o.key);
  if (l && l.cfg !== cfg) { l.close(); lives.delete(o.key); l = undefined; }
  if (!l) { l = openLive(o, cfg); lives.set(o.key, l); }
  const live = l;
  live.last = Date.now(); live.busy++;
  live.push({ type: 'user', message: { role: 'user', content: claudeContent(o.prompt, o.attachments) }, parent_tool_use_id: null, session_id: '' });
  const onAbort = () => live.q.interrupt?.().catch(() => {});
  o.signal.addEventListener('abort', onAbort, { once: true });
  let final = '', acc = '';
  try {
    for (;;) {
      const { value: m, done } = await live.it.next();
      live.last = Date.now();
      if (done) { lives.delete(o.key); throw new Error('processo do Claude encerrou'); }
      if (m.type === 'result' && live.skip) { live.skip--; continue; }
      if (m.type === 'system' && m.subtype === 'init') yield { k: 'session', sid: m.session_id };
      else if (m.type === 'stream_event') {
        const e = m.event;
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta' && !m.parent_tool_use_id) { acc += e.delta.text; yield { k: 'delta', text: e.delta.text }; }
        else if (e?.type === 'message_delta' && e.delta?.stop_reason === 'end_turn' && !m.parent_tool_use_id) { live.skip++; break; }
      }
      else if (m.type === 'assistant' && !m.parent_tool_use_id) for (const c of m.message?.content ?? []) { if (c.type === 'tool_use') { acc = ''; final = ''; yield { k: 'tool', name: c.name.replace(/^mcp__\w+?__/, ''), input: c.input }; } else if (c.type === 'text') final = c.text; }
      else if (m.type === 'result') {
        if (o.signal.aborted) throw new Error('interrompido');
        if (m.subtype !== 'success' || m.is_error) throw new Error(m.result || m.errors?.join('; ') || m.subtype);
        final = m.result ?? final; break;
      }
    }
  } catch (e) { if (lives.get(o.key) === live && o.signal.aborted) { live.close(); lives.delete(o.key); } throw e; }
  finally { o.signal.removeEventListener('abort', onAbort); live.last = Date.now(); live.busy--; }
  yield { k: 'final', text: final || acc }; // texto pode não ter chegado como bloco completo antes do end_turn
}

// Chamada única sem ferramentas (consolidação de memória, rascunho de bot).
export async function ask(prompt: string, model = 'haiku', system = 'Responda só com JSON válido, sem markdown.'): Promise<string> {
  let out = '';
  for await (const m of query({ prompt, options: { model, tools: [], systemPrompt: system, settingSources: [], persistSession: false, maxTurns: 1, strictMcpConfig: true } }) as AsyncIterable<any>)
    if (m.type === 'result') out = m.result ?? '';
  return out;
}

// ---------------- Codex ----------------
// Binário nativo do @openai/codex do projeto (versão fixa no package.json, compatível com o protocolo); login = ~/.codex do usuário.
function codexBin() {
  if (process.env.GUBOTS_CODEX) return process.env.GUBOTS_CODEX;
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const plat = process.platform === 'win32' ? ['win32', 'pc-windows-msvc', 'codex.exe'] : process.platform === 'darwin' ? ['darwin', 'apple-darwin', 'codex'] : ['linux', 'unknown-linux-musl', 'codex'];
  const p = join(import.meta.dirname, '..', 'node_modules', '@openai', `codex-${plat[0]}-${process.arch}`, 'vendor', `${arch}-${plat[1]}`, 'bin', plat[2]);
  return existsSync(p) ? p : 'codex';
}

let codex: { p: ChildProcess; rpc: (method: string, params: any) => Promise<any>; subs: Map<string, (n: any) => void> } | undefined;

function startCodex() {
  const p = spawn(codexBin(), ['app-server'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pend = new Map<number, [(v: any) => void, (e: any) => void]>();
  const subs = new Map<string, (n: any) => void>();
  let id = 0;
  readline.createInterface({ input: p.stdout! }).on('line', line => {
    let m: any; try { m = JSON.parse(line); } catch { return; }
    if (m.id != null && pend.has(m.id)) { const [ok, ko] = pend.get(m.id)!; pend.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); }
    else if (m.id != null && m.method) p.stdin!.write(JSON.stringify({ id: m.id, result: { decision: 'decline' } }) + '\n'); // pedidos de aprovação: approvalPolicy=never, não deveriam vir
    else if (m.method) { const tid = m.params?.threadId ?? m.params?.thread?.id; if (tid) subs.get(tid)?.(m); }
  });
  p.stderr!.on('data', () => {});
  const rpc = (method: string, params: any) => new Promise<any>((ok, ko) => {
    const i = ++id; pend.set(i, [ok, ko]);
    p.stdin!.write(JSON.stringify({ id: i, method, params }) + '\n');
    setTimeout(() => pend.has(i) && (pend.delete(i), ko(new Error(`codex ${method}: timeout`))), 30_000).unref();
  });
  p.on('exit', () => {
    codex = undefined; loaded.clear(); for (const [, ko] of pend.values()) ko(new Error('codex app-server saiu'));
    for (const f of subs.values()) f({ method: 'error', params: { error: { message: 'codex app-server saiu' }, willRetry: false } }); // turno em andamento não fica esperando para sempre
  });
  return { p, rpc, subs };
}
let codexReady: Promise<NonNullable<typeof codex>> | undefined;
function getCodex() {
  if (codex && codexReady) return codexReady;
  codex = startCodex();
  const c = codex;
  codexReady = c.rpc('initialize', { clientInfo: { name: 'gubots', title: 'Gubots', version: '0.1.0' }, capabilities: null })
    .then(() => { c.p.stdin!.write('{"method":"initialized"}\n'); return c; });
  codexReady.catch(() => { codexReady = undefined; c.p.kill(); });
  return codexReady;
}
export const stopCodex = () => codex?.p.kill();
const loaded = new Set<string>(); // threads já carregadas neste app-server

// MCPs e plugins do ~/.codex/config.toml do usuário ficam desligados nos bots (ferramentas enxutas).
function userCodexExtras(): Record<string, boolean> {
  let toml = ''; try { toml = readFileSync(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'), 'utf8'); } catch {}
  const off: Record<string, boolean> = {};
  for (const [, name] of toml.matchAll(/^\[mcp_servers\.("[^"]+"|[\w-]+)\]/gm)) off[`mcp_servers.${name}.enabled`] = false;
  for (const [, name] of toml.matchAll(/^\[plugins\.("[^"]+")\]/gm)) off[`plugins.${name}.enabled`] = false;
  return off;
}

// Recursos do app do Codex que não existem no Gubots (navegador/computador próprios, plugins, modo código):
// ligados, o modelo tenta usá-los, falham, e ele conclui que "não tem navegador". Também tira o adiamento das
// ferramentas MCP atrás de busca, para o navegador, a equipe e a memória do Gubots aparecerem direto.
const CODEX_OFF = Object.fromEntries(['apps', 'plugins', 'remote_plugin', 'tool_suggest', 'in_app_browser', 'browser_use', 'browser_use_full_cdp_access', 'browser_use_external',
  'computer_use', 'code_mode_host', 'tool_search_always_defer_mcp_tools', 'in_app_local_automation', 'multi_agent'].map(f => [`features.${f}`, false]));

// Codex: turno ativo por bot+conversa, para o complemento do usuário entrar no meio (turn/steer)
const turns = new Map<string, { tid: string; turnId: string }>();
export async function steerCodex(key: string, text: string, attachments?: Attachment[]) {
  const t = turns.get(key);
  if (!t?.turnId || !codex) return false;
  try { await codex.rpc('turn/steer', { threadId: t.tid, expectedTurnId: t.turnId, input: codexInput(text, attachments) }); return true; } catch { return false; }
}

// app-server caiu no meio do turno: sobe de novo, retoma a thread e pede para continuar de onde parou (uma vez)
export async function* runCodex(o: RunOpts): AsyncGenerator<Ev> {
  let got = false, sid = o.sid;
  try { for await (const ev of codexTurn(o)) { got = true; if (ev.k === 'session') sid = ev.sid; yield ev; } }
  catch (e: any) {
    if (o.signal.aborted || !/app-server saiu/i.test(String(e?.message ?? e))) throw e;
    yield* codexTurn(got ? { ...o, sid, prompt: RESUME, attachments: undefined } : { ...o, sid });
  }
}

async function* codexTurn(o: RunOpts): AsyncGenerator<Ev> {
  const c = await getCodex();
  const config: Record<string, any> = { ...userCodexExtras(), ...CODEX_OFF, web_search: o.tools.includes('web') ? 'live' : 'disabled' };
  for (const m of o.mcp) config[`mcp_servers.${m.name}`] = { url: m.url, http_headers: m.headers ?? {}, tool_timeout_sec: 900, startup_timeout_sec: 20, default_tools_approval_mode: 'approve' };
  const threadCfg = {
    model: o.model, cwd: o.cwd, approvalPolicy: 'never', developerInstructions: o.system, config,
    sandbox: o.tools.includes('shell') || o.tools.includes('files') || o.tools.includes('design') ? 'workspace-write' : 'read-only',
  };
  let tid = o.sid;
  if (tid && !loaded.has(tid)) await c.rpc('thread/resume', { threadId: tid, ...threadCfg }).then(() => loaded.add(tid!), () => (tid = undefined));
  if (!tid) { tid = (await c.rpc('thread/start', threadCfg)).thread.id as string; loaded.add(tid); yield { k: 'session', sid: tid }; }

  const q: any[] = []; let wake = () => {};
  c.subs.set(tid, n => { q.push(n); wake(); });
  const onAbort = () => c.rpc('turn/interrupt', { threadId: tid, turnId }).catch(() => {});
  let turnId = '';
  try {
    turnId = (await c.rpc('turn/start', { threadId: tid, input: codexInput(o.prompt, o.attachments), model: o.model, effort: o.effort })).turn.id;
    turns.set(o.key, { tid, turnId });
    o.signal.addEventListener('abort', onAbort, { once: true });
    let final = '';
    for (;;) {
      while (!q.length) await new Promise<void>(r => (wake = r));
      const n = q.shift(); const p = n.params;
      if (n.method === 'item/agentMessage/delta') yield { k: 'delta', text: p.delta ?? '' };
      else if (n.method === 'item/started' && p.item?.type === 'mcpToolCall') yield { k: 'tool', name: p.item.tool, input: p.item.arguments };
      else if (n.method === 'item/started' && p.item?.type === 'commandExecution') yield { k: 'tool', name: 'shell', input: p.item.command };
      else if (n.method === 'item/started' && p.item?.type === 'webSearch') yield { k: 'tool', name: 'web_search', input: p.item.query };
      else if (n.method === 'item/completed' && p.item?.type === 'agentMessage') final = p.item.text;
      else if (n.method === 'error' && !p.willRetry) throw new Error(errText(p.error));
      else if (n.method === 'turn/completed') {
        if (p.turn.status === 'failed') throw new Error(errText(p.turn.error));
        if (p.turn.status === 'interrupted') throw new Error('interrompido');
        break;
      }
    }
    yield { k: 'final', text: final };
  } finally { c.subs.delete(tid); o.signal.removeEventListener('abort', onAbort); if (turns.get(o.key)?.turnId === turnId) turns.delete(o.key); }
}
const errText = (e: any) => { const m = e?.message ?? String(e); try { return JSON.parse(m).error?.message ?? m; } catch { return m; } };

// ---------------- modelos (lidos das contas, nunca fixos) ----------------
type Model = { id: string; name: string; efforts: string[]; isDefault?: boolean };
let cache: { at: number; v: Promise<{ claude: Model[]; codex: Model[]; errors: Record<string, string> }> } | undefined;
export function models(force = false) {
  if (!cache || force || Date.now() - cache.at > 10 * 60_000) cache = { at: Date.now(), v: loadModels() };
  return cache.v;
}
async function loadModels() {
  const errors: Record<string, string> = {};
  const claude = (async () => {
    const q = query({ prompt: (async function* () { await new Promise(r => setTimeout(r, 30_000).unref()); })() as any, options: { tools: [], persistSession: false, settingSources: [], strictMcpConfig: true } });
    try {
      return (await q.supportedModels()).filter(m => m.value !== 'default')
        .map(m => ({ id: m.value, name: m.displayName, efforts: m.supportedEffortLevels ?? [] }));
    } finally { q.close?.(); }
  })().catch(e => { errors.claude = String(e.message ?? e); return []; });
  const cdx = getCodex().then(c => c.rpc('model/list', {}))
    .then(r => r.data.filter((m: any) => !m.hidden).map((m: any) => ({ id: m.id, name: m.displayName, isDefault: m.isDefault, efforts: m.supportedReasoningEfforts.map((e: any) => e.reasoningEffort ?? e) })))
    .catch(e => { errors.codex = String(e.message ?? e); return []; });
  return { claude: await claude, codex: await cdx, errors };
}
