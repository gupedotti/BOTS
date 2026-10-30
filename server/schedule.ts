// Tarefas agendadas (cron simples) por bot: no horário, o servidor manda a instrução ao bot como se fosse você,
// na conversa mais recente com ele; opcional: o resultado vai também por e-mail (Gmail do Composio Connect).
// Fuso fixo America/Sao_Paulo. Loop de 30 s; sem dependência nova.
// Sem duplicar: o próximo horário é gravado ANTES de rodar e cada agenda roda uma vez por vez.
// Depois de reinício: horário perdido há mais de GRACE vira "pulada" (não dispara atrasado em massa).
import { addMsg, bots, convs, db, emit, pubConv } from './db.ts';
import { isEmptyResult, runBot } from './hub.ts';
import { sendMail } from './composio.ts';

export const TZ = 'America/Sao_Paulo';
export const GRACE = 15 * 60_000;
const TICK = 30_000;
const KEEP = 20; // histórico: últimas execuções por agenda

export type SchedRun = { ts: number; status: 'running' | 'done' | 'failed' | 'skipped'; ms?: number; error?: string; email?: string; manual?: boolean; empty?: boolean }; // empty: nada a reportar (não foi ao chat)
export type Schedule = {
  id: number; botId: string; title: string; prompt: string;
  kind: 'daily' | 'interval' | 'once'; time: string; days: number[]; every: number; // daily: "HH:MM" + dias (0=dom; vazio = todo dia) · interval: a cada N min
  at?: number; done?: boolean; // once: instante exato; depois de rodar (ou pular) fica pausada e done
  archived?: boolean; // once que rodou com sucesso: sai da Agenda (fica no banco com o histórico de execuções)
  convId?: string; // conversa onde o resultado cai (lembrete criado no chat); sem ela, a mais recente com o bot
  by?: string; // bot que criou pela ferramenta (pode editar/excluir)
  email: string; paused: boolean; nextAt: number; lastAt?: number; runs: SchedRun[]; createdAt: number;
};

db.exec('create table if not exists schedules(id integer primary key, data text not null)');
const get = (id: number): Schedule | undefined => { const r: any = db.prepare('select data from schedules where id=?').get(id); return r && JSON.parse(r.data); };
export const schedules = {
  all: (): Schedule[] => db.prepare('select data from schedules order by id').all().map((r: any) => JSON.parse(r.data)).filter((s: Schedule) => !s.archived),
  get,
  put(s: Schedule) { db.prepare('insert into schedules(id, data) values(?, ?) on conflict(id) do update set data=excluded.data').run(s.id, JSON.stringify(s)); emit(s.archived ? { t: 'schedule-del', id: s.id } : { t: 'schedule', schedule: s }); return s; },
};
// "uma vez" que já rodou com sucesso some da Agenda (arquivada: registro e histórico ficam no banco)
const finished = (s?: Schedule) => !!s && s.kind === 'once' && !!s.done && !s.archived && s.runs[0]?.status === 'done';
const archive = (s: Schedule) => schedules.put({ ...s, archived: true });
export const sweepOnce = () => { for (const r of db.prepare('select data from schedules').all() as any[]) { const s = JSON.parse(r.data); if (finished(s)) archive(s); } };

// ---------------- horário em São Paulo ----------------
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function parts(ts: number) {
  const p = Object.fromEntries(fmt.formatToParts(ts).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: WD.indexOf(p.weekday) };
}
// hora de parede em SP → instante UTC (offset lido do Intl: aguenta horário de verão se voltar)
function wall(y: number, m: number, d: number, h: number, mi: number) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = parts(guess);
  const off = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - guess;
  return guess - off;
}

// "2026-10-22 15:00" / "2026-10-22T15:00" = hora de São Paulo; ISO com fuso (Z, -03:00) ou número = instante exato
export function parseWhen(w: unknown): number {
  if (typeof w === 'number' && Number.isFinite(w)) return w;
  const t = String(w ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (m) return wall(+m[1], +m[2], +m[3], +m[4], +m[5]);
  const n = /[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? Date.parse(t) : NaN;
  if (!Number.isFinite(n)) throw new Error('data/hora inválida: use AAAA-MM-DD HH:MM (horário de São Paulo)');
  return n;
}
export const spText = (ts: number) => new Date(ts).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function nextRun(s: Pick<Schedule, 'kind' | 'time' | 'days' | 'every'> & { at?: number }, from = Date.now()): number {
  if (s.kind === 'once') return s.at ?? from;
  if (s.kind === 'interval') return from + Math.max(5, s.every) * 60_000;
  const [h, mi] = s.time.split(':').map(Number);
  const today = parts(from);
  for (let i = 0; i < 8; i++) {
    const day = parts(Date.UTC(today.y, today.m - 1, today.d + i, 12)); // meio-dia UTC = mesmo dia civil em SP
    if (s.days.length && !s.days.includes(day.wd)) continue;
    const t = wall(day.y, day.m, day.d, h, mi);
    if (t > from) return t;
  }
  return from + 86_400_000;
}

// ---------------- validação / CRUD ----------------
function clean(a: any, old?: Schedule): Schedule {
  const v = { ...old, ...a } as Schedule;
  if (!bots.get(v.botId)) throw new Error('escolha um bot');
  v.prompt = String(v.prompt ?? '').trim(); if (!v.prompt) throw new Error('escreva a instrução');
  v.title = String(v.title ?? '').trim().slice(0, 80) || v.prompt.slice(0, 40);
  v.kind = v.kind === 'interval' || v.kind === 'once' ? v.kind : 'daily';
  if (v.kind === 'once') v.at = parseWhen(v.at); else delete v.at;
  v.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(v.time) ? v.time : '08:00';
  v.days = [...new Set((v.days ?? []).map(Number).filter(d => d >= 0 && d <= 6))].sort();
  v.every = Math.max(5, Math.min(7 * 24 * 60, Math.round(Number(v.every) || 60)));
  v.email = String(v.email ?? '').trim();
  if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) throw new Error('e-mail inválido');
  v.paused = !!v.paused; v.runs = v.runs ?? [];
  return v;
}
export function createSchedule(a: any) {
  const v = clean(a);
  if (v.kind === 'once' && v.at! <= Date.now()) throw new Error(`essa data já passou (agora: ${spText(Date.now())})`);
  const { lastInsertRowid } = db.prepare(`insert into schedules(data) values('{}')`).run();
  return schedules.put({ ...v, id: Number(lastInsertRowid), createdAt: Date.now(), nextAt: nextRun(v) });
}
export function updateSchedule(id: number, a: any) {
  const old = get(id); if (!old) throw new Error('agenda não existe');
  const { nextAt, lastAt, runs, createdAt, done, ...patch } = a ?? {}; // estado de execução não vem do cliente
  const v = clean({ ...patch, id }, old);
  // mudou horário ou voltou da pausa: recalcula a partir de agora
  if (['kind', 'time', 'days', 'every', 'paused', 'at'].some(k => JSON.stringify((old as any)[k]) !== JSON.stringify((v as any)[k]))) {
    v.nextAt = nextRun(v);
    if (v.kind === 'once' && !v.paused) { // reativar "uma vez" exige data futura
      if (v.at! <= Date.now()) throw new Error(`escolha uma data futura (agora: ${spText(Date.now())})`);
      v.done = false; delete v.archived;
    }
    if (v.kind !== 'once') delete v.done;
  }
  return schedules.put(v);
}
export function deleteSchedule(id: number) { db.prepare('delete from schedules where id=?').run(id); emit({ t: 'schedule-del', id }); }

// ---------------- execução ----------------
const running = new Set<number>();
export const isRunning = (id: number) => running.has(id);
// conversa mais recente com o bot (a que abre na barra lateral); sem nenhuma, cria
function convFor(botId: string, prefer?: string) {
  const pc = prefer ? convs.get(prefer) : undefined;
  if (pc && pc.botIds.includes(botId)) return pc.id;
  const dm = convs.all().filter(c => c.kind === 'bot' && c.botIds.length === 1 && c.botIds[0] === botId).sort((a, b) => b.lastTs - a.lastTs)[0];
  if (dm) return dm.id;
  const id = Math.random().toString(36).slice(2, 10);
  const c = convs.put({ id, kind: 'bot', title: bots.get(botId)!.name, botIds: [botId], lastTs: Date.now(), readTs: Date.now() });
  emit({ t: 'conv', conv: pubConv(c) });
  return id;
}
const log = (s: Schedule, r: SchedRun) => {
  const cur = get(s.id) ?? s;
  const runs = [r, ...cur.runs.filter(x => x.ts !== r.ts)].slice(0, KEEP);
  return schedules.put({ ...cur, runs, lastAt: r.status === 'skipped' ? cur.lastAt : r.ts });
};

// io trocável nos testes (run chama o motor de verdade)
export const io = { run: (botId: string, convId: string, prompt: string, onShow?: () => void) => runBot(bots.get(botId)!, convId, prompt, { depth: 0, chain: [], hideEmpty: true, onShow }), mail: sendMail };

// erro passageiro do motor (modelo lotado, limite, 5xx, rede): tenta de novo sozinho em 2, 5 e 10 min
export const RETRY_MIN = [2, 5, 10];
export const transient = (m: string) => /capacity|overloaded|rate.?limit|too many requests|\b(429|50[0-4])\b|timed? ?out|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|temporar|unavailable|processo do (claude|codex) encerrou/i.test(m);

export async function fire(id: number, manual = false) {
  const s = get(id); if (!s) throw new Error('agenda não existe');
  if (running.has(id)) throw new Error('essa agenda já está rodando');
  if (!bots.get(s.botId)) { log(s, { ts: Date.now(), status: 'failed', error: 'bot removido', manual }); return; }
  running.add(id);
  const ts = Date.now();
  log(s, { ts, status: 'running', manual });
  try {
    const convId = convFor(s.botId, s.convId);
    // a instrução só aparece no chat junto com uma resposta de verdade: "." / vazio / "sem novidades" = silêncio
    let shown = false;
    const show = () => { if (!shown) { shown = true; addMsg({ convId, role: 'user', text: s.prompt, meta: { kind: 'schedule', scheduleId: s.id, title: s.title } }); } };
    let text = '';
    for (let i = 0; ; i++) {
      try { text = await io.run(s.botId, convId, s.prompt, show); break; }
      catch (e: any) {
        const msg = String(e?.message ?? e);
        if (i >= RETRY_MIN.length || !transient(msg) || get(id)?.paused) throw e;
        addMsg({ convId, role: 'system', botId: s.botId, text: `Erro passageiro (${msg.slice(0, 80)}). Tentando de novo em ${RETRY_MIN[i]} min (${i + 1}/${RETRY_MIN.length}).`, meta: { kind: 'schedule', scheduleId: s.id } });
        await new Promise(r => setTimeout(r, RETRY_MIN[i] * 60_000));
      }
    }
    const empty = isEmptyResult(text);
    if (!empty) show();
    let email: string | undefined;
    if (s.email && !empty) email = await io.mail(s.email, `[Gubots] ${s.title}`, text).then(() => 'enviado', (e: any) => `falhou: ${String(e?.message ?? e).slice(0, 200)}`);
    log(s, { ts, status: /^\s*FALHOU:/i.test(text) ? 'failed' : 'done', ms: Date.now() - ts, email, manual, ...(empty && { empty: true }) });
  } catch (e: any) {
    log(s, { ts, status: 'failed', ms: Date.now() - ts, error: String(e?.message ?? e).slice(0, 300), manual });
  } finally { running.delete(id); const cur = get(id); if (finished(cur)) archive(cur!); }
}

export function tick(now = Date.now()) {
  for (const s of schedules.all()) {
    if (s.paused || s.nextAt > now) continue;
    // grava o próximo horário (ou desativa a "uma vez") antes de rodar: reinício/tick seguinte não dispara de novo
    const once = s.kind === 'once';
    schedules.put(once ? { ...s, paused: true, done: true } : { ...s, nextAt: nextRun(s, now) });
    if (now - s.nextAt > GRACE) {
      log(s, { ts: s.nextAt, status: 'skipped', error: 'horário perdido (servidor desligado)' });
      // lembrete pontual perdido: avisa na conversa com o bot, para não sumir calado
      if (once && bots.get(s.botId)) addMsg({ convId: convFor(s.botId, s.convId), role: 'system', botId: s.botId, text: `Lembrete perdido (servidor desligado): "${s.title}", era ${spText(s.nextAt)}.`, meta: { kind: 'schedule', scheduleId: s.id } });
    } else if (!running.has(s.id)) fire(s.id).catch(() => {});
  }
}
export const startScheduler = () => { sweepOnce(); tick(); return setInterval(() => tick(), TICK); };
