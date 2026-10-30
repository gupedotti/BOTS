// MCP HTTP próprio (stateless), um endpoint por bot: /mcp/<botId>?conv=<conversa>. Serve Claude e Codex igualmente.
// Ferramentas: navegador (se o bot tem 'browser'), equipe (delegação) e memória.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { active, card, delegate, pushDone, roster, runKey, runsOf, subagent, workDir } from './hub.ts';
import { toPdf } from './office.ts';
import { copyFileSync } from 'node:fs';
import { ask, hasSecret, siteMatch, siteOf, vault } from './vault.ts';
import { bots, bus, facts, react } from './db.ts';
import { resolve, join, isAbsolute } from 'node:path';
const ROOT = resolve(join(import.meta.dirname, '..'));
import * as br from './browser.ts';
import { graphQuery, recall } from './memory.ts';
import { createSchedule, deleteSchedule, schedules, spText, updateSchedule, type Schedule } from './schedule.ts';

const txt = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const safe = (f: (a: any) => Promise<any>) => async (a: any) => {
  try { const r = await f(a); return typeof r === 'string' ? txt(r) : r; }
  catch (e: any) { return { ...txt(`erro: ${String(e?.message ?? e).split('\n')[0].slice(0, 300)}`), isError: true }; }
};
const target = { ref: z.string().optional().describe('ref do browser_snapshot, ex: e12'), selector: z.string().optional().describe('seletor CSS'), text: z.string().optional().describe('texto visível do elemento') };

function build(botId: string, convId: string) {
  const s = new McpServer({ name: 'gubots', version: '0.1.0' });
  const bot = bots.get(botId)!;

  if (bot.tools.includes('browser')) {
    s.registerTool('browser_open', { description: 'Abre uma URL (ou "back") no navegador do bot. Espera só domcontentloaded. Devolve título, URL e o começo do texto da página.', inputSchema: { url: z.string() } },
      safe(a => br.open(botId, a.url)));
    s.registerTool('browser_snapshot', { description: 'Árvore de acessibilidade da página com refs [ref=eN] para click/type.', inputSchema: {} }, safe(() => br.snapshot(botId)));
    s.registerTool('browser_click', { description: 'Clica num elemento (ref, selector ou text).', inputSchema: target }, safe(a => br.click(botId, a)));
    s.registerTool('browser_type', { description: 'Preenche um campo (ref ou selector) com texto; submit=true aperta Enter.', inputSchema: { ref: target.ref, selector: target.selector, text: z.string(), submit: z.boolean().optional() } },
      safe(a => br.type(botId, a)));
    s.registerTool('browser_get_text', { description: 'Texto visível da página ou de um seletor CSS.', inputSchema: { selector: z.string().optional(), max: z.number().optional() } },
      safe(a => br.getText(botId, a.selector, a.max)));
    s.registerTool('browser_screenshot', { description: 'Captura de tela da página atual (use só se o texto não bastar).', inputSchema: {} },
      safe(async () => ({ content: [{ type: 'image', data: await br.screenshot(botId), mimeType: 'image/jpeg' }] })));
  }

  s.registerTool('list_agents', { description: 'Roster da equipe: uma linha por bot com trabalho, motor, ferramentas, logins e apps.', inputSchema: {} }, safe(async () => roster()));
  s.registerTool('get_agent', { description: 'Ficha completa de um bot.', inputSchema: { id: z.string() } },
    safe(async a => { const b = bots.get(a.id) ?? bots.all().find(x => x.name.toLowerCase() === a.id.toLowerCase()); return b ? JSON.stringify(card(b)) : 'não existe'; }));
  s.registerTool('delegate_task', {
    description: 'Delega uma tarefa a outro bot e ESPERA o resultado (o executor roda de verdade). Para tarefas independentes, chame várias vezes em paralelo. Recusa com sugestão se o bot não tiver o que requires pede.',
    inputSchema: {
      assignee: z.string().describe('id do bot'), objective: z.string(), inputs: z.string().optional(), done_when: z.string().optional().describe('critério de pronto'),
      requires: z.array(z.string()).optional().describe('ex: ["browser","login:linkedin.com","app:slack"]'), depends_on: z.array(z.number()).optional().describe('ids de tarefas que precisam terminar antes'),
    },
  }, safe(async a => JSON.stringify(await delegate(botId, convId, a))));

  s.registerTool('react', { description: 'Reage com um emoji a uma mensagem desta conversa (padrão: a última do usuário), como no WhatsApp. Use quando combinar (👍 pedido entendido, 🎉 deu certo, ❤️ agradecimento, 😂 piada); não substitui a resposta. Emoji vazio tira a sua reação.', inputSchema: { emoji: z.string().describe('um emoji, ex: 👍'), message_id: z.number().optional() } },
    safe(async a => { const m = react(convId, botId, a.emoji, a.message_id); return a.emoji.trim() ? `reagiu ${a.emoji.trim()} à mensagem #${m.id}` : 'reação tirada'; }));
  // lembrete pontual (Agenda "uma vez"): no horário, a instrução chega ao bot nesta conversa e ele responde ao usuário
  s.registerTool('create_reminder', {
    description: 'Cria lembrete/tarefa que roda UMA vez numa data e hora (horário de São Paulo) na Agenda do Gubots. No horário, "instruction" chega ao bot como mensagem do usuário nesta conversa e a resposta aparece para ele (e por e-mail, se pedir). Use para todo lembrete do usuário (não use Google Tasks). Para repetir (diária, semanal, a cada N min) use create_schedule. Devolve a hora agendada e a hora atual para conferir.',
    inputSchema: {
      when: z.string().describe('AAAA-MM-DD HH:MM no horário de São Paulo, ex: 2026-10-22 15:00'),
      instruction: z.string().describe('o que o bot recebe no horário, ex: "Lembre o usuário de ligar para o cliente X. Curto."'),
      title: z.string().optional().describe('nome curto na Agenda'), bot: z.string().optional().describe('id do bot que executa (padrão: você)'),
      email: z.string().optional().describe('e-mail para receber também o resultado'),
    },
  }, safe(async a => {
    const b = a.bot ? bots.get(String(a.bot).toLowerCase()) ?? bots.all().find(x => x.name.toLowerCase() === String(a.bot).toLowerCase()) : bot;
    if (!b) return `bot "${a.bot}" não existe`;
    const s = createSchedule({ botId: b.id, kind: 'once', at: a.when, prompt: a.instruction, title: a.title, email: a.email ?? '', convId: b.id === botId ? convId : undefined });
    return `agendado #${s.id} "${s.title}" para ${spText(s.at!)} (bot ${b.name}${s.email ? `, e-mail ${s.email}` : ''}) · agora: ${spText(Date.now())}`;
  }));
  // Agenda completa (todo bot, atual ou futuro): única, diária/semanal ou a cada N min; resultado cai nesta conversa
  const pick = (id?: string) => id ? bots.get(String(id).toLowerCase()) ?? bots.all().find(x => x.name.toLowerCase() === String(id).toLowerCase()) : bot;
  const line = (x: Schedule) => `#${x.id} "${x.title}" · ${x.botId} · ${x.kind === 'once' ? `uma vez ${spText(x.at!)}` : x.kind === 'daily' ? `diária ${x.time}${x.days.length ? ` dias ${x.days.join(',')}` : ''}` : `a cada ${x.every} min`} · ${x.done ? 'concluída' : x.paused ? 'pausada' : `próxima ${spText(x.nextAt)}`}`;
  const mine = (id: number) => { const x = schedules.get(id); if (!x) throw new Error(`agenda #${id} não existe`); if (x.botId !== botId && x.by !== botId) throw new Error(`agenda #${id} não é sua (bot ${x.botId})`); return x; };
  const when = {
    kind: z.enum(['once', 'daily', 'interval']).describe('once = uma vez; daily = todo dia (ou dias escolhidos) num horário; interval = a cada N minutos'),
    when: z.string().optional().describe('once: AAAA-MM-DD HH:MM (São Paulo)'),
    time: z.string().optional().describe('daily: HH:MM (São Paulo), ex: 11:00'),
    days: z.array(z.number().int().min(0).max(6)).optional().describe('daily: dias da semana 0=dom … 6=sáb; vazio = todo dia'),
    every_minutes: z.number().int().optional().describe('interval: minutos entre execuções (mín. 5)'),
  };
  const shape = (a: any) => {
    if (a.kind === 'once' && !a.when) throw new Error('once exige "when" (AAAA-MM-DD HH:MM)');
    if (a.kind === 'daily' && a.time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)) throw new Error('time inválido: use HH:MM, ex: 11:00');
    if (a.kind === 'daily' && !a.time) throw new Error('daily exige "time" (HH:MM)');
    if (a.kind === 'interval' && !(a.every_minutes >= 5)) throw new Error('interval exige every_minutes ≥ 5');
    return { kind: a.kind, at: a.when, time: a.time, days: a.days ?? [], every: a.every_minutes };
  };
  s.registerTool('create_schedule', {
    description: 'Cria tarefa na Agenda do Gubots: única (once), diária/semanal (daily) ou a cada N minutos (interval), fuso São Paulo. No horário, "instruction" chega ao bot executor como mensagem do usuário NESTA conversa e a resposta aparece aqui (e por e-mail, se pedir). Faça você mesmo, sem delegar. Antes, veja list_schedules para não duplicar. Devolve id, próxima execução e hora atual.',
    inputSchema: {
      ...when, instruction: z.string().describe('o que o bot recebe a cada execução'),
      title: z.string().optional().describe('nome curto na Agenda'), bot: z.string().optional().describe('id do bot que executa (padrão: você)'),
      email: z.string().optional().describe('e-mail para receber também o resultado'),
    },
  }, safe(async a => {
    const b = pick(a.bot); if (!b) return `bot "${a.bot}" não existe`;
    const title = String(a.title ?? '').trim();
    const dup = title && schedules.all().find(x => x.botId === b.id && !x.done && x.title.toLowerCase() === title.toLowerCase());
    if (dup) return `já existe: ${line(dup)} — use update_schedule para mudar`;
    const x = createSchedule({ ...shape(a), botId: b.id, prompt: a.instruction, title, email: a.email ?? '', convId: b.id === botId ? convId : undefined, by: botId });
    return `agendado ${line(x)} · agora: ${spText(Date.now())}`;
  }));
  s.registerTool('list_schedules', { description: 'Lista a Agenda do Gubots (todas as tarefas, com id, bot, recorrência, estado e próxima execução em São Paulo).', inputSchema: {} },
    safe(async () => schedules.all().map(line).join('\n') || 'Agenda vazia'));
  s.registerTool('update_schedule', {
    description: 'Muda, pausa ou reativa uma tarefa da Agenda que você executa ou criou. Passe só o que muda (kind exige os campos do tipo).',
    inputSchema: { id: z.number().int(), ...when, kind: when.kind.optional(), instruction: z.string().optional(), title: z.string().optional(), email: z.string().optional(), paused: z.boolean().optional() },
  }, safe(async a => {
    const old = mine(a.id);
    const p: any = {};
    if (a.kind) Object.assign(p, shape(a));
    else { if (a.when) p.at = a.when; if (a.time) p.time = shape({ kind: 'daily', time: a.time }).time; if (a.days) p.days = a.days; if (a.every_minutes) p.every = shape({ kind: 'interval', every_minutes: a.every_minutes }).every; }
    for (const [k, v] of [['prompt', a.instruction], ['title', a.title], ['email', a.email], ['paused', a.paused]] as const) if (v !== undefined) p[k] = v;
    if (!Object.keys(p).length) return `nada a mudar: ${line(old)}`;
    return `atualizado ${line(updateSchedule(a.id, p))}`;
  }));
  s.registerTool('delete_schedule', { description: 'Exclui uma tarefa da Agenda que você executa ou criou (irreversível; prefira pausar com update_schedule).', inputSchema: { id: z.number().int() } },
    safe(async a => { const x = mine(a.id); deleteSchedule(x.id); return `excluído #${x.id} "${x.title}"`; }));
  if (bot.tools.includes('design'))
    s.registerTool('office_to_pdf', { description: 'Converte pptx/xlsx/docx em PDF pelo Office deste PC (não há LibreOffice). Salva o PDF ao lado do original e devolve o caminho.', inputSchema: { path: z.string().describe('caminho do arquivo (absoluto ou relativo à sua pasta)') } },
      safe(async a => {
        const base = workDir(bot), src = isAbsolute(a.path) ? a.path : join(base, a.path);
        if (!resolve(src).startsWith(resolve(base))) throw new Error('arquivo fora da sua pasta');
        const out = src.replace(/\.[^.\\/]+$/, '.pdf');
        copyFileSync(await toPdf(src), out);
        return out;
      }));
  s.registerTool('spawn_subagent', { description: 'Cria um subagente temporário (mesmo modelo, sessão descartável, sem navegador) que faz UMA tarefa e devolve o resultado. Chame várias vezes em paralelo para partes independentes. Ele não vê a conversa: passe todo o contexto na tarefa.', inputSchema: { task: z.string().describe('tarefa completa, com contexto e formato de saída') } },
    safe(async a => (await subagent(botId, convId, a.task)) || '(subagente sem resposta)'));

  if (bot.tools.includes('browser')) {
    s.registerTool('list_secrets', { description: 'Credenciais salvas no cofre que você pode usar (nome, site, usuário). Nunca mostra a senha.', inputSchema: {} },
      safe(async () => { const l = vault.list(botId); return l.length ? l.map(x => `- ${x.name} · ${x.site}${x.username ? ` · usuário ${x.username}` : ''}`).join('\n') : 'cofre vazio: use request_secret'; }));
    s.registerTool('fill_secret', { description: 'Preenche usuário e senha de uma credencial do cofre na página aberta no seu navegador (só https e no site da credencial). Você não vê a senha. Pegue os refs com browser_snapshot.',
      inputSchema: { name: z.string().describe('nome da credencial (list_secrets)'), username_ref: z.string().optional(), username_selector: z.string().optional(), password_ref: z.string().optional(), password_selector: z.string().optional(), submit: z.boolean().optional().describe('aperta Enter no campo de senha') } },
      safe(async a => {
        const sec = vault.find(botId, a.name); if (!sec) throw new Error(`credencial "${a.name}" não está no cofre (list_secrets / request_secret)`);
        const { page } = await br.get(botId); const u = new URL(page.url());
        if (u.protocol !== 'https:' || !siteMatch(u.hostname, sec.site)) throw new Error(`a página aberta (${u.hostname}) não é do site da credencial (${sec.site})`);
        if (sec.username && (a.username_ref || a.username_selector)) await br.type(botId, { ref: a.username_ref, selector: a.username_selector, text: sec.username });
        await br.type(botId, { ref: a.password_ref, selector: a.password_selector || (a.password_ref ? undefined : 'input[type=password]:visible'), text: vault.reveal(sec), submit: a.submit });
        return `preenchido (${sec.name}) · ${page.url()}`;
      }));
    s.registerTool('request_secret', { description: 'Pede ao usuário uma credencial pelo cartão seguro do chat: ele digita usuário e senha, vai para o cofre criptografado e você nunca vê o valor. Espera até 10 min. Depois use fill_secret.',
      inputSchema: { name: z.string().describe('nome curto, ex: Workana'), site: z.string().describe('site do login, ex: workana.com'), username: z.string().optional().describe('usuário/e-mail, se já souber'), reason: z.string().describe('para que precisa, 1 linha') } },
      safe(async a => {
        const site = siteOf(a.site);
        const { result } = ask<{ name: string }>({ convId, botId, text: `🔐 ${bot.name} precisa do login de ${a.name} (${site}): ${a.reason}`, meta: { kind: 'secret-request', name: a.name, site, username: a.username } }, 10 * 60_000);
        pushDone(bot, convId, `🔐 Precisa do login de ${a.name}`);
        const r = await result;
        return r === 'timeout' ? 'o usuário não respondeu em 10 min; siga sem ou pergunte depois' : r && (r as any).name ? `credencial "${(r as any).name}" salva no cofre: use fill_secret` : 'o usuário recusou: não insista';
      }));
    s.registerTool('request_takeover', { description: 'Só quando você NÃO consegue sozinho depois de tentar (2FA, CAPTCHA, Cloudflare, passkey, confirmação no celular): mostra um cartão e notifica o usuário, que assume o seu navegador e toca "Pronto". Espera até 12 min e você continua de onde parou.',
      inputSchema: { reason: z.string().describe('o que o usuário precisa fazer, 1 linha') } },
      safe(async a => {
        const { page } = await br.get(botId);
        const { result } = ask<{ ok: boolean; note?: string }>({ convId, botId, text: `🙋 ${bot.name} precisa de você no navegador: ${a.reason}`, meta: { kind: 'takeover', url: page.url() } }, 12 * 60_000);
        pushDone(bot, convId, `🙋 Precisa de você: ${a.reason}`);
        const r = await result;
        return r === 'timeout' ? 'o usuário não apareceu em 12 min' : r.ok ? `usuário concluiu${r.note ? `: ${r.note}` : ''}. Página atual: ${page.url()}. Continue.` : `usuário não conseguiu${r.note ? `: ${r.note}` : ''}`;
      }));
  }

  s.registerTool('remember', { description: 'Guarda um fato durável da equipe (com origem automática).', inputSchema: { fact: z.string(), permanent: z.boolean().optional().describe('true = regra permanente (tom/formato de resposta, regra geral do usuário): vai no topo de todo prompt de todo bot') } },
    safe(async a => { if (hasSecret(a.fact)) throw new Error('senha não vai para a memória: use o cofre (request_secret / fill_secret)'); const r = active.get(runKey(botId, convId)) ?? runsOf(botId)[0]; const f = facts.add(a.fact, botId, { convId: r?.convId, taskId: r?.taskId }, !!a.permanent); return `guardado #${f.id}${f.pinned ? ' (permanente)' : ''}`; }));
  s.registerTool('recall', { description: 'Busca fatos da equipe (com bot, data e origem) e trechos do histórico.', inputSchema: { query: z.string(), limit: z.number().optional() } },
    safe(async a => recall(a.query, a.limit ?? 5)));
  s.registerTool('forget', { description: 'Marca um fato como obsoleto (nada é apagado).', inputSchema: { id: z.number(), replaced_by: z.number().optional() } },
    safe(async a => { facts.obsolete(a.id, a.replaced_by); return 'ok'; }));
  s.registerTool('graph_query', { description: 'Consulta o grafo de conhecimento (conversas + inbox do usuário) para relações entre conceitos.', inputSchema: { question: z.string() } },
    safe(a => graphQuery(a.question, 800)));
  // bot de manutenção (trabalha na pasta do próprio Gubots): pode reiniciar o servidor depois de mudar o código
  if (bot.workdir && resolve(bot.workdir) === ROOT)
    s.registerTool('restart_gubots', { description: 'Reinicia o servidor do Gubots para aplicar mudanças no código do servidor (server/). Só depois de `npm run check` e `npm test` passarem. O reinício acontece logo após sua resposta final; a conversa continua depois.', inputSchema: { reason: z.string() } },
      safe(async a => { bus.emit('restart', a.reason); return 'reinício agendado para depois desta resposta (leva ~5 s)'; }));
  return s;
}

export async function handleMcp(botId: string, convId: string, req: IncomingMessage, res: ServerResponse, body: any) {
  if (!bots.get(botId)) { res.writeHead(404).end(); return; }
  const server = build(botId, convId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
