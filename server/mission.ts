// Missão: grupo visível orquestrado pelo chefe (Jarvis). Ele chama um bot por vez com @, revisa a entrega à vista
// e chama o próximo. Bots não se acordam sozinhos: só fala quem o chefe ou o usuário marcar com @.
// Contexto compartilhado: todo bot chamado recebe o problema, os membros e o histórico da missão
// (completo na primeira vez; depois só o que é novo desde a última fala dele, já que a sessão guarda o resto).
// Travas: MAX_STEPS chamadas de bot por mensagem do usuário; parar mata a fila (epoch).
import { addMsg, bots, convs, emit, facts, messages, pubConv, sessions, type Bot, type Conv, type Mission, type Msg } from './db.ts';
import { attachment, pushDone, runBot, stop as stopRuns } from './hub.ts';
import type { Attachment } from './engines.ts';
import { settings } from './settings.ts';

export const MAX_STEPS = 15;
const BUDGET_FULL = 30_000, BUDGET_DELTA = 16_000; // caracteres de histórico por chamada

const membersOf = (c: Conv) => c.botIds.map(id => bots.get(id)).filter(Boolean) as Bot[];
export const leadOf = (c: Conv) => { const m = membersOf(c); return m.find(b => b.isChief) ?? m[0]; };
export const missionOf = (c: Conv): Mission => ({ problem: '', status: 'active', steps: 0, epoch: 0, seen: {}, ...c.mission });
function setMission(convId: string, patch: Partial<Mission>) {
  const c = convs.get(convId); if (!c) return;
  c.mission = { ...missionOf(c), ...patch }; convs.put(c); emit({ t: 'conv', conv: pubConv(c) });
  return c.mission;
}
const sys = (convId: string, text: string) => addMsg({ convId, role: 'system', text, meta: { kind: 'mission' } });
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' […]' : s);

export function mentions(text: string, ms: Bot[]) {
  const out: Bot[] = [];
  for (const [, w] of text.matchAll(/@([\p{L}\p{N}_-]+)/gu)) {
    const k = w.toLowerCase();
    const b = ms.find(b => b.id === k || b.name.toLowerCase() === k || b.name.toLowerCase().split(/\s+/)[0] === k);
    if (b && !out.includes(b)) out.push(b);
  }
  return out;
}

// ---------------- criar / falar / parar / encerrar ----------------
export function createMission(a: { title?: string; problem?: string; botIds?: string[] }) {
  const problem = String(a.problem ?? '').trim(); if (!problem) throw new Error('descreva o problema da missão');
  const picked = [...new Set((a.botIds ?? []).map(String))].filter(id => bots.get(id));
  if (picked.length < 2 || picked.length > 6) throw new Error('escolha de 2 a 6 bots');
  const chief = bots.all().find(b => b.isChief);
  const botIds = chief ? [chief.id, ...picked.filter(id => id !== chief.id)] : picked; // o chefe orquestra sempre
  const id = Math.random().toString(36).slice(2, 10);
  const title = String(a.title ?? '').trim().slice(0, 80) || cut(problem, 40);
  const c = convs.put({ id, kind: 'mission', title, botIds, lastTs: Date.now(), readTs: Date.now(), mission: { problem, status: 'active', steps: 0, epoch: 0, seen: {} } });
  emit({ t: 'conv', conv: pubConv(c) });
  addMsg({ convId: id, role: 'user', text: problem, meta: { kind: 'mission-problem' } });
  const lead = leadOf(c);
  if (lead) io.wake(id, lead, { note: 'Missão nova: monte o plano (quais bots, em que ordem) em poucas linhas e chame o primeiro com @id e a instrução do passo.' });
  return pubConv(convs.get(id)!);
}

export function send(convId: string, text: string, files: string[] = []) {
  const c = convs.get(convId); if (!c || c.kind !== 'mission') throw new Error('missão não existe');
  const atts = files.slice(0, 10).map(f => attachment(convId, f));
  if (!text && !atts.length) throw new Error('mensagem vazia');
  addMsg({ convId, role: 'user', text, meta: atts.length ? { attachments: atts.map(({ path, ...a }) => a) } : undefined });
  setMission(convId, { status: 'active', steps: 0, closing: false }); // sua mensagem zera o contador e reabre
  const ms = membersOf(c), to = mentions(text, ms);
  for (const b of to.length ? to : [leadOf(c)]) io.wake(convId, b, { files: atts });
}

const flying = new Map<string, Set<string>>(); // bots chamados pelo chefe que ainda não entregaram
export function stop(convId: string) {
  const c = convs.get(convId);
  if (c?.kind === 'mission') { setMission(convId, { status: 'paused', epoch: missionOf(c).epoch + 1, closing: false }); flying.delete(convId); }
  stopRuns(convId);
}

// Encerrar: para tudo, o chefe posta a síntese final; ela vai para a memória e a missão fecha
export function closeMission(convId: string) {
  const c = convs.get(convId); if (!c || c.kind !== 'mission') throw new Error('missão não existe');
  stop(convId);
  setMission(convId, { status: 'active', closing: true });
  io.wake(convId, leadOf(c), { force: true, note: 'ENCERRAMENTO pedido pelo usuário: não chame ninguém. Poste a síntese final da missão: problema, decisões, entregas (com links) e pendências. Curto.' });
  return { ok: true };
}

// ---------------- contexto compartilhado ----------------
const who = (m: Msg, self: string) => (m.role === 'user' ? settings.userName || 'Usuário' : m.botId === self ? 'Você' : bots.get(m.botId!)?.name ?? m.role);
// histórico visível da missão: mensagens suas, entregas dos bots e erros (cartões de tarefa ficam de fora)
const visible = (convId: string) => messages(convId, 500).filter(m => !m.taskId && (m.role === 'user' || m.role === 'bot' || (m.role === 'system' && m.meta?.kind === 'error')));

// corte inteligente: as mais recentes inteiras (até 4000 caracteres), as antigas encurtadas; estourou o orçamento, some o meio
export function history(list: Msg[], self: string, budget: number) {
  const lines = list.map((m, i) => {
    const recent = i >= list.length - 6;
    return `[${who(m, self)}] ${cut(m.text, recent ? 4000 : m.role === 'user' ? 1200 : 700)}`;
  });
  let total = lines.reduce((t, l) => t + l.length + 1, 0), drop = 0;
  const keepHead = 1; // a primeira mensagem (o problema) fica sempre
  while (total > budget && keepHead + drop < lines.length - 6) { total -= lines[keepHead + drop].length + 1; drop++; }
  return drop ? [...lines.slice(0, keepHead), `(… ${drop} mensagens do meio omitidas por tamanho …)`, ...lines.slice(keepHead + drop)].join('\n') : lines.join('\n');
}

export function missionPrompt(c: Conv, b: Bot, note = '') {
  const mi = missionOf(c), lead = leadOf(c), ms = membersOf(c);
  const all = visible(c.id);
  const last = all.at(-1)?.id ?? 0;
  const full = !sessions.get(b.id, c.id) || !(mi.seen[b.id] > 0); // sem sessão: manda tudo
  const list = full ? all : all.filter(m => m.id > mi.seen[b.id] && m.botId !== b.id);
  if (!full && !list.length && !note) return { prompt: null, last };
  const isLead = b.id === lead.id;
  const rules = isLead
    ? `Você ORQUESTRA esta missão. Chame UM bot por vez marcando @id com a instrução do passo (o que fazer, entradas, formato da entrega). Só responde quem você marcar; quando ele entregar, você recebe a entrega aqui para revisar e chamar o próximo (pode mudar a ordem). Não use delegate_task. Missão concluída ou precisa do usuário: responda sem @, curto.`
    : `Você foi chamado nesta missão. Faça só o seu passo com suas ferramentas e entregue resultado completo e curto (arquivos com link). Não chame outros bots: @${lead.id} coordena. Se faltar algo, diga o que falta.`;
  // passo do bot: a última mensagem (sua ou do chefe) que o marcou
  const ask = !isLead && [...all].reverse().find(m => (m.role === 'user' || m.botId === lead.id) && mentions(m.text, [b]).length);
  const prompt = [
    `[MISSÃO "${c.title}" · orquestrador @${lead.id} · passo ${Math.min(mi.steps, MAX_STEPS)}/${MAX_STEPS}]`,
    `Problema: ${cut(mi.problem, 3000)}`,
    `Membros: ${ms.map(m => `@${m.id} (${m.name}: ${cut(m.job, 120)})`).join('; ')}`,
    rules,
    full ? 'Histórico completo da missão:' : 'Novas mensagens na missão desde a sua última fala:',
    history(list, b.id, full ? BUDGET_FULL : BUDGET_DELTA),
    ask ? `Seu passo agora (pedido de ${who(ask, b.id)}): ${cut(ask.text, 4000)}` : '',
    note,
  ].filter(Boolean).join('\n\n');
  return { prompt, last };
}

// ---------------- execução ----------------
export const io = {
  // force: roda mesmo pausada/no limite (encerramento e aviso de limite)
  wake(convId: string, b: Bot, o: { note?: string; files?: Attachment[]; force?: boolean } = {}) {
    const c0 = convs.get(convId); if (!c0) return;
    const mi = missionOf(c0), epoch = mi.epoch;
    if (!o.force) setMission(convId, { steps: mi.steps + 1 });
    runBot(b, convId, '', {
      depth: 0, chain: [], files: o.files, quiet: true, label: o.note ? 'missão' : `missão: ${b.name}`,
      prep: () => { // na hora de rodar: missão parada → pula; sem novidade → pula
        const c = convs.get(convId); if (!c) return null;
        const m = missionOf(c);
        if (m.epoch !== epoch || (!o.force && m.status !== 'active')) return null;
        const { prompt, last } = missionPrompt(c, b, o.note);
        setMission(convId, { seen: { ...m.seen, [b.id]: last } });
        return prompt;
      },
    }).then(t => afterReply(convId, b, t, epoch), () => afterReply(convId, b, '', epoch, true));
  },
};

export function afterReply(convId: string, b: Bot, text: string, epoch: number, failed = false) {
  const c = convs.get(convId); if (!c || c.kind !== 'mission') return;
  const mi = missionOf(c), lead = leadOf(c);
  if (mi.epoch !== epoch) return; // parada no meio
  if (b.id === lead.id && mi.closing) {
    if (!text) return;
    const f = facts.add(`Missão "${c.title}" — problema: ${cut(mi.problem, 300)} — síntese: ${cut(text, 900)}`, lead.id, { convId });
    setMission(convId, { status: 'closed', closing: false });
    sys(convId, `Missão encerrada · síntese guardada na memória (#${f.id}).`);
    pushDone(lead, convId, text);
    return;
  }
  if (mi.status !== 'active') return;
  if (b.id !== lead.id) { // entrega de um bot: quando todos os chamados entregarem, o chefe revisa
    if (!text && !failed) return; // pulou (nada novo)
    const f = flying.get(convId); f?.delete(b.id);
    if (!f?.size) next(c, lead, { note: `Revise a(s) entrega(s) acima e decida: chame o próximo com @id e a instrução, ou responda sem @ se acabou ou precisa do usuário.` });
    return;
  }
  if (!text) return;
  const to = mentions(text, membersOf(c)).filter(m => m.id !== lead.id);
  if (!to.length) { pushDone(lead, convId, text); return; } // missão espera o usuário
  for (const t of to) next(c, t);
}

function next(c: Conv, b: Bot, o: { note?: string } = {}) {
  const mi = missionOf(convs.get(c.id)!);
  if (mi.steps >= MAX_STEPS) {
    setMission(c.id, { status: 'paused' }); flying.delete(c.id);
    sys(c.id, `Limite de ${MAX_STEPS} passos atingido: a missão espera você.`);
    io.wake(c.id, leadOf(c), { force: true, note: `LIMITE de ${MAX_STEPS} passos: não chame ninguém. Resuma em poucas linhas o estado (feito, pendente) e pergunte ao usuário como seguir.` });
    return;
  }
  if (b.id !== leadOf(c).id) { const f = flying.get(c.id) ?? new Set<string>(); f.add(b.id); flying.set(c.id, f); }
  io.wake(c.id, b, o);
}
