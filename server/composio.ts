// Composio Connect (chave ck_ da conta "For You"): um MCP só, com todos os apps que o usuário conectou no painel.
// O Gubots fica no meio: cada bot recebe /mcp/<bot>/composio, que repassa as chamadas mas só executa ferramentas
// dos apps marcados na ficha do bot (GMAIL_*, GITHUB_*...). Ferramentas que rodam código arbitrário ficam de fora,
// porque passariam por cima do filtro.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { bots } from './db.ts';
import { composioKey } from './settings.ts';

const URL_ = 'https://connect.composio.dev/mcp';
export const DASHBOARD = 'https://dashboard.composio.dev';
export const isConnect = () => composioKey().startsWith('ck_');
const HIDDEN = new Set(['COMPOSIO_REMOTE_BASH_TOOL', 'COMPOSIO_REMOTE_WORKBENCH', 'COMPOSIO_MANAGE_SKILL', 'COMPOSIO_SEARCH_SKILLS', 'COMPOSIO_USE_SKILL', 'COMPOSIO_SUBMIT_FEEDBACK']);

// cliente único para o Composio; refeito se a chave mudar ou a conexão cair
let up: { key: string; c: Promise<Client> } | undefined;
function upstream() {
  const key = composioKey();
  if (!up || up.key !== key) {
    const c = new Client({ name: 'gubots', version: '0.1.0' });
    const p = c.connect(new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { 'x-consumer-api-key': key } } })).then(() => c);
    p.catch(() => { up = undefined; });
    up = { key, c: p };
  }
  return up.c;
}
async function retrying<T>(f: (c: Client) => Promise<T>): Promise<T> {
  try { return await f(await upstream()); }
  catch { up = undefined; return f(await upstream()); } // sessão do Composio expirou: reconecta uma vez
}

let toolsCache: { at: number; v: Promise<any[]> } | undefined;
const upstreamTools = () => {
  if (!toolsCache || Date.now() - toolsCache.at > 5 * 60_000) {
    toolsCache = { at: Date.now(), v: retrying(c => c.listTools()).then(r => r.tools) };
    toolsCache.v.catch(() => (toolsCache = undefined));
  }
  return toolsCache.v;
};

const NAMES: Record<string, string> = { gmail: 'Gmail', github: 'GitHub', googlecalendar: 'Google Calendar', googletasks: 'Google Tasks', googledrive: 'Google Drive', googlesheets: 'Google Sheets', googledocs: 'Google Docs', youtube: 'YouTube', agent_mail: 'Agent Mail', slack: 'Slack', notion: 'Notion', whatsapp: 'WhatsApp', instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X (Twitter)', outlook: 'Outlook', trello: 'Trello', hubspot: 'HubSpot' };
const nice = (s: string) => NAMES[s] ?? s.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

// Apps conectados na conta: o próprio Composio lista na descrição da busca ("User has manually connected the apps: …")
export async function connectedApps(fresh = false) {
  if (fresh) toolsCache = undefined; // ficha do bot aberta: lê a lista agora, para app recém-conectado aparecer
  const search = (await upstreamTools()).find(t => t.name === 'COMPOSIO_SEARCH_TOOLS');
  const m = /connected the apps:\s*([^\n.]+)/i.exec(search?.description ?? '');
  const slugs = m ? m[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
  return slugs.map(slug => ({ slug, name: nice(slug) }));
}

const appOf = (toolSlug: string, allowed: string[]) => allowed.find(a => toolSlug.toLowerCase().startsWith(a.toLowerCase() + '_'));
// quem da equipe tem o app: vira instrução de delegação no próprio erro
function whoHas(slugs: string[], self: string) {
  const apps = [...new Set(slugs.map(x => x.toLowerCase()))].map(x => bots.all().flatMap(b => b.composio).find(a => x.startsWith(a + '_')) ?? x.split('_')[0]);
  const tips = apps.map(app => {
    const b = bots.all().find(b => b.id !== self && b.composio.includes(app));
    return b ? `${b.name} tem ${nice(app)}: use delegate_task com assignee "${b.id}" e requires ["app:${app}"] para essa parte.` : `Nenhum bot tem ${nice(app)} liberado; avise o usuário que ele pode marcar na ficha de um bot.`;
  });
  return [...new Set(tips)].join(' ');
}
const deny = (text: string) => ({ content: [{ type: 'text', text }], isError: true });

// e-mail enviado pelo próprio servidor (tarefas agendadas): Gmail conectado na conta Composio Connect
export async function sendMail(to: string, subject: string, body: string) {
  if (!isConnect()) throw new Error('e-mail precisa do Composio Connect (chave ck_) com Gmail conectado');
  const r: any = await retrying(c => c.callTool({ name: 'COMPOSIO_MULTI_EXECUTE_TOOL', arguments: {
    tools: [{ tool_slug: 'GMAIL_SEND_EMAIL', arguments: { recipient_email: to, subject, body } }], sync_response_to_workbench: false, thought: 'enviar resultado da tarefa agendada',
  } }, undefined, { timeout: 120_000 }));
  const txt = (r?.content ?? []).map((x: any) => x?.text ?? '').join(' ');
  if (r?.isError || /"successful"\s*:\s*false|"error"\s*:\s*"[^"]/.test(txt)) throw new Error(txt.slice(0, 200) || 'Gmail recusou');
}

export async function handleComposio(botId: string, req: IncomingMessage, res: ServerResponse, body: any) {
  const bot = bots.get(botId);
  if (!bot || !isConnect()) { res.writeHead(404).end(); return; }
  const allowed = bot.composio;
  const list = allowed.map(nice).join(', ') || 'nenhum';
  const s = new Server({ name: 'composio', version: '0.1.0' }, { capabilities: { tools: {} } });

  s.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await upstreamTools()).filter(t => !HIDDEN.has(t.name)).map(t => ({
      ...t,
      description: `[Gubots] Este bot só pode usar estes apps do Composio: ${list}. Qualquer outro é bloqueado.\n\n${t.description ?? ''}`,
    })),
  }));

  s.setRequestHandler(CallToolRequestSchema, async r => {
    const { name, arguments: a = {} } = r.params as any;
    if (HIDDEN.has(name)) return deny(`${name} não está disponível no Gubots.`);
    if (name === 'COMPOSIO_MULTI_EXECUTE_TOOL') {
      const bad = (a.tools ?? []).map((t: any) => String(t?.tool_slug ?? '')).filter((x: string) => !appOf(x, allowed));
      if (bad.length) return deny(`Bloqueado pelo Gubots: ${bad.join(', ')} não pertence aos apps liberados para ${bot.name} (${list}). ${whoHas(bad, botId)}`);
    }
    if (name === 'COMPOSIO_MANAGE_CONNECTIONS') {
      const items = (a.toolkits ?? []) as any[];
      const bad = items.filter(t => !allowed.includes(String(t?.name ?? '').toLowerCase())).map(t => t?.name);
      if (bad.length) return deny(`Bloqueado pelo Gubots: ${bad.join(', ')} não está liberado para ${bot.name} (${list}).`);
      if (items.some(t => t?.action === 'remove' || t?.action === 'rename')) return deny('Remover ou renomear contas é feito pelo usuário no painel do Composio.');
    }
    return retrying(c => c.callTool({ name, arguments: a }, undefined, { timeout: 600_000 })) as any;
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); s.close(); });
  await s.connect(transport);
  await transport.handleRequest(req, res, body);
}
