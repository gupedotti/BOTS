// SQLite (node:sqlite, sem dependência nativa). Mensagens são append-only: nada aqui apaga histórico.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

export const DATA = process.env.GUBOTS_DATA || join(import.meta.dirname, '..', 'data');
export const MEM = join(DATA, 'memory'); // raw/ + inbox/ + facts.md → corpus do graphify e vault Obsidian
for (const d of ['bots', 'profiles', 'memory/raw', 'memory/inbox']) mkdirSync(join(DATA, d), { recursive: true });

export const bus = new EventEmitter(); // 'ws' → payload para os clientes
bus.setMaxListeners(0);
export const emit = (o: any) => bus.emit('ws', o);

export const db = new DatabaseSync(join(DATA, 'gubots.db'));
db.exec(`
pragma journal_mode=wal;
create table if not exists bots(id text primary key, data text not null);
create table if not exists convs(id text primary key, data text not null);
create table if not exists tasks(id integer primary key, data text not null);
create table if not exists sessions(bot_id text, conv_id text, sid text, primary key(bot_id, conv_id));
create table if not exists messages(id integer primary key, conv_id text, role text, bot_id text, text text, task_id integer, ts integer, meta text);
create virtual table if not exists messages_fts using fts5(text, content='messages', content_rowid='id');
create trigger if not exists messages_ai after insert on messages begin insert into messages_fts(rowid, text) values (new.id, new.text); end;
create table if not exists facts(id integer primary key, text text, bot_id text, source text, ts integer, obsolete integer default 0, replaced_by integer);
create virtual table if not exists facts_fts using fts5(text, content='facts', content_rowid='id');
create trigger if not exists facts_ai after insert on facts begin insert into facts_fts(rowid, text) values (new.id, new.text); end;
`);
// regra permanente: vai no topo de TODO prompt de todo bot, independente do pedido
try { db.exec('alter table facts add column pinned integer default 0'); } catch { /* já existe */ }

export type Bot = {
  id: string; name: string; avatar: string; job: string; engine: 'claude' | 'codex'; model: string;
  effort: 'low' | 'medium' | 'high'; tools: string[]; composio: string[]; mcp: { name: string; url: string; headers?: Record<string, string> }[];
  logins: string[]; isChief: boolean; profile: string; status?: string; workdir?: string; composioSession?: { id: string; url: string; key: string };
};
// missão: grupo orquestrado pelo chefe; problema fixo, passos desde a última msg do usuário, até onde cada bot já leu (seen)
export type Mission = { problem: string; status: 'active' | 'paused' | 'closed'; steps: number; epoch: number; seen: Record<string, number>; closing?: boolean };
export type Conv = { id: string; kind: 'bot' | 'mission'; title: string; botIds: string[]; lastTs: number; readTs?: number; mission?: Mission };
export type Task = {
  id: number; parentId?: number; convId: string; requester: string; assignee: string; objective: string; inputs: string;
  doneWhen: string; requires: string[]; status: string; result?: string; refusal?: { reason: string; suggest?: string };
  dependsOn: number[]; depth: number; createdAt: number; startedAt?: number; endedAt?: number;
};

// tabelas JSON-blob: poucos registros, filtro em JS
const blob = <T extends { id: any }>(table: string) => ({
  all: (): T[] => db.prepare(`select data from ${table} order by rowid`).all().map((r: any) => JSON.parse(r.data)),
  get: (id: any): T | undefined => { const r: any = db.prepare(`select data from ${table} where id=?`).get(id); return r && JSON.parse(r.data); },
  put: (o: T) => { db.prepare(`insert into ${table}(id, data) values(?, ?) on conflict(id) do update set data=excluded.data`).run(o.id, JSON.stringify(o)); return o; },
  del: (id: any) => db.prepare(`delete from ${table} where id=?`).run(id),
});
export const bots = blob<Bot>('bots');
export const convs = blob<Conv>('convs');
// conversas de antes do contador de não lidas: tudo até a última mensagem conta como lido
for (const c of convs.all()) if (c.readTs == null) convs.put({ ...c, readTs: c.lastTs });
// grupos saíram do app: somem da barra lateral como em "Apagar" (as mensagens ficam no banco)
for (const c of convs.all()) if ((c.kind as string) === 'group') convs.del(c.id);
export const tasks = {
  ...blob<Task>('tasks'),
  create(t: Omit<Task, 'id'>): Task {
    const { lastInsertRowid } = db.prepare(`insert into tasks(data) values('{}')`).run();
    return tasks.put({ ...t, id: Number(lastInsertRowid) });
  },
};

export const sessions = {
  get: (botId: string, convId: string): string | undefined => (db.prepare('select sid from sessions where bot_id=? and conv_id=?').get(botId, convId) as any)?.sid,
  set: (botId: string, convId: string, sid: string) => db.prepare('insert or replace into sessions values(?,?,?)').run(botId, convId, sid),
};

export type Msg = { id: number; convId: string; role: string; botId?: string; text: string; taskId?: number; ts: number; meta?: any };
const toMsg = (r: any): Msg => ({ id: r.id, convId: r.conv_id, role: r.role, botId: r.bot_id ?? undefined, text: r.text, taskId: r.task_id ?? undefined, ts: r.ts, meta: r.meta ? JSON.parse(r.meta) : undefined });

export function addMsg(m: Omit<Msg, 'id' | 'ts'>): Msg {
  const ts = Date.now();
  const { lastInsertRowid } = db.prepare('insert into messages(conv_id, role, bot_id, text, task_id, ts, meta) values(?,?,?,?,?,?,?)')
    .run(m.convId, m.role, m.botId ?? null, m.text, m.taskId ?? null, ts, m.meta ? JSON.stringify(m.meta) : null);
  const msg = { ...m, id: Number(lastInsertRowid), ts };
  // export bruto .md por conversa/dia (corpus do graphify; nunca reescrito)
  const day = new Date(ts).toISOString().slice(0, 10);
  const who = m.role === 'user' ? 'Você' : (m.botId ? bots.get(m.botId)?.name ?? m.botId : m.role);
  mkdirSync(join(MEM, 'raw', m.convId), { recursive: true });
  appendFileSync(join(MEM, 'raw', m.convId, `${day}.md`), `\n**${new Date(ts).toTimeString().slice(0, 5)} ${who}**${m.taskId ? ` (tarefa #${m.taskId})` : ''}: ${m.text}\n`);
  if (convs.get(m.convId)) { const c = convs.get(m.convId)!; c.lastTs = ts; convs.put(c); }
  emit({ t: 'msg', msg });
  return msg;
}
// reação de bot (emoji) numa mensagem: uma por bot; emoji vazio tira. Sem mensagem id → última do usuário na conversa
// checklist da resposta (- [ ] item): o que você marcou fica salvo na mensagem
export function setCheck(msgId: number, key: string, on: boolean): Msg {
  const r: any = db.prepare('select * from messages where id=?').get(msgId);
  if (!r) throw new Error('mensagem não existe');
  const m = toMsg(r), meta = m.meta ?? {};
  meta.checks = { ...meta.checks, [String(key).slice(0, 20)]: !!on };
  db.prepare('update messages set meta=? where id=?').run(JSON.stringify(meta), m.id);
  const msg = { ...m, meta };
  emit({ t: 'msg', msg });
  return msg;
}
export function react(convId: string, botId: string, emoji: string, msgId?: number): Msg {
  const e = emoji.trim();
  if (e && (e.length > 16 || /[\p{L}\p{N}\s]/u.test(e.replace(/\uFE0F|\u200D/g, '')))) throw new Error('mande só um emoji, ex: 👍');
  const r: any = msgId != null
    ? db.prepare('select * from messages where id=? and conv_id=?').get(msgId, convId)
    : db.prepare(`select * from messages where conv_id=? and role='user' order by id desc limit 1`).get(convId);
  if (!r) throw new Error('mensagem não encontrada nesta conversa');
  const m = toMsg(r), meta = m.meta ?? {};
  const list = ((meta.reactions ?? []) as { botId: string; emoji: string }[]).filter(x => x.botId !== botId);
  meta.reactions = e ? [...list, { botId, emoji: e }] : list;
  db.prepare('update messages set meta=? where id=?').run(JSON.stringify(meta), m.id);
  const msg = { ...m, meta };
  emit({ t: 'msg', msg });
  return msg;
}
// não lidas = respostas de bot depois do "lido até" da conversa (conversas antigas, sem readTs, contam como lidas)
export const unread = (c: Conv): number => c.readTs == null ? 0 : (db.prepare(`select count(*) n from messages where conv_id=? and role='bot' and ts>?`).get(c.id, c.readTs) as any).n;
export const pubConv = (c: Conv) => ({ ...c, unread: unread(c) });
export function markRead(id: string) {
  const c = convs.get(id); if (!c) return undefined;
  c.readTs = Date.now(); convs.put(c);
  const p = pubConv(c); emit({ t: 'conv', conv: p }); return p; // os outros aparelhos zeram também
}
export const messages = (convId: string, limit = 200): Msg[] =>
  db.prepare('select * from (select * from messages where conv_id=? order by id desc limit ?) order by id').all(convId, limit).map(toMsg);
export const taskMessages = (taskId: number): Msg[] => db.prepare('select * from messages where task_id=? order by id').all(taskId).map(toMsg);

// FTS5: termos viram prefixos entre aspas (entrada do usuário nunca vira sintaxe FTS)
export const ftsQuery = (q: string) => q.split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1).map(w => `"${w}"*`).join(' OR ');
export function searchMessages(q: string, limit = 10): Msg[] {
  const f = ftsQuery(q); if (!f) return [];
  return db.prepare('select m.* from messages_fts f join messages m on m.id=f.rowid where messages_fts match ? order by rank limit ?').all(f, limit).map(toMsg);
}

export type Fact = { id: number; text: string; botId: string; source: any; ts: number; obsolete: boolean; replacedBy?: number; pinned: boolean };
const toFact = (r: any): Fact => ({ id: r.id, text: r.text, botId: r.bot_id, source: JSON.parse(r.source || '{}'), ts: r.ts, obsolete: !!r.obsolete, replacedBy: r.replaced_by ?? undefined, pinned: !!r.pinned });
export const facts = {
  all: (): Fact[] => db.prepare('select * from facts order by id desc').all().map(toFact),
  get: (id: number) => { const r = db.prepare('select * from facts where id=?').get(id); return r && toFact(r); },
  add(text: string, botId: string, source: any, pinned = false): Fact {
    const { lastInsertRowid } = db.prepare('insert into facts(text, bot_id, source, ts, pinned) values(?,?,?,?,?)').run(text, botId, JSON.stringify(source), Date.now(), pinned ? 1 : 0);
    emit({ t: 'facts' });
    return facts.get(Number(lastInsertRowid))!;
  },
  pinned: (): Fact[] => db.prepare('select * from facts where pinned=1 and obsolete=0 order by id').all().map(toFact),
  pin(id: number, on = true) { db.prepare('update facts set pinned=? where id=?').run(on ? 1 : 0, id); emit({ t: 'facts' }); },
  obsolete(id: number, replacedBy?: number) { db.prepare('update facts set obsolete=1, replaced_by=? where id=?').run(replacedBy ?? null, id); emit({ t: 'facts' }); },
  // apagar de vez (pedido explícito do usuário): só fato já obsoleto; sai da busca e de quem apontava para ele
  del(id: number) {
    const f = facts.get(id); if (!f) return;
    if (!f.obsolete) throw new Error('marque como obsoleto antes de apagar');
    db.prepare(`insert into facts_fts(facts_fts, rowid, text) values('delete', ?, ?)`).run(id, f.text);
    db.prepare('delete from facts where id=?').run(id);
    db.prepare('update facts set replaced_by=null where replaced_by=?').run(id);
    emit({ t: 'facts' });
  },
  search(q: string, limit = 5, includeObsolete = false): Fact[] {
    const f = ftsQuery(q); if (!f) return [];
    return db.prepare(`select x.* from facts_fts f join facts x on x.id=f.rowid where facts_fts match ? ${includeObsolete ? '' : 'and x.obsolete=0'} order by rank limit ?`).all(f, limit).map(toFact);
  },
};
