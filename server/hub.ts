// Orquestração: bots, fila por bot, execução nos motores, delegação real entre bots.
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { DATA, addMsg, bots, convs, db, emit, messages, sessions, tasks, type Bot, type Conv, type Task } from './db.ts';
import { closeLive, runClaude, runCodex, steerCodex, type Attachment, type Mcp } from './engines.ts';
import { consolidate, learnFromChat, memoryContext } from './memory.ts';
import { composioKey, settings } from './settings.ts';
import { isConnect } from './composio.ts';
import { notify, plain } from './push.ts';

export const PORT = Number(process.env.PORT || 8787);
const tokenFile = join(DATA, 'token.txt');
if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(18).toString('base64url'));
export const TOKEN = readFileSync(tokenFile, 'utf8').trim();

const MAX_DEPTH = 3;
const TASK_TIMEOUT = 14 * 60_000; // cabe no timeout de 15 min das chamadas MCP
export const TOOLS = ['browser', 'files', 'shell', 'web', 'design'];
export const AVATARS = ['jarvis', 'atlas', 'lira', 'nova', 'orion', 'vega', 'terra', 'sol', 'flor', 'hexa', 'cubo', 'estrela', 'fantasma', 'capsula', 'coracao'];

export const botDir = (id: string) => join(DATA, 'bots', id);
export const workDir = (b: Bot) => (b.workdir && existsSync(b.workdir) ? b.workdir : botDir(b.id));
// Design: liga data/skills (anthropics/skills) na pasta do bot — Codex lê .agents/skills, Claude lê .claude/skills.
// Desligado: tira só a ligação (nunca apaga data/skills).
export const SKILLS_DIR = join(DATA, 'skills');
export function linkSkills(b: Bot) {
  const dir = workDir(b), on = b.tools.includes('design') && existsSync(SKILLS_DIR) && dir === botDir(b.id);
  for (const l of [join(dir, '.agents', 'skills'), join(dir, '.claude', 'skills')]) {
    let link = false; try { link = lstatSync(l).isSymbolicLink(); } catch { /* não existe */ }
    if (on && !link && !existsSync(l)) { mkdirSync(dirname(l), { recursive: true }); symlinkSync(SKILLS_DIR, l, 'junction'); }
    if (!on && link) unlinkSync(l);
  }
}
export const UPLOADS = join(DATA, 'uploads');

// ---------------- estado ao vivo ----------------
// label: o que aparece em "Na fila" no chat enquanto espera o trabalho anterior da mesma conversa
// prep: monta o prompt na hora de rodar (null = pula); quiet: sem push nem aprendizado (missão cuida disso)
// hideEmpty: resultado vazio/"."/"sem novidades" não vai ao chat (agendas); onShow roda logo antes de postar a resposta
export type Ctx = { taskId?: number; depth: number; chain: string[]; files?: Attachment[]; label?: string; prep?: () => string | null; quiet?: boolean; hideEmpty?: boolean; onShow?: () => void };
// "nada a reportar": vazio, só pontuação/espaço ou "sem novidades"
export const isEmptyResult = (t: string) => /^[\s.\-–—…·_*~!?]*$/.test(t ?? '') || /^\s*sem novidades?[\s.!]*$/i.test(t ?? '');
type Run = { botId: string; convId: string; taskId?: number; depth: number; chain: string[]; ac: AbortController };
// uma fila por bot+conversa: cada conversa roda em paralelo, sem esperar o trabalho do bot nas outras
export const runKey = (botId: string, convId: string) => `${botId}:${convId}`;
export const active = new Map<string, Run>(); // chave: runKey
const waiting = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();
// pedidos esperando na fila de cada bot+conversa (cancelar = pula quando chegar a vez)
type Pending = { id: number; botId: string; convId: string; text: string; canceled?: boolean };
const pending = new Map<string, Pending[]>();
let pid = 0;
export const runsOf = (botId: string) => [...active.values()].filter(r => r.botId === botId);
export const isBusy = (botId: string) => runsOf(botId).length > 0;
const status = (id: string) => (isBusy(id) ? 'working' : waiting.get(id) ? 'queued' : 'idle');

export const publicBot = (b: Bot) => {
  const { composioSession, ...rest } = b;
  return { ...rest, mcp: b.mcp.map(m => ({ name: m.name, url: m.url })), status: status(b.id), busyIn: [...new Set(runsOf(b.id).map(r => r.convId))],
    queue: [...pending.values()].flat().filter(p => p.botId === b.id && !p.canceled).map(({ id, convId, text }) => ({ id, convId, text })) };
};
const pushBot = (id: string) => { const b = bots.get(id); if (b) emit({ t: 'bot', bot: publicBot(b) }); };
const pushTask = (t: Task) => { tasks.put(t); emit({ t: 'task', task: t }); };

// ---------------- ficha / roster ----------------
const caps = (b: Bot) => [
  `${b.engine === 'claude' ? 'Claude Code' : 'Codex'} ${b.model}`,
  b.tools.length ? `ferramentas: ${b.tools.join(', ')}` : '',
  b.logins.length ? `logins: ${b.logins.join(', ')}` : '',
  b.composio.length ? `apps: ${b.composio.join(', ')}` : '',
].filter(Boolean).join(' · ');
export const roster = () => bots.all().map(b => `- ${b.id} (${b.name}${b.isChief ? ', chefe' : ''}): ${b.job} · ${caps(b)}`).join('\n');
export const card = (b: Bot) => ({ id: b.id, name: b.name, job: b.job, engine: b.engine, model: b.model, effort: b.effort, tools: b.tools, logins: b.logins, apps: b.composio, mcp: b.mcp.map(m => m.name), chief: b.isChief, status: status(b.id) });

// Perfil curto = único contexto sempre carregado (CLAUDE.md p/ Claude, AGENTS.md p/ Codex); o chefe leva o roster.
function writeProfiles() {
  const r = roster();
  for (const b of bots.all()) {
    mkdirSync(botDir(b.id), { recursive: true });
    const md = `# ${b.name}\n\n${b.profile || b.job}\n\n${STYLE}\n${b.isChief ? `\n## Equipe (detalhes: get_agent)\n${r}\n` : ''}`;
    writeFileSync(join(botDir(b.id), 'CLAUDE.md'), md);
    writeFileSync(join(botDir(b.id), 'AGENTS.md'), md);
  }
}

// Respostas ricas: blocos que a UI do chat transforma em botões, formulário, aprovação, gráfico e linha do tempo
export const RICH = [
  'Formatos ricos do chat (use quando ajudarem; bloco de código com a linguagem indicada, JSON válido):',
  '- ```opcoes: uma opção curta por linha; viram botões e o toque responde. Use em perguntas de escolha (ex.: Sim / Não).',
  '- ```formulario: {"titulo","enviar","campos":[{"nome","rotulo","tipo":"texto|numero|data|longo|escolha|lista","opcoes":[],"valor","obrigatorio":true}]} para pedir vários dados de uma vez, já com "valor" preenchido com o que você sabe (conversa, anexos). A resposta chega como lista "- Rótulo: valor".',
  '- ```aprovar: {"titulo","itens":{"Para":"…","Assunto":"…"},"texto":"…"} OBRIGATÓRIO antes de ação externa irreversível (enviar e-mail ou mensagem, postar, apagar, pagar): mostre e PARE; só execute depois de "✅ Aprovado".',
  '- ```grafico: {"tipo":"barras|linha","titulo","rotulos":["…"],"series":[{"nome","valores":[1,2]}],"prefixo":"R$ "}.',
  '- ```linha-do-tempo: um evento por linha, "dd/mm/aaaa | texto" (datas futuras viram prazo).',
  '- Avisos: citação começando com [!aviso], [!ok], [!erro] ou [!dica]. Checklist: "- [ ] item" (o usuário marca). Link sozinho numa linha vira cartão de prévia. Tabelas markdown já têm ordenar, filtrar e CSV.',
].join('\n');

// Regra fixa para TODO bot (Claude e Codex; chat e delegação passam pelo system abaixo)
export const STYLE = 'Estilo obrigatório (regra fixa do usuário, vale em toda resposta, inclusive relatórios de trabalho): caveman ULTRA. Frases telegráficas, só o resultado, sem preâmbulo, sem explicar como fez, sem listar testes, commits ou passos em detalhe, sem rodeios nem repetição. Na dúvida, corte.';
// "Seus acessos": gerado do que está marcado na ficha, para o bot nunca dizer que não tem algo que tem.
const APP_NAMES: Record<string, string> = { gmail: 'Gmail', github: 'GitHub', googlecalendar: 'Google Calendar', googletasks: 'Google Tasks', youtube: 'YouTube', agent_mail: 'Agent Mail', reddit: 'Reddit', twitter: 'X/Twitter' };
function access(b: Bot) {
  const l = [
    b.tools.includes('browser') && `- Navegador real (Chrome) com as ferramentas browser_open, browser_snapshot, browser_click, browser_type, browser_get_text, browser_screenshot do servidor gubots.${b.logins.length ? ` Sites com login salvo no seu navegador: ${b.logins.join(', ')} (abra direto; se a página pedir login, avise o usuário para entrar pelo painel do navegador, com Assumir controle).` : ''} Não use navegador interno do motor nem "computer use": use só browser_*.`,
    b.tools.includes('web') && '- Busca na web (pesquisa e leitura de páginas).',
    b.tools.includes('files') && '- Arquivos: ler e escrever na sua pasta.',
    b.tools.includes('shell') && '- Terminal: executar comandos.',
    b.composio.length > 0 && `- Apps conectados via Composio: ${b.composio.map(a => APP_NAMES[a] ?? a).join(', ')}. Use COMPOSIO_SEARCH_TOOLS para achar a ação (ex.: "list my GitHub repos") e COMPOSIO_MULTI_EXECUTE_TOOL para executar.`,
  ].filter(Boolean);
  return l.length ? `Seus acessos (liberados pelo usuário; use-os e nunca diga que não tem um deles sem tentar):\n${l.join('\n')}` : '';
}
export const system = (b: Bot) => [
  `Você é ${b.name}, um bot do Gubots (equipe local de agentes de IA). Seu trabalho: ${b.job}.`,
  'Responda em português do Brasil, só texto.',
  STYLE,
  'Reações: com a ferramenta react você pode reagir com um emoji à mensagem do usuário (ex.: 👍 ao aceitar um pedido, 🎉 ao concluir), sem exagero.',
  RICH,
  b.tools.includes('design') ? `Design e documentos: use as skills (pptx, docx, xlsx, pdf, frontend-design, canvas-design, algorithmic-art, theme-factory, web-artifacts-builder, slack-gif-creator) para slides, mockups, protótipos, animações e peças. Salve em ${botDir(b.id)}\\design\\<projeto>\\ e entregue link de download. HTML (mockup, protótipo, animação): arquivo único, CSS e JS embutidos, sem depender de outros arquivos — o chat mostra a prévia ao vivo. Não há LibreOffice: para PDF de pptx/xlsx/docx use office_to_pdf (Office deste PC). Pacotes node (pptxgenjs, docx, sharp, react) já estão instalados; Python tem python-pptx, python-docx, openpyxl e markitdown.` : '',
  b.tools.includes('browser') ? 'Senhas: nunca peça nem escreva senha no chat e nunca guarde senha com remember. Login: list_secrets e fill_secret; sem credencial salva, request_secret (o usuário digita num cartão seguro, você não vê). 2FA, CAPTCHA, Cloudflare ou passkey que você não passa sozinho depois de tentar: request_takeover (o usuário assume seu navegador e você continua).' : '',
  'Subagentes: para partes independentes e rápidas (pesquisar, resumir, comparar), use spawn_subagent, várias em paralelo; eles não têm navegador nem falam com o usuário.',
  'Memória: use recall antes de supor algo sobre o usuário ou a equipe; use remember só para fatos duráveis (preferências, decisões, prazos, contatos), um fato por chamada.',
  access(b),
  b.tools.includes('browser') ? 'Navegador: browser_open já devolve título e o começo do texto da página; se bastar, responda sem outras chamadas. Use browser_snapshot só para obter refs de clique/digitação.' : '',
  'Equipe: se a tarefa exigir ferramenta, login ou app que você não tem, use delegate_task para o bot que tem; em requires liste o que ela exige (browser, files, shell, web, login:<domínio>, app:<toolkit>).',
  `Arquivos para o usuário baixar: salve dentro de ${botDir(b.id)} e responda com link Markdown [nome](/api/bots/${b.id}/files/<caminho relativo, com %20 no lugar de espaço>); caminho C:\\ não abre no celular.`,
  b.workdir ? `Pasta de trabalho: ${b.workdir}. Seu perfil:\n${b.profile}` : '',
  b.isChief ? 'Você é o chefe: decomponha pedidos, delegue partes independentes em paralelo (várias delegate_task na mesma resposta) e sintetize os resultados. A resposta de cada executor já aparece na conversa para o usuário: não a repita; responda em 1–2 linhas só com a síntese ou o que faltar.' : '',
].filter(Boolean).join('\n');

// ---------------- CRUD de bots ----------------
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bot';
function clean(b: any, old?: Bot): Bot {
  const v: Bot = { ...old, ...b } as Bot;
  if (!v.name?.trim()) throw new Error('nome obrigatório');
  if (v.engine !== 'claude' && v.engine !== 'codex') throw new Error('motor deve ser claude ou codex');
  if (!v.model) throw new Error('modelo obrigatório');
  const [av, col] = String(v.avatar ?? '').split('#'); // "atlas" ou "atlas#a855f7" (cor escolhida)
  v.avatar = AVATARS.includes(av) ? av + (col && /^[0-9a-f]{6}$/i.test(col) ? '#' + col.toLowerCase() : '') : 'orion';
  v.effort = (['low', 'medium', 'high'].includes(v.effort) ? v.effort : 'medium') as Bot['effort'];
  v.tools = [...new Set([...(v.tools ?? []).filter(t => TOOLS.includes(t)), 'web'])]; // busca web: sempre ligada em todo bot
  v.composio = (v.composio ?? []).map(String);
  // a UI não recebe os headers (chaves): ao salvar sem eles, mantém os que o MCP de mesma URL já tinha
  v.mcp = (v.mcp ?? []).filter(m => m?.name && /^https?:\/\//.test(m.url)).map(m => ({ name: slug(m.name).replace(/-/g, '_'), url: m.url, headers: m.headers ?? old?.mcp?.find(o => o.url === m.url)?.headers }));
  v.logins = [...new Set((v.logins ?? []).map(d => String(d).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()).filter(Boolean))];
  v.job = v.job ?? ''; v.profile = v.profile ?? ''; v.isChief = !!v.isChief;
  if (v.workdir && !existsSync(v.workdir)) throw new Error('pasta de trabalho não existe');
  delete (v as any).status;
  return v;
}
export function createBot(b: any): Bot {
  const v = clean(b);
  let id = slug(v.name); for (let i = 2; bots.get(id); i++) id = `${slug(v.name)}-${i}`;
  v.id = id;
  if (v.isChief) for (const o of bots.all()) if (o.isChief) bots.put({ ...o, isChief: false });
  bots.put(v); writeProfiles(); emit({ t: 'bots', bots: bots.all().map(publicBot) });
  return v;
}
export function updateBot(id: string, patch: any): Bot {
  const old = bots.get(id); if (!old) throw new Error('bot não existe');
  const v = clean({ ...patch, id }, old);
  if (v.isChief && !old.isChief) for (const o of bots.all()) if (o.isChief && o.id !== id) bots.put({ ...o, isChief: false });
  // trocou de motor → sessões novas (id de sessão do Claude não serve no Codex e vice-versa).
  // Codex fixa a config na thread carregada → ficha mudou, thread nova. Claude retoma a sessão com a config nova
  // (o processo vivo reabre com resume), então NÃO perde a conversa ao marcar um app ou trocar o modelo.
  const cfgChanged = ['engine', 'model', 'tools', 'mcp', 'composio'].some(k => JSON.stringify((old as any)[k]) !== JSON.stringify((v as any)[k]));
  if (old.engine !== v.engine || (v.engine === 'codex' && cfgChanged)) db.prepare('delete from sessions where bot_id=?').run(id);
  bots.put(v); writeProfiles(); emit({ t: 'bots', bots: bots.all().map(publicBot) });
  return v;
}
// bots antigos sem web: liga e zera as sessões (config do motor é fixada na sessão)
for (const b of bots.all()) if (!b.tools.includes('web')) { bots.put({ ...b, tools: [...b.tools, 'web'] }); db.prepare('delete from sessions where bot_id=?').run(b.id); }
export function deleteBot(id: string) { bots.del(id); writeProfiles(); emit({ t: 'bots', bots: bots.all().map(publicBot) }); }

// ---------------- Composio (MCP por bot, OAuth gerido pelo Composio) ----------------
const COMPOSIO = 'https://backend.composio.dev/api/v3.1';
async function composioMcp(b: Bot): Promise<Mcp | undefined> {
  const key = composioKey();
  if (!key || !b.composio.length) return;
  // chave ck_ (Composio Connect): MCP filtrado pelo Gubots, só com os apps marcados na ficha do bot
  if (isConnect()) return { name: 'composio', url: `http://127.0.0.1:${PORT}/mcp/${encodeURIComponent(b.id)}/composio`, headers: { 'x-gubots-token': TOKEN } };
  const k = [...b.composio].sort().join(',');
  if (b.composioSession?.key !== k) {
    const r = await fetch(`${COMPOSIO}/tool_router/session`, {
      method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: `gubots_${b.id}`, toolkits: { enable: b.composio } }), signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`Composio ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j: any = await r.json();
    b.composioSession = { id: j.session_id, url: j.mcp.url, key: k };
    bots.put(b);
  }
  return { name: 'composio', url: b.composioSession!.url, headers: { 'x-api-key': key } };
}
export async function composioToolkits(q = '') {
  const key = composioKey(); if (!key) throw new Error('chave do Composio não configurada (Configurações → Integrações)');
  const r = await fetch(`${COMPOSIO}/toolkits?limit=50&sort_by=usage${q ? `&search=${encodeURIComponent(q)}` : ''}`, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Composio ${r.status}`);
  return ((await r.json()) as any).items.map((t: any) => ({ slug: t.slug, name: t.name, logo: t.meta?.logo }));
}

// ---------------- execução ----------------
// pedido seu terminou (não as subtarefas entre bots): notificação no celular, como mensagem de WhatsApp
export function pushDone(bot: Bot, convId: string, text: string) {
  if (!settings.notify) return;
  notify({ title: bot.name, body: plain(text) || 'Terminou', convId, tag: convId, icon: `/avatars/${bot.avatar.split('#')[0]}.png` }).catch((e) => console.error('[push]', e.message));
}
const short = (v: any) => { const s = typeof v === 'string' ? v : JSON.stringify(v ?? ''); return s.length > 140 ? s.slice(0, 140) + '…' : s; };

export function runBot(bot: Bot, convId: string, prompt: string, ctx: Ctx = { depth: 0, chain: [] }): Promise<string> {
  waiting.set(bot.id, (waiting.get(bot.id) ?? 0) + 1); pushBot(bot.id);
  const k = runKey(bot.id, convId);
  // só entra em "Na fila" se já tem trabalho rodando ou esperando nesta conversa
  const q: Pending | undefined = active.has(k) || pending.get(k)?.length ? { id: ++pid, botId: bot.id, convId, text: (ctx.label ?? prompt).slice(0, 200) } : undefined;
  if (q) { pending.set(k, [...(pending.get(k) ?? []), q]); pushBot(bot.id); }
  const p = (queues.get(k) ?? Promise.resolve()).then(() => {
    if (q) { pending.set(k, (pending.get(k) ?? []).filter(x => x !== q)); if (q.canceled) { waiting.set(bot.id, (waiting.get(bot.id) ?? 1) - 1); pushBot(bot.id); return ''; } }
    return exec(bot.id, convId, prompt, ctx);
  });
  queues.set(k, p.catch(() => {}));
  return p;
}

// Reserva entre motores: modelo no limite (lotado, cota, 429/529) → o mesmo pedido segue no outro motor,
// com o histórico recente da conversa. Codex → Claude Opus 5.5; Claude → Codex GPT-6.1-Sol (vale para todo bot).
export const FALLBACK = { claude: 'opus', codex: 'gpt-6.1-sol' } as const;
export const motors = { claude: runClaude, codex: runCodex }; // trocável nos testes
export const isLimit = (m: string) => /capacity|rate.?limit|usage.?limit|limit (reached|exceeded)|hit your (usage )?limit|quota|too many requests|\b(429|529|503)\b|overloaded|insufficient_quota|try again later/i.test(m);
const limited = new Map<string, number>(); // "motor:modelo" → até quando pular direto para a reserva
const COOLDOWN = 15 * 60_000;
export const markLimited = (engine: string, model: string, ms = COOLDOWN) => limited.set(`${engine}:${model}`, Date.now() + ms);
const isLimited = (engine: string, model: string) => (limited.get(`${engine}:${model}`) ?? 0) > Date.now();
export const engineLabel = (e: string, m: string) => `${e === 'claude' ? 'Claude' : 'Codex'} ${m === 'opus' ? 'Opus 5.5' : m === 'gpt-6.1-sol' ? 'GPT-6.1-Sol' : m}`;

async function exec(botId: string, convId: string, prompt: string, ctx: Ctx): Promise<string> {
  waiting.set(botId, (waiting.get(botId) ?? 1) - 1);
  const bot = bots.get(botId); if (!bot) throw new Error('bot removido');
  if (ctx.prep) { const p = ctx.prep(); if (p == null) { pushBot(botId); return ''; } prompt = p; }
  try { linkSkills(bot); } catch (e: any) { console.error('[skills]', e.message); }
  const ac = new AbortController();
  const timer = ctx.taskId ? setTimeout(() => ac.abort(new Error('timeout da tarefa (5 min)')), TASK_TIMEOUT) : undefined;
  const k = runKey(botId, convId);
  active.set(k, { botId, convId, taskId: ctx.taskId, depth: ctx.depth, chain: ctx.chain, ac }); pushBot(botId);
  if (ctx.taskId) { const t = tasks.get(ctx.taskId)!; pushTask({ ...t, status: 'running', startedAt: Date.now() }); }
  try {
    const mcp: Mcp[] = [{ name: 'gubots', url: `http://127.0.0.1:${PORT}/mcp/${botId}?conv=${encodeURIComponent(convId)}`, headers: { 'x-gubots-token': TOKEN } }];
    const cmp = await composioMcp(bot).catch(e => { emit({ t: 'activity', botId, item: { ts: Date.now(), kind: 'error', text: e.message, convId } }); return undefined; });
    if (cmp) mcp.push(cmp);
    mcp.push(...bot.mcp);
    // sessão da reserva fica separada (bot#motor): não mistura com a sessão do motor principal
    const drive = async (engine: string, model: string, sk: string, key: string) => {
      const run = engine === 'claude' ? motors.claude : motors.codex;
      const sid = sessions.get(sk, convId);
      let out = '';
      for await (const ev of run({ key, attachments: ctx.files, model, effort: bot.effort, cwd: workDir(bot), system: system(bot), prompt: memoryContext(prompt) + (sid ? '' : recap(convId, prompt, ctx)) + prompt, sid, tools: bot.tools, mcp, signal: ac.signal })) {
        if (ac.signal.aborted) throw ac.signal.reason ?? new Error('interrompido');
        if (ev.k === 'session') sessions.set(sk, convId, ev.sid);
        else if (ev.k === 'delta') emit({ t: 'delta', convId, botId, text: ev.text });
        else if (ev.k === 'tool') emit({ t: 'activity', botId, item: { ts: Date.now(), kind: 'tool', text: `${ev.name} ${short(ev.input)}`, convId } });
        else out = ev.text;
      }
      return out;
    };
    const fbEngine = bot.engine === 'claude' ? 'codex' : 'claude', fbModel = FALLBACK[fbEngine];
    const useFallback = async (why: string) => {
      emit({ t: 'activity', botId, item: { ts: Date.now(), kind: 'info', text: `${engineLabel(bot.engine, bot.model)} no limite (${why.slice(0, 80)}) → seguindo com ${engineLabel(fbEngine, fbModel)}`, convId } });
      return drive(fbEngine, fbModel, `${botId}#${fbEngine}`, `${botId}:${convId}:${fbEngine}`);
    };
    let text = '', fb = '';
    if (isLimited(bot.engine, bot.model)) { fb = 'limite recente'; text = await useFallback(fb); }
    else {
      try { text = await drive(bot.engine, bot.model, botId, `${botId}:${convId}`); }
      catch (e: any) {
        const msg = String(e?.message ?? e);
        if (ac.signal.aborted || !isLimit(msg)) throw e;
        markLimited(bot.engine, bot.model);
        fb = msg; text = await useFallback(msg);
      }
    }
    const used = fb ? { engine: fbEngine, model: fbModel, fallback: true } : { engine: bot.engine, model: bot.model };
    if (ctx.hideEmpty && isEmptyResult(text)) return ''; // agenda sem novidades: silêncio no chat
    ctx.onShow?.();
    addMsg({ convId, role: 'bot', botId, text: text || '(sem resposta)', taskId: ctx.taskId, meta: used });
    if (!ctx.taskId && !ctx.quiet) pushDone(bot, convId, text || '(sem resposta)');
    if (!ctx.taskId && !ctx.quiet) learnFromChat(botId, convId, prompt, text).catch((e) => console.error('[memória]', e.message));
    return text;
  } catch (e: any) {
    if (ac.signal.reason?.steer) return ''; // pausado só para juntar o complemento: o turno seguinte responde
    const err = ac.signal.aborted ? (ac.signal.reason?.message ?? 'interrompido') : (e?.message ?? String(e));
    addMsg({ convId, role: 'system', botId, text: `${bot.name}: ${err}`, taskId: ctx.taskId, meta: { kind: 'error', engine: bot.engine, model: bot.model } });
    if (!ctx.taskId && !ctx.quiet && !/interrompid/i.test(err)) pushDone(bot, convId, `Erro: ${err}`);
    throw new Error(err);
  } finally {
    clearTimeout(timer); active.delete(k); pushBot(botId);
  }
}

// Subagente: ajudante temporário do bot, sessão nova e descartável, sem navegador nem MCP (não delega nem fala com o usuário).
// Mesmo motor e modelo do bot; no limite, usa o modelo reserva do outro motor.
let subN = 0;
export async function subagent(botId: string, convId: string, task: string, timeoutMin = 10) {
  const bot = bots.get(botId); if (!bot) throw new Error('bot não existe');
  const n = ++subN, info = (t: string) => emit({ t: 'activity', botId, item: { ts: Date.now(), kind: 'info', text: t, convId } });
  info(`subagente ${n}: ${task.slice(0, 90)}`);
  const go = async (engine: 'claude' | 'codex', model: string) => {
    const key = `${botId}:sub:${n}:${engine}`;
    let out = '';
    try {
      for await (const ev of motors[engine]({ key, model, effort: bot.effort, cwd: workDir(bot), tools: bot.tools.filter(t => t !== 'browser'), mcp: [], signal: AbortSignal.timeout(timeoutMin * 60_000),
        system: `Você é um subagente temporário de ${bot.name} (Gubots). Faça só a tarefa abaixo e responda apenas com o resultado, curto e estruturado, em português. Não faça perguntas: se faltar algo, diga o que faltou.`,
        prompt: task })) if (ev.k === 'final') out = ev.text;
    } finally { if (engine === 'claude') closeLive(key); }
    return out;
  };
  try { return await go(bot.engine, bot.model); }
  catch (e: any) {
    if (!isLimit(String(e?.message ?? e))) throw e;
    const fe = bot.engine === 'claude' ? 'codex' : 'claude';
    return await go(fe, FALLBACK[fe]);
  } finally { info(`subagente ${n} terminou`); }
}

// Sessão nova numa conversa que já tem histórico (troca de motor, ficha do Codex mudou, sessão perdida):
// o bot recebe as mensagens recentes em texto para não "esquecer" o que acabou de ser dito.
// Tarefas delegadas e missões montam o próprio contexto.
export function recap(convId: string, prompt: string, ctx: Pick<Ctx, 'taskId' | 'prep'> = {}) {
  if (ctx.taskId || ctx.prep) return '';
  const ms = messages(convId, 30).filter(m => !m.taskId && (m.role === 'user' || m.role === 'bot'));
  if (ms.at(-1)?.role === 'user' && ms.at(-1)!.text === prompt) ms.pop(); // a mensagem atual já vai no prompt
  const out: string[] = []; let total = 0;
  for (const m of [...ms].reverse()) {
    const l = `${m.role === 'user' ? settings.userName || 'Usuário' : bots.get(m.botId!)?.name ?? 'bot'}: ${m.text.length > 1500 ? m.text.slice(0, 1500) + '…' : m.text}`;
    if (total + l.length > 12_000) break;
    out.unshift(l); total += l.length;
  }
  return out.length ? `[Histórico recente desta conversa (a sessão foi reiniciada; continue a partir dele)]\n${out.join('\n')}\n[Fim do histórico]\n\n` : '';
}

// Anexo = arquivo já enviado para data/uploads/<conversa>/ (só o nome do arquivo vem do cliente)
export function attachment(convId: string, file: string): Attachment {
  const name = basename(file); const path = join(UPLOADS, convId, name);
  if (name !== file || !existsSync(path)) throw new Error(`anexo não encontrado: ${file}`);
  return { name: name.replace(/^\d+-/, ''), path, mime: mimeOf(name), size: statSync(path).size, url: `/api/convs/${convId}/files/${encodeURIComponent(name)}` };
}
export const mimeOf = (n: string) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json' } as Record<string, string>)[extname(n).toLowerCase()] ?? 'application/octet-stream';

// Mensagem do usuário vai ao bot da conversa
export function send(convId: string, text: string, files: string[] = []) {
  const conv = convs.get(convId); if (!conv) throw new Error('conversa não existe');
  const atts = files.slice(0, 10).map(f => attachment(convId, f));
  if (!text && !atts.length) throw new Error('mensagem vazia');
  addMsg({ convId, role: 'user', text, meta: atts.length ? { attachments: atts.map(({ path, ...a }) => a) } : undefined });
  const ms = membersOf(conv);
  if (!ms.length) throw new Error('conversa sem bots');
  const label = text || atts.map(a => a.name).join(', ');
  const cur = active.get(runKey(ms[0].id, convId));
  // bot já trabalhando no seu pedido: a mensagem nova é complemento do mesmo pedido, não tarefa nova
  if (cur && !cur.taskId && !cur.ac.signal.aborted && !pending.get(runKey(ms[0].id, convId))?.length) { steer(ms[0], convId, cur, text, atts, label); return; }
  runBot(ms[0], convId, text, { depth: 0, chain: [], files: atts, label }).catch(() => {});
}

// Complemento no meio do trabalho. Codex: entra no turno atual (turn/steer), sem parar nada.
// Claude (ou se o steer falhar): pausa o turno e retoma na mesma sessão com o complemento; o que já foi feito fica no histórico.
export const STEER_NOTE = 'Complemento do usuário ao mesmo pedido (chegou enquanto você trabalhava): continue a mesma tarefa levando isto em conta, sem recomeçar do zero nem refazer o que já fez.';
async function steer(bot: Bot, convId: string, cur: Run, text: string, atts: Attachment[], label: string) {
  const note = `${STEER_NOTE}\n${text}`;
  const info = (t: string) => emit({ t: 'activity', botId: bot.id, item: { ts: Date.now(), kind: 'info', text: t, convId } });
  if (bot.engine === 'codex' && await steerCodex(runKey(bot.id, convId), note, atts)) { info('mensagem incluída no trabalho atual'); return; }
  runBot(bot, convId, note, { depth: 0, chain: [], files: atts, label }).catch(() => {});
  cur.ac.abort(Object.assign(new Error('juntando sua mensagem'), { steer: true }));
  info('juntando sua mensagem ao trabalho atual');
}
export function cancelQueued(id: number) {
  const q = [...pending.values()].flat().find(p => p.id === id); if (!q) throw new Error('pedido não está mais na fila');
  q.canceled = true; pushBot(q.botId);
  addMsg({ convId: q.convId, role: 'system', botId: q.botId, text: `Pedido tirado da fila: ${q.text.slice(0, 80)}`, meta: { kind: 'queue' } });
}
export function stop(convId: string) {
  for (const r of active.values()) if (r.convId === convId) r.ac.abort(new Error('parado pelo usuário'));
}

const membersOf = (c: Conv) => c.botIds.map(id => bots.get(id)).filter(Boolean) as Bot[];

// ---------------- delegação ----------------
const findBot = (x: string) => { const k = (x ?? '').toLowerCase().replace(/^@/, ''); return bots.all().find(b => b.id === k || b.name.toLowerCase() === k); };
export function missing(b: Bot, requires: string[]) {
  return requires.filter(r => {
    const [k, v = ''] = r.toLowerCase().split(':').map(s => s.trim());
    if (k === 'login') return !(b.tools.includes('browser') && b.logins.some(d => v === d || v.endsWith('.' + d) || d.endsWith('.' + v)));
    if (k === 'app') return !b.composio.includes(v);
    if (TOOLS.includes(k)) return !b.tools.includes(k);
    return false;
  });
}
const done = new Map<number, Promise<unknown>>();

export async function delegate(fromId: string, convId: string, a: { assignee: string; objective: string; inputs?: string; done_when?: string; requires?: string[]; depends_on?: number[] }) {
  const run = active.get(runKey(fromId, convId)) ?? runsOf(fromId)[0];
  const from = bots.get(fromId)!;
  // missão: tudo à vista no grupo (o orquestrador chama com @), nada de cartão escondido
  if (convs.get(run?.convId ?? convId)?.kind === 'mission' && !run?.taskId)
    return { status: 'refused', reason: 'Na missão não use delegate_task: chame o bot marcando @id na sua resposta, com a instrução do passo. Ele responde no grupo e você revisa em seguida.' };
  const to = findBot(a.assignee);
  if (!to) return { status: 'error', error: `bot "${a.assignee}" não existe. Bots: ${bots.all().map(b => b.id).join(', ')}` };
  const depth = (run?.depth ?? 0) + 1;
  const chain = [...(run?.chain ?? []), fromId];
  const requires = [...new Set(a.requires ?? [])];
  const t = tasks.create({
    parentId: run?.taskId, convId: run?.convId ?? '', requester: fromId, assignee: to.id, objective: a.objective, inputs: a.inputs ?? '',
    doneWhen: a.done_when ?? '', requires, status: 'queued', dependsOn: a.depends_on ?? [], depth, createdAt: Date.now(),
  });
  // guardas: profundidade, ping-pong, ficha
  const miss = missing(to, requires);
  const reason = depth > MAX_DEPTH ? `profundidade máxima (${MAX_DEPTH}) atingida`
    : chain.includes(to.id) ? `${to.name} já está na cadeia desta tarefa (sem ping-pong)`
    : miss.length ? `${to.name} não tem: ${miss.join(', ')}` : '';
  if (reason) {
    const suggest = miss.length ? bots.all().find(b => !chain.includes(b.id) && !missing(b, requires).length)?.id : undefined;
    pushTask({ ...t, status: 'refused', refusal: { reason, suggest }, endedAt: Date.now() });
    if (t.convId) addMsg({ convId: t.convId, role: 'system', botId: fromId, text: `Recusada: ${reason}${suggest ? ` · sugerido ${bots.get(suggest)!.name}` : ''}`, taskId: t.id, meta: { kind: 'refusal' } });
    return { task_id: t.id, status: 'refused', reason, suggest: suggest ?? null };
  }
  emit({ t: 'task', task: t });
  if (t.convId) addMsg({ convId: t.convId, role: 'system', botId: fromId, text: `${from.name} → ${to.name}: ${a.objective}`, taskId: t.id, meta: { kind: 'delegation' } });
  const p = runTask(t, chain); done.set(t.id, p);
  return p;
}

async function runTask(t: Task, chain: string[]) {
  await Promise.all(t.dependsOn.map(id => done.get(id)?.catch(() => {})));
  const to = bots.get(t.assignee)!;
  const prompt = [
    `Tarefa #${t.id} de ${bots.get(t.requester)?.name ?? 'Você'}.`, `Objetivo: ${t.objective}`,
    t.inputs && `Entradas: ${t.inputs}`, t.doneWhen && `Pronto quando: ${t.doneWhen}`,
    ...t.dependsOn.map(id => { const d = tasks.get(id); return d ? `Resultado da tarefa #${id}: ${d.result ?? d.status}` : ''; }),
    'Ao terminar, responda só com o resultado final, curto e estruturado. Se não conseguir, comece com "FALHOU:" e diga o motivo.',
  ].filter(Boolean).join('\n');
  let status = 'done', result = '';
  try { result = await runBot(to, t.convId, prompt, { taskId: t.id, depth: t.depth, chain, label: `Tarefa #${t.id}: ${t.objective}` }); if (/^\s*FALHOU:/i.test(result)) status = 'failed'; }
  catch (e: any) { status = tasks.get(t.id)!.status === 'canceled' ? 'canceled' : 'failed'; result = e.message; }
  const fin = { ...tasks.get(t.id)!, status, result, endedAt: Date.now() };
  pushTask(fin);
  if (status === 'done') consolidate(fin).catch(() => {});
  return { task_id: t.id, status, assignee: to.id, result, note: 'o usuário já viu esta resposta do executor na conversa: não repita' };
}

export function cancelTask(id: number) {
  const t = tasks.get(id); if (!t) throw new Error('tarefa não existe');
  if (['queued', 'running'].includes(t.status)) pushTask({ ...t, status: 'canceled', endedAt: Date.now() });
  for (const r of active.values()) if (r.taskId === id) r.ac.abort(new Error('cancelada pelo usuário'));
}

// Excluir (Precisa de você / histórico): some da lista; em andamento precisa cancelar antes
export function deleteTask(id: number) {
  const t = tasks.get(id); if (!t) throw new Error('tarefa não existe');
  if (['queued', 'running'].includes(t.status)) throw new Error('cancele a tarefa antes de excluir');
  tasks.del(id); emit({ t: 'task-del', id });
}

// "Passar ao X" / "Tentar de novo" (Precisa de você): roda com o executor e retoma o solicitante com o resultado.
export function reassign(id: number, assignee: string) {
  const t = tasks.get(id); const to = findBot(assignee); if (!t || !to) throw new Error('tarefa ou bot inválido');
  const miss = missing(to, t.requires); if (miss.length) throw new Error(`${to.name} não tem: ${miss.join(', ')}`);
  const nt = { ...t, assignee: to.id, status: 'queued', refusal: undefined, result: undefined, endedAt: undefined };
  pushTask(nt);
  addMsg({ convId: t.convId, role: 'system', text: to.id === t.assignee ? `Você pediu para ${to.name} tentar de novo a tarefa #${id}` : `Você passou a tarefa #${id} para ${to.name}`, taskId: id, meta: { kind: 'delegation' } });
  const p = runTask(nt, [t.requester]); done.set(id, p);
  p.then(r => { const req = bots.get(t.requester); if (req) return runBot(req, t.convId, `A tarefa #${id} ("${t.objective}") foi passada pelo usuário para ${to.name}. Resultado (${r.status}): ${r.result}\nContinue o que estava fazendo com isso.`); }).catch(() => {});
}

// perfis no disco sempre com a regra de estilo atual (bots já existentes também)
writeProfiles();
