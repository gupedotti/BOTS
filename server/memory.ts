// Memória = índice sobre o histórico bruto: fatos (FTS5, com origem), consolidação por tarefa (Haiku),
// grafo graphify em lote sobre memory/ (raw/ + inbox/ + facts.md), que também é o vault Obsidian.
import { hasSecret } from './vault.ts';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { MEM, bots, emit, facts, searchMessages, taskMessages, type Task } from './db.ts';
import { ask } from './engines.ts';

const GRAPH_OUT = join(MEM, 'graphify-out');
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
const origin = (s: any) => [s.taskId && `tarefa #${s.taskId}`, s.convId && `conversa ${s.convId}`].filter(Boolean).join(', ') || 'manual';

export function recall(q: string, limit = 5) {
  const f = facts.search(q, Math.min(limit, 10));
  const h = searchMessages(q, 3);
  const out = f.map(x => `#${x.id} ${x.pinned ? '[permanente] ' : ''}${x.text} — ${bots.get(x.botId)?.name ?? x.botId}, ${fmtDate(x.ts)}, origem: ${origin(x.source)}`);
  if (h.length) out.push('Histórico:', ...h.map(m => `· ${fmtDate(m.ts)} ${m.botId ?? 'usuário'}: ${m.text.slice(0, 200)}`));
  return out.join('\n') || 'nada encontrado';
}

// Fim de tarefa: Haiku resume só aquela tarefa em fatos novos e marca obsoletos os que ela contradiz.
export async function consolidate(t: Task) {
  const conv = taskMessages(t.id).map(m => `${m.role}${m.botId ? `(${m.botId})` : ''}: ${m.text}`).join('\n').slice(-6000);
  const near = facts.search(`${t.objective} ${t.result ?? ''}`, 8);
  const raw = await ask(`Tarefa #${t.id}: ${t.objective}\nResultado: ${t.result}\nMensagens:\n${conv}\n\nFatos já existentes:\n${near.map(f => `#${f.id} ${f.text}`).join('\n') || '(nenhum)'}\n\n` +
    'Extraia no máximo 3 fatos DURÁVEIS e úteis no futuro (preferências, decisões, prazos, contas, onde algo fica). Não repita fatos existentes nem registre resultados efêmeros (ex: manchetes do dia) ou óbvios da configuração da equipe; na dúvida, devolva add vazio. ' +
    PERM + 'Se um fato novo substitui um existente, informe o id. JSON: {"add":[{"text":"...","replaces":null,"permanent":false}]}');
  save(raw, 3, t.assignee, { taskId: t.id, convId: t.convId, by: 'consolidação' });
}

// Preferência de tom/formato/tamanho de resposta ou regra geral do usuário = regra permanente (topo de todo prompt).
const PERM = 'Nunca inclua senhas, tokens ou códigos de acesso (ficam no cofre). Marque "permanent":true quando o fato for preferência de tom, formato ou tamanho de resposta, ou regra que o usuário quer em TODA resposta/de todos os bots. ';
function save(raw: string, n: number, botId: string, source: any) {
  let j: any; try { j = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim()); } catch { return; }
  for (const a of (j.add ?? []).slice(0, n)) {
    if (!a?.text || hasSecret(String(a.text)) || facts.search(a.text, 1).some(f => f.text.toLowerCase() === String(a.text).toLowerCase())) continue;
    const old = a.replaces ? facts.get(Number(a.replaces)) : undefined;
    const nf = facts.add(String(a.text), botId, source, a.permanent === true || !!old?.pinned); // substituto herda o "permanente"
    if (old) facts.obsolete(old.id, nf.id);
  }
}

// Chat direto: depois de cada pedido seu, o Haiku extrai o que é durável (preferência, regra, decisão, prazo, contato)
// e guarda como fato com origem. Assim o bot aprende sozinho, sem depender de chamar remember.
export async function learnFromChat(botId: string, convId: string, userText: string, reply: string) {
  if (userText.trim().length < 12) return; // "ok", "valeu"... nada a aprender
  const near = facts.search(userText, 8);
  const raw = await ask(`Pedido do usuário:\n${userText.slice(0, 3000)}\n\nResposta do bot:\n${reply.slice(0, 1500)}\n\nFatos já guardados:\n${near.map(f => `#${f.id} ${f.text}`).join('\n') || '(nenhum)'}\n\n` +
    'Extraia no máximo 2 fatos DURÁVEIS sobre o que o usuário quer: preferências (tom, formato, tamanho de resposta), regras, decisões, prazos, contatos, onde algo fica. ' +
    'Escreva em 3ª pessoa ("O usuário prefere…"). Ignore pedidos pontuais, resultados do dia e o que já está nos fatos. Na dúvida, devolva add vazio. ' +
    PERM + 'Se um fato novo substitui um existente, informe o id. JSON: {"add":[{"text":"...","replaces":null,"permanent":false}]}');
  save(raw, 2, botId, { convId, by: 'aprendizado automático' });
}

// O que a equipe sabe vai junto de cada pedido (todo bot, chat e delegação passam por aqui):
// regras permanentes SEMPRE no topo, sem limite; depois fatos ligados ao pedido + os mais recentes.
export function memoryContext(q: string, max = 10) {
  const pins = facts.pinned();
  const seen = new Set<number>(pins.map(f => f.id));
  const pick = [...facts.search(q, 6), ...facts.all().filter(f => !f.obsolete).slice(0, 8)].filter(f => !seen.has(f.id) && !!seen.add(f.id)).slice(0, max);
  let out = pins.length ? `[Regras permanentes do usuário: valem em TODA resposta, sem exceção]\n${pins.map(f => `- ${f.text}`).join('\n')}\n\n` : '';
  if (pick.length) out += `[Memória da equipe: siga estas preferências e fatos sobre o usuário]\n${pick.map(f => `- ${f.text}`).join('\n')}\n\n`;
  return out;
}

// ---------------- grafo (graphify) ----------------
// graphify como processo filho: UTF-8 forçado (no Windows o padrão é cp1252), com timeout.
// Sem windowsHide de propósito: com stdio em pipe o libuv usaria CREATE_NO_WINDOW e o `claude -p` que o graphify
// lança (subprocess sem flags) ganharia um console NOVO e visível. Herdando o console (oculto pelo start.vbs), nada aparece.
function gfy(args: string[], timeout: number): Promise<string> {
  return new Promise((ok, ko) => {
    const p = spawn('graphify', args, { cwd: MEM, windowsHide: false, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
    let out = ''; p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (out += d));
    const t = setTimeout(() => p.kill(), timeout);
    p.on('error', e => { clearTimeout(t); ko(new Error(`graphify indisponível: ${e.message}`)); });
    p.on('exit', c => { clearTimeout(t); c === 0 ? ok(out) : ko(new Error(`graphify saiu ${c}: ${out.slice(-400)}`)); });
  });
}

let running: Promise<void> | undefined;
export function graphUpdate() {
  if (running) return running;
  writeFactsMd();
  // backend claude-cli = assinatura do usuário via `claude -p`; o cache do graphify reextrai só arquivos novos/alterados
  running = gfy(['extract', MEM, '--backend', 'claude-cli', '--out', MEM], 30 * 60_000)
    .then(() => gfy(['cluster-only', MEM, '--no-viz'], 5 * 60_000)).then(() => {})
    .finally(() => { running = undefined; emit({ t: 'graph' }); });
  return running;
}
export const graphRunning = () => !!running;

export function graph() {
  const f = join(GRAPH_OUT, 'graph.json');
  if (!existsSync(f)) return { nodes: [], edges: [], updatedAt: null, review: [], running: !!running };
  const g = JSON.parse(readFileSync(f, 'utf8'));
  const nodes = (g.nodes ?? []).slice(0, 300).map((n: any) => ({ id: String(n.id), label: n.label ?? n.id, community: n.community }));
  const ids = new Set(nodes.map((n: any) => n.id));
  const edges = (g.links ?? g.edges ?? []).map((e: any) => ({ source: String(e.source), target: String(e.target), relation: e.relation ?? '', confidence: e.confidence ?? 'EXTRACTED' }))
    .filter((e: any) => ids.has(e.source) && ids.has(e.target)).slice(0, 600);
  return { nodes, edges, updatedAt: statSync(f).mtimeMs, review: review(), running: !!running };
}

// "Para revisar": seções do GRAPH_REPORT sobre ambiguidade/lacunas + arestas AMBIGUOUS
function review(): string[] {
  const f = join(GRAPH_OUT, 'GRAPH_REPORT.md'); if (!existsSync(f)) return [];
  const out: string[] = []; let on = false;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (/^#+ /.test(line)) on = /ambig|gap|lacuna|question|pergunt|isolat|surpris/i.test(line);
    else if (on && /^\s*[-*\d]/.test(line)) out.push(line.replace(/^\s*[-*\d.]+\s*/, '').replace(/\*\*|`/g, '').trim());
  }
  return out.map(l => l.replace(/\s+/g, ' ')).filter(l => l && !/^(.+?) --\S+--> \1( |$)/.test(l)).slice(0, 12); // descarta "X parecido com X"
}

export function graphQuery(question: string, budget = 800): Promise<string> {
  if (!existsSync(join(GRAPH_OUT, 'graph.json'))) return Promise.resolve('grafo ainda não gerado');
  return gfy(['query', question, '--budget', String(budget), '--graph', join(GRAPH_OUT, 'graph.json')], 30_000).then(o => o.trim().slice(0, 6000) || 'sem resultado', e => e.message);
}

// ---------------- inbox / segundo cérebro ----------------
const safeName = (n: string) => basename(n).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'nota.md';
export async function inboxAdd(o: { name?: string; text?: string; url?: string; bytes?: Buffer }) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  if (o.url) {
    const u = new URL(o.url); if (!/^https?:$/.test(u.protocol)) throw new Error('só http(s)');
    let body = ''; try { body = await (await fetch(u, { signal: AbortSignal.timeout(15_000) })).text(); } catch {}
    const text = body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 50_000);
    writeFileSync(join(MEM, 'inbox', `${stamp}-${safeName(u.hostname)}.md`), `# ${o.url}\n\nfonte: ${o.url}\n\n${text}\n`);
  } else if (o.bytes) writeFileSync(join(MEM, 'inbox', `${stamp}-${safeName(o.name ?? 'arquivo')}`), o.bytes);
  else if (o.text) writeFileSync(join(MEM, 'inbox', `${stamp}-${safeName(o.name ?? 'nota')}${/\.\w+$/.test(o.name ?? '') ? '' : '.md'}`), o.text);
  else throw new Error('nada para salvar');
}
export function searchNotes(q: string) {
  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1); if (!words.length) return [];
  return readdirSync(join(MEM, 'inbox')).filter(n => /\.(md|txt)$/i.test(n)).flatMap(name => {
    const t = readFileSync(join(MEM, 'inbox', name), 'utf8'); const i = words.map(w => t.toLowerCase().indexOf(w)).find(i => i >= 0);
    return i == null ? [] : [{ name, snippet: t.slice(Math.max(0, i - 60), i + 140).replace(/\s+/g, ' ') }];
  }).slice(0, 10);
}

// Vault Obsidian = a própria pasta memory/ (raw/, inbox/, facts.md com wikilinks para os bots)
export function writeFactsMd() {
  const all = facts.all();
  writeFileSync(join(MEM, 'facts.md'), `# Fatos da equipe\n\n${all.map(f => `- ${f.pinned && !f.obsolete ? '📌 ' : ''}${f.obsolete ? '~~' : ''}${f.text}${f.obsolete ? '~~ (obsoleto)' : ''} — [[${bots.get(f.botId)?.name ?? f.botId}]] · ${new Date(f.ts).toISOString().slice(0, 10)} · ${origin(f.source)}`).join('\n')}\n`);
  return MEM;
}
