// Testes de fumaça: memória, delegação (guardas), navegador e listagem de modelos.
// Banco isolado em pasta temporária. GUBOTS_SKIP_LIVE=1 pula navegador e modelos (precisam de Chrome/logins).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

process.env.GUBOTS_DATA = mkdtempSync(join(tmpdir(), 'gubots-test-'));
const { facts, addMsg, searchMessages } = await import('../server/db.ts');
const hub = await import('../server/hub.ts');
const live = !process.env.GUBOTS_SKIP_LIVE;

test('memória: fato com origem, busca FTS e obsoleto', () => {
  const f = facts.add('O relatório semanal sai às sextas até 17h', 'jarvis', { convId: 'c1' });
  assert.equal(facts.search('relatorio sexta')[0]?.id, f.id); // prefixo + acento só no texto
  assert.deepEqual(facts.search('relatório')[0].source, { convId: 'c1' });
  facts.obsolete(f.id);
  assert.equal(facts.search('relatório').length, 0);
  assert.equal(facts.search('relatório', 5, true).length, 1); // nada é apagado
  addMsg({ convId: 'c1', role: 'user', text: 'manchetes do g1' });
  assert.equal(searchMessages('manchetes').length, 1);
  assert.equal(facts.search('"; drop table facts; --').length, 0); // entrada vira termo, nunca sintaxe FTS
  const tmp = facts.add('fato temporário zebra', 'user', {});
  assert.throws(() => facts.del(tmp.id)); // só apaga obsoleto
  facts.obsolete(tmp.id); facts.del(tmp.id);
  assert.equal(facts.get(tmp.id), undefined);
  assert.equal(facts.search('zebra', 5, true).length, 0); // sai da busca também
});

test('delegação: ficha, recusa com sugestão, bot inexistente', async () => {
  hub.createBot({ name: 'Jarvis', avatar: 'jarvis', job: 'chefe', engine: 'claude', model: 'opus', isChief: true });
  hub.createBot({ name: 'Atlas', avatar: 'atlas', job: 'web', engine: 'codex', model: 'm', tools: ['browser'], logins: ['https://g1.globo.com/'] });
  hub.createBot({ name: 'Nova', avatar: 'nova', job: 'textos', engine: 'claude', model: 'haiku' });
  assert.match(hub.roster(), /atlas \(Atlas\).*ferramentas: browser.*logins: g1\.globo\.com/);
  assert.deepEqual(hub.missing((await import('../server/db.ts')).bots.get('atlas')!, ['browser', 'login:g1.globo.com', 'app:slack']), ['app:slack']);
  const r: any = await hub.delegate('jarvis', '', { assignee: 'nova', objective: 'abrir g1', requires: ['browser'] });
  assert.equal(r.status, 'refused');
  assert.equal(r.suggest, 'atlas');
  const r2: any = await hub.delegate('jarvis', '', { assignee: 'ninguem', objective: 'x' });
  assert.equal(r2.status, 'error');
  const r3: any = await hub.delegate('jarvis', '', { assignee: 'jarvis', objective: 'x' });
  assert.equal(r3.status, 'refused'); // sem ping-pong: solicitante está na cadeia
});

test('agendadas: próximo horário em SP, seg a sex, sem duplicar, reinício pula atrasada, e-mail e histórico', async () => {
  const sc = await import('../server/schedule.ts');
  const { messages, convs } = await import('../server/db.ts');
  const sp = (iso: string) => Date.parse(iso + '-03:00');
  // todo dia 08:00: antes das 8 → hoje; depois → amanhã
  assert.equal(sc.nextRun({ kind: 'daily', time: '08:00', days: [], every: 0 }, sp('2026-10-21T07:59')), sp('2026-10-21T08:00'));
  assert.equal(sc.nextRun({ kind: 'daily', time: '08:00', days: [], every: 0 }, sp('2026-10-21T08:00')), sp('2026-10-22T08:00'));
  // seg a sex: sexta 9h → segunda 8h (23/10/2026 é sexta)
  assert.equal(sc.nextRun({ kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5], every: 0 }, sp('2026-10-23T09:00')), sp('2026-10-26T08:00'));
  assert.equal(sc.nextRun({ kind: 'interval', time: '', days: [], every: 30 }, 1000), 1000 + 30 * 60_000);
  assert.throws(() => sc.createSchedule({ botId: 'ninguem', prompt: 'x' }), /bot/);
  assert.throws(() => sc.createSchedule({ botId: 'jarvis', prompt: 'x', email: 'sem-arroba' }), /e-mail/);

  const calls: string[] = [], mails: string[] = []; const io = { ...sc.io };
  let release!: () => void;
  sc.io.run = async (_b, _c, p) => { calls.push(p); await new Promise<void>((r) => (release = r)); return 'Briefing: 3 itens'; };
  sc.io.mail = async (to) => { mails.push(to); };
  try {
    const s = sc.createSchedule({ botId: 'jarvis', title: 'Briefing', prompt: 'resuma meu dia', time: '08:00', days: [1, 2, 3, 4, 5], email: 'eu@exemplo.com' });
    assert.ok(s.nextAt > Date.now());
    // venceu agora: dispara uma vez só, mesmo com dois ticks seguidos
    sc.schedules.put({ ...s, nextAt: Date.now() - 1000 });
    sc.tick(); sc.tick();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls.length, 1);
    assert.ok(sc.schedules.get(s.id)!.nextAt > Date.now()); // próximo gravado antes de rodar
    await assert.rejects(sc.fire(s.id, true), /já está rodando/);
    release(); await new Promise((r) => setTimeout(r, 10));
    const done = sc.schedules.get(s.id)!;
    assert.deepEqual([done.runs[0].status, done.runs[0].email, done.runs.length], ['done', 'enviado', 1]);
    assert.deepEqual(mails, ['eu@exemplo.com']);
    const conv = messages(convs.all().find((c) => c.kind === 'bot' && c.botIds[0] === 'jarvis')!.id, 5);
    assert.ok(conv.some((m) => m.role === 'user' && m.meta?.kind === 'schedule' && m.text === 'resuma meu dia')); // caiu na conversa do bot
    // reinício: horário perdido há horas não dispara, vira "pulada"
    sc.schedules.put({ ...done, nextAt: Date.now() - 3 * 3600_000 });
    sc.tick();
    assert.equal(calls.length, 1);
    assert.equal(sc.schedules.get(s.id)!.runs[0].status, 'skipped');
    // pausada não roda; editar não aceita estado vindo do cliente
    sc.updateSchedule(s.id, { paused: true, runs: [], nextAt: 0 });
    assert.ok(sc.schedules.get(s.id)!.runs.length === 2 && sc.schedules.get(s.id)!.nextAt > 0);
    sc.schedules.put({ ...sc.schedules.get(s.id)!, nextAt: Date.now() - 1000 });
    sc.tick();
    assert.equal(calls.length, 1);
    sc.deleteSchedule(s.id);
    assert.equal(sc.schedules.get(s.id), undefined);
  } finally { Object.assign(sc.io, io); }
});

test('agendadas "uma vez": data em SP, roda uma vez e desativa, pulada avisa no chat, ferramenta de lembrete', async () => {
  const sc = await import('../server/schedule.ts');
  const { messages, convs } = await import('../server/db.ts');
  assert.equal(sc.parseWhen('2026-10-22 15:00'), Date.parse('2026-10-22T15:00-03:00'));
  assert.equal(sc.parseWhen('2026-10-22T15:00:00Z'), Date.parse('2026-10-22T15:00:00Z'));
  assert.throws(() => sc.parseWhen('amanhã'), /inválida/);
  assert.throws(() => sc.createSchedule({ botId: 'jarvis', kind: 'once', at: '2020-01-01 10:00', prompt: 'x' }), /já passou/);
  const calls: string[] = []; const io = { ...sc.io };
  sc.io.run = async (_b, _c, p) => { calls.push(p); return 'ok, lembrei'; };
  try {
    const at = Date.now() + 3600_000;
    const s = sc.createSchedule({ botId: 'jarvis', kind: 'once', at, prompt: 'lembre de ligar pro cliente' });
    assert.deepEqual([s.kind, s.nextAt, s.paused], ['once', at, false]);
    sc.tick(at - 1000); assert.equal(calls.length, 0); // antes da hora: nada
    sc.tick(at + 1000); sc.tick(at + 2000);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls.length, 1); // uma vez só
    const d = sc.schedules.get(s.id)!;
    assert.deepEqual([d.paused, d.done, d.runs[0].status, d.archived], [true, true, 'done', true]);
    assert.ok(!sc.schedules.all().some((x) => x.id === s.id)); // rodou: some da Agenda (registro fica no banco)
    // concluída antiga (antes desta regra): a limpeza do início arquiva
    const old = sc.schedules.put({ ...d, id: d.id + 1000, archived: undefined });
    assert.ok(sc.schedules.all().some((x) => x.id === old.id));
    sc.sweepOnce();
    assert.ok(!sc.schedules.all().some((x) => x.id === old.id));
    sc.tick(at + 3600_000); assert.equal(calls.length, 1); // desativada
    sc.schedules.put({ ...d, at: Date.now() - 1000, nextAt: Date.now() - 1000 }); // a hora real também passou
    assert.throws(() => sc.updateSchedule(s.id, { paused: false }), /data futura/); // reativar pede data nova
    const again = sc.updateSchedule(s.id, { paused: false, at: Date.now() + 7200_000 });
    assert.deepEqual([again.paused, again.done, again.runs.length], [false, false, 1]); // histórico mantido
    // perdida no reinício (> 15 min): pulada, desativada e avisada na conversa
    sc.tick(again.at! + 3600_000);
    const p = sc.schedules.get(s.id)!;
    assert.deepEqual([p.runs[0].status, p.done, calls.length, !!p.archived], ['skipped', true, 1, false]); // pulada fica visível
    assert.ok(sc.schedules.all().some((x) => x.id === s.id));
    const cid = convs.all().find((c) => c.kind === 'bot' && c.botIds[0] === 'jarvis')!.id;
    assert.match(messages(cid, 1)[0].text, /Lembrete perdido/);
    // ferramenta MCP create_reminder (por HTTP, como o bot chama)
    const { handleMcp } = await import('../server/mcp.ts');
    const { createServer } = await import('node:http');
    const srv = createServer(async (req, res) => { let b = ''; for await (const c of req) b += c; handleMcp('jarvis', cid, req, res, JSON.parse(b)); }).listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${(srv.address() as any).port}/`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_reminder', arguments: { when: '2099-01-02 09:30', instruction: 'Lembre o usuário da reunião', title: 'Reunião' } } }) });
      const txt = JSON.stringify(await r.json());
      assert.match(txt, /agendado #\d+ \\"Reunião\\" para .*02\/01\/2099.*09:30/);
      const rem = sc.schedules.all().find((x) => x.title === 'Reunião')!;
      assert.deepEqual([rem.kind, rem.convId, rem.at], ['once', cid, Date.parse('2099-01-02T09:30-03:00')]);
      sc.deleteSchedule(rem.id);
      // Agenda completa por ferramenta, para todo bot (inclusive um criado agora)
      const { bots } = await import('../server/db.ts');
      bots.put({ ...bots.get('jarvis')!, id: 'novoteste', name: 'NovoTeste', tools: [] });
      const call = async (bot: string, name: string, args: any = {}) => {
        const s2 = createServer(async (req, res) => { let b = ''; for await (const c of req) b += c; handleMcp(bot, cid, req, res, JSON.parse(b)); }).listen(0);
        try {
          const r = await fetch(`http://127.0.0.1:${(s2.address() as any).port}/`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: name === 'list' ? 'tools/list' : 'tools/call', params: name === 'list' ? {} : { name, arguments: args } }) });
          return JSON.stringify(await r.json());
        } finally { s2.close(); }
      };
      try {
        for (const b of ['jarvis', 'novoteste']) for (const t of ['create_reminder', 'create_schedule', 'list_schedules', 'update_schedule', 'delete_schedule']) assert.match(await call(b, 'list'), new RegExp(`"${t}"`));
        assert.match(await call('novoteste', 'create_schedule', { kind: 'daily', time: '25:00', instruction: 'x' }), /time inválido/);
        assert.match(await call('novoteste', 'create_schedule', { kind: 'once', instruction: 'x' }), /exige \\"when\\"/);
        assert.match(await call('novoteste', 'create_schedule', { kind: 'interval', every_minutes: 2, instruction: 'x' }), /≥ 5/);
        assert.match(await call('novoteste', 'create_schedule', { kind: 'daily', time: '11:00', days: [1, 3], instruction: 'checar', title: 'Rotina teste' }), /agendado #\d+ \\"Rotina teste\\" · novoteste · diária 11:00 dias 1,3/);
        const d = sc.schedules.all().find((x) => x.title === 'Rotina teste')!;
        assert.deepEqual([d.convId, d.by, new Date(d.nextAt).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })], [cid, 'novoteste', '11']);
        assert.match(await call('novoteste', 'create_schedule', { kind: 'daily', time: '12:00', instruction: 'y', title: 'rotina TESTE' }), /já existe/);
        assert.match(await call('jarvis', 'delete_schedule', { id: d.id }), /não é sua/);
        assert.match(await call('novoteste', 'update_schedule', { id: d.id, paused: true }), /pausada/);
        assert.match(await call('novoteste', 'create_schedule', { kind: 'once', when: '2099-03-04 08:15', instruction: 'z', title: 'Única teste' }), /uma vez .*04\/03\/2099.*08:15/);
        assert.match(await call('novoteste', 'list_schedules'), /Rotina teste[\s\S]*Única teste/);
        for (const x of sc.schedules.all().filter((x) => x.by === 'novoteste')) assert.match(await call('novoteste', 'delete_schedule', { id: x.id }), /excluído/);
      } finally { bots.del('novoteste'); }
    } finally { srv.close(); }
    sc.deleteSchedule(s.id);
  } finally { Object.assign(sc.io, io); }
});

test('missão: chefe orquestra por @, bots não se acordam, contexto compartilhado, limite, parar e encerrar', async () => {
  const ms = await import('../server/mission.ts');
  const { addMsg, bots, convs, facts, messages, sessions } = await import('../server/db.ts');
  const calls: { id: string; note?: string; force?: boolean }[] = []; const wake = ms.io.wake;
  ms.io.wake = (_c, b, o = {}) => { calls.push({ id: b.id, note: o.note, force: o.force }); };
  try {
    const [jarvis, atlas, nova] = ['jarvis', 'atlas', 'nova'].map((id) => bots.get(id)!);
    assert.throws(() => ms.createMission({ problem: 'x', botIds: ['atlas'] }), /2 a 6/);
    const c = ms.createMission({ title: 'Lançamento', problem: 'Lançar o site novo até sexta', botIds: ['atlas', 'nova'] });
    assert.deepEqual([c.kind, c.botIds], ['mission', ['jarvis', 'atlas', 'nova']]); // chefe entra sempre
    assert.deepEqual(calls.map((x) => x.id), ['jarvis']); // chefe monta o plano
    const mi = () => ms.missionOf(convs.get(c.id)!);
    const say = (b: typeof jarvis, text: string) => { addMsg({ convId: c.id, role: 'bot', botId: b.id, text }); ms.afterReply(c.id, b, text, mi().epoch); };
    // contexto completo para quem nunca falou: problema, membros e histórico
    const p0 = ms.missionPrompt(convs.get(c.id)!, nova).prompt!;
    assert.match(p0, /Problema: Lançar o site novo até sexta[\s\S]*@atlas \(Atlas[\s\S]*Histórico completo/);
    // chefe chama um por vez; só o marcado acorda
    say(jarvis, 'Plano: Atlas pesquisa, depois Nova escreve. @atlas levante 3 concorrentes com link.');
    assert.deepEqual(calls.map((x) => x.id), ['jarvis', 'atlas']);
    const pa = ms.missionPrompt(convs.get(c.id)!, atlas).prompt!;
    assert.match(pa, /Seu passo agora \(pedido de Jarvis\): Plano: Atlas pesquisa/);
    assert.match(pa, /Não chame outros bots/);
    // bot marca outro bot: não acorda; quem revisa é o chefe
    say(atlas, 'Concorrentes: A, B, C. @nova usa isso no texto.');
    assert.deepEqual(calls.map((x) => x.id), ['jarvis', 'atlas', 'jarvis']);
    assert.match(calls.at(-1)!.note!, /Revise/);
    // delta: com sessão, Nova recebe só o novo (sem as próprias falas)
    sessions.set('nova', c.id, 'sessao-x');
    addMsg({ convId: c.id, role: 'bot', botId: 'nova', text: 'rascunho antigo da nova' });
    const seenAt = messages(c.id, 1)[0].id;
    convs.put({ ...convs.get(c.id)!, mission: { ...mi(), seen: { nova: seenAt } } });
    say(jarvis, '@nova escreva o texto com os concorrentes do Atlas.');
    const pn = ms.missionPrompt(convs.get(c.id)!, nova).prompt!;
    assert.match(pn, /Novas mensagens[\s\S]*@nova escreva/);
    assert.doesNotMatch(pn, /rascunho antigo|Concorrentes: A, B, C/);
    // delegação escondida bloqueada na missão
    assert.equal((await hub.delegate('jarvis', c.id, { assignee: 'nova', objective: 'x' }) as any).status, 'refused');
    // limite de passos: para, avisa e o chefe resume (forçado)
    convs.put({ ...convs.get(c.id)!, mission: { ...mi(), steps: ms.MAX_STEPS } });
    say(jarvis, '@atlas mais uma');
    assert.equal(mi().status, 'paused');
    assert.match(messages(c.id, 1)[0].text, /Limite de 15 passos/);
    assert.deepEqual([calls.at(-1)!.id, calls.at(-1)!.force], ['jarvis', true]);
    // sua mensagem zera e reabre; @ acorda direto o marcado
    ms.send(c.id, '@nova pode seguir');
    assert.deepEqual([mi().steps, mi().status, calls.at(-1)!.id], [0, 'active', 'nova']);
    // parar: fila morre (resposta de época antiga é ignorada)
    const e = mi().epoch; ms.stop(c.id);
    assert.deepEqual([mi().status, mi().epoch], ['paused', e + 1]);
    const n = calls.length; ms.afterReply(c.id, jarvis, '@atlas vai', e); assert.equal(calls.length, n);
    // encerrar: chefe posta síntese → memória, missão fechada
    ms.closeMission(c.id);
    assert.match(calls.at(-1)!.note!, /ENCERRAMENTO/);
    say(jarvis, 'Síntese: site pronto, concorrentes mapeados, texto da Nova aprovado.');
    assert.equal(mi().status, 'closed');
    assert.match(facts.search('concorrentes mapeados')[0].text, /Missão "Lançamento"/);
    // corte inteligente: problema fica, meio some, recentes inteiras
    const many = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, convId: 'x', role: i ? 'bot' : 'user', botId: i ? 'atlas' : undefined, text: (i ? `entrega ${i} ` : 'PROBLEMA ') + 'x'.repeat(900), ts: 0 }));
    const h = ms.history(many, 'nova', 16_000);
    assert.ok(h.length <= 16_000 + 4000 && h.startsWith('[Usuário] PROBLEMA') || h.includes('PROBLEMA'));
    assert.match(h, /mensagens do meio omitidas/);
    assert.match(h, /entrega 59 x{900}/);
  } finally { ms.io.wake = wake; }
});

test('navegador: abrir, snapshot com refs, clicar, ler texto', { skip: !live, timeout: 60_000 }, async () => {
  const br = await import('../server/browser.ts');
  const srv = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    .end(req.url === '/b' ? '<h1>Página B</h1>' : '<h1>Manchete de teste</h1><a href="/b">Ir para a página B agora mesmo, clique</a>')).listen(0);
  const url = `http://127.0.0.1:${(srv.address() as any).port}/`;
  try {
    const t0 = Date.now();
    assert.match(await br.open('t', url), /Manchete de teste[\s\S]*Links:\n- Ir para a página B/);
    const snap = await br.snapshot('t');
    const ref = snap.match(/link "Ir para[^\n]*\[ref=(e\d+)\]/)?.[1];
    assert.ok(ref, snap);
    await br.click('t', { ref });
    assert.match(await br.getText('t'), /Página B/);
    console.log(`navegador frio→clique: ${Date.now() - t0}ms`);
  } finally { srv.close(); await br.closeAll(); }
});

test('navegador: download por clique e por URL vai para data/bots/<bot>/downloads sem sobrescrever', { skip: !live, timeout: 60_000 }, async () => {
  const br = await import('../server/browser.ts');
  const { DATA } = await import('../server/db.ts');
  const srv = createServer((req, res) => req.url!.startsWith('/f')
    ? res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="extrato teste.pdf"' }).end('%PDF-1.4 teste')
    : res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<h1>Baixar</h1><button onclick="location.href=\'/f\'">Gerar PDF</button>')).listen(0);
  const url = `http://127.0.0.1:${(srv.address() as any).port}/`;
  try {
    await br.open('dl', url);
    assert.match(await br.click('dl', { text: 'Gerar PDF' }), /download salvo: downloads\/extrato teste\.pdf .*link \/api\/bots\/dl\/files\/downloads\/extrato%20teste\.pdf/);
    assert.match(await br.open('dl', url + 'f2'), /download salvo: downloads\/extrato teste \(1\)\.pdf/);
    assert.equal(readFileSync(join(DATA, 'bots', 'dl', 'downloads', 'extrato teste (1).pdf'), 'utf8'), '%PDF-1.4 teste');
    assert.match(await br.open('dl', url), /Baixar/); // fluxo normal segue
    assert.equal(br.freeName(join(DATA, 'bots', 'dl', 'downloads'), 'a/b:c.pdf'), 'a_b_c.pdf');
  } finally { srv.close(); await br.closeAll(); }
});

test('navegador: download por blob (XHR lento + a[download]), popup e nova aba com blob', { skip: !live, timeout: 90_000 }, async () => {
  const br = await import('../server/browser.ts');
  const { DATA } = await import('../server/db.ts');
  const page = `<h1>MIR</h1><script>
    async function pdf() { const r = await fetch('/pdf'); return r.blob(); }
    async function blobDl(b) { b.disabled = true; const u = URL.createObjectURL(await pdf()); const a = document.createElement('a'); a.href = u; a.download = 'copia declaracao.pdf'; document.body.append(a); a.click(); b.disabled = false; }
    async function blobTab() { const w = window.open('', '_blank'); w.location = URL.createObjectURL(await pdf()); }
  </script><button onclick="blobDl(this)">Blob</button><button onclick="window.open('/inline.pdf')">Popup</button><button onclick="blobTab()">Aba</button>`;
  const srv = createServer((req, res) => {
    if (req.url === '/pdf') return setTimeout(() => res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.4 blob'), 2500); // gera devagar, como a Receita
    if (req.url === '/inline.pdf') return res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.4 popup');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
  }).listen(0);
  const url = `http://127.0.0.1:${(srv.address() as any).port}/`;
  const dir = join(DATA, 'bots', 'dlb', 'downloads');
  const saved = (r: string) => join(dir, r.match(/download salvo: downloads\/(.+?) \(/)![1]);
  try {
    await br.open('dlb', url);
    const a = await br.click('dlb', { text: 'Blob' });
    assert.match(a, /download salvo: downloads\/copia declaracao\.pdf/);
    assert.equal(readFileSync(saved(a), 'utf8'), '%PDF-1.4 blob');
    const b = await br.click('dlb', { text: 'Popup' });
    assert.match(b, /download salvo: downloads\/.+\.pdf/);
    assert.equal(readFileSync(saved(b), 'utf8'), '%PDF-1.4 popup');
    await br.open('dlb', url);
    const c = await br.click('dlb', { text: 'Aba' });
    assert.match(c, /download salvo: downloads\/.+\.pdf/);
    assert.equal(readFileSync(saved(c), 'utf8'), '%PDF-1.4 blob');
  } finally { srv.close(); await br.closeAll(); }
});

test('adblock: casa só pelo host', async () => {
  const { AD_RE } = await import('../server/browser.ts');
  for (const u of ['https://securepubads.g.doubleclick.net/x.js', 'https://www.googletagmanager.com/gtm.js?id=1', 'https://connect.facebook.net/pt_BR/sdk.js', 'http://cdn.taboola.com', 'https://adservice.google.com.br/ddm'])
    assert.ok(AD_RE.test(u), u);
  for (const u of ['https://g1.globo.com/doubleclick/taboola.html', 'https://www.facebook.com/login', 'https://accounts.google.com/', 'https://site.com/?ref=outbrain', 'https://openxcell.com/', 'https://nottaboola.com/'])
    assert.ok(!AD_RE.test(u), u);
});

test('adblock: script de anúncio é abortado, página carrega', { skip: !live, timeout: 60_000 }, async () => {
  const br = await import('../server/browser.ts');
  const srv = createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    .end('<h1>Com anúncio</h1><script src="https://securepubads.g.doubleclick.net/x.js"></script>')).listen(0);
  try {
    const { page } = await br.get('ad');
    const failed: string[] = [];
    page.on('requestfailed', r => failed.push(`${r.url()} ${r.failure()?.errorText}`));
    assert.match(await br.open('ad', `http://127.0.0.1:${(srv.address() as any).port}/`), /Com anúncio/);
    assert.ok(failed.some(f => f.startsWith('https://securepubads.g.doubleclick.net/x.js') && /BLOCKED_BY_CLIENT/.test(f)), failed.join('\n') || 'nenhum request falhou');
  } finally { srv.close(); await br.closeAll(); }
});

test('modelos: listas vêm das contas (Claude e Codex)', { skip: !live, timeout: 90_000 }, async () => {
  const { models, stopCodex } = await import('../server/engines.ts');
  const m = await models();
  stopCodex();
  assert.ok(m.claude.length, `Claude: ${m.errors.claude}`);
  assert.ok(m.codex.length, `Codex: ${m.errors.codex}`);
  assert.ok(m.claude.every(x => x.id && x.name));
});

test('ditado: WAV vira PCM, silêncio não chama o Whisper, limite de tamanho', async () => {
  const stt = await import('../server/stt.ts');
  const n = 16000, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  b.writeInt16LE(16384, 44);
  const w = stt.wavToFloat(b)!;
  assert.equal(w.rate, 16000); assert.equal(w.pcm.length, n); assert.equal(w.pcm[0], 0.5);
  assert.equal(stt.wavToFloat(Buffer.from('não é wav')), null);
  b.writeInt16LE(0, 44);
  assert.equal(await stt.transcribe(b), ''); // 1 s de silêncio: devolve vazio sem carregar modelo
  await assert.rejects(stt.transcribe(Buffer.alloc(stt.MAX_BYTES + 1)), /grande demais/);
});

test('push: criptografia aes128gcm decifra no aparelho e VAPID assina com a chave pública', async () => {
  const { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify } = await import('node:crypto');
  const push = await import('../server/push.ts');
  const ua = createECDH('prime256v1'); const uaPub = ua.generateKeys(); const auth = randomBytes(16);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: uaPub.toString('base64url'), auth: auth.toString('base64url') }, ts: 0 };
  const msg = JSON.stringify({ title: 'Jarvis', body: 'Pronto: ação concluída ✅' });
  const out: Buffer = push._test.encrypt(sub, Buffer.from(msg));
  // lado do navegador (RFC 8291)
  const salt = out.subarray(0, 16), idlen = out[20], asPub = out.subarray(21, 21 + idlen), ct = out.subarray(21 + idlen);
  assert.equal(out.readUInt32BE(16), 4096);
  const ikm = Buffer.from(hkdfSync('sha256', ua.computeSecret(asPub), auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
  const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  assert.equal(plain.at(-1), 2);
  assert.equal(plain.subarray(0, -1).toString(), msg);
  // VAPID: JWT ES256 verificável com a chave pública anunciada
  const h = push._test.vapid(sub.endpoint);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h)!;
  assert.equal(k, push.publicKey());
  const [hd, pl, sig] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(pl, 'base64url').toString()).aud, 'https://fcm.googleapis.com');
  const raw = Buffer.from(k, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${hd}.${pl}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  assert.equal(push.plain('## Título\n**negrito** e [link](http://x) `code`'), 'Título negrito e link code');
});

test('não lidas: respostas de bot depois do "lido até" contam; marcar como lida zera', async () => {
  const { convs, addMsg, pubConv, markRead } = await import('../server/db.ts');
  const c = convs.put({ id: 'unr1', kind: 'bot', title: 'Teste', botIds: ['jarvis'], lastTs: Date.now(), readTs: Date.now() - 1 });
  addMsg({ convId: c.id, role: 'user', text: 'oi' });
  addMsg({ convId: c.id, role: 'bot', botId: 'jarvis', text: 'resposta 1' });
  addMsg({ convId: c.id, role: 'bot', botId: 'jarvis', text: 'resposta 2' });
  assert.equal(pubConv(convs.get(c.id)!).unread, 2); // só as do bot
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(markRead(c.id)!.unread, 0);
  assert.equal(pubConv({ ...c, readTs: undefined }).unread, 0); // conversa antiga sem marca: não acusa nada
});

test('memória automática: preferências vão junto de todo pedido', async () => {
  const { facts } = await import('../server/db.ts');
  const { memoryContext } = await import('../server/memory.ts');
  facts.add('O usuário prefere respostas curtas e objetivas', 'jarvis', { by: 'teste' });
  const ctx = memoryContext('me resume as notícias de hoje');
  assert.match(ctx, /Memória da equipe/);
  assert.match(ctx, /respostas curtas/); // mesmo sem relação com o pedido, a preferência recente entra
});

test('memória: regras permanentes entram no topo de todo prompt, mesmo com muitos fatos', async () => {
  const { facts } = await import('../server/db.ts');
  const { memoryContext, recall } = await import('../server/memory.ts');
  const p = facts.add('O usuário quer respostas estilo caveman', 'forja', { by: 'teste' }, true);
  for (let i = 0; i < 20; i++) facts.add(`Fato qualquer número ${i} sobre carros alugados`, 'harvey', { by: 'teste' });
  const ctx = memoryContext('contrato de carros alugados');
  assert.ok(ctx.startsWith('[Regras permanentes'));
  assert.match(ctx, /caveman/);
  assert.equal(ctx.match(/caveman/g)!.length, 1); // não repete na parte de busca
  assert.match(recall('caveman'), /\[permanente\]/);
  facts.pin(p.id, false);
  assert.doesNotMatch(memoryContext('contrato de carros alugados'), /Regras permanentes/);
  facts.pin(p.id, true); facts.obsolete(p.id);
  assert.doesNotMatch(memoryContext('x'), /caveman/); // obsoleto sai
});

test('estilo caveman: system prompt e perfil de todo bot (chefe, Claude, Codex, novo) levam a regra', async () => {
  const { bots, DATA } = await import('../server/db.ts');
  const { readFileSync } = await import('node:fs');
  hub.createBot({ name: 'Recém Criado', avatar: 'vega', job: 'teste', engine: 'codex', model: 'm' });
  const all = bots.all();
  assert.ok(all.length >= 4 && all.some(b => b.isChief) && all.some(b => b.engine === 'codex') && all.some(b => b.engine === 'claude'));
  for (const b of all) {
    assert.ok(hub.system(b).includes(hub.STYLE), `${b.id}: system sem regra`);
    for (const f of ['CLAUDE.md', 'AGENTS.md']) assert.ok(readFileSync(join(DATA, 'bots', b.id, f), 'utf8').includes(hub.STYLE), `${b.id}/${f} sem regra`);
  }
  assert.match(hub.STYLE, /caveman ULTRA.*só o resultado.*sem explicar como fez/);
});

test('agendas: resultado vazio/"."/"sem novidades" não vai ao chat nem e-mail, mas fica no histórico', async () => {
  const sc = await import('../server/schedule.ts');
  const { convs, messages } = await import('../server/db.ts');
  for (const t of ['', ' ', '.', '-', '…', ' . ', 'Sem novidades', 'sem novidades.']) assert.ok(hub.isEmptyResult(t), JSON.stringify(t));
  for (const t of ['ok', 'Sem novidades no processo X, mas prazo amanhã', '1 unsubscribe']) assert.ok(!hub.isEmptyResult(t), t);
  const io = { ...sc.io }; const mails: string[] = []; let out = '.';
  sc.io.run = async () => out;
  sc.io.mail = async (to) => { mails.push(to); };
  try {
    convs.put({ id: 'silencio', kind: 'bot', title: 'J', botIds: ['jarvis'], lastTs: 0 });
    const s = sc.createSchedule({ botId: 'jarvis', prompt: 'triagem de e-mail', time: '08:00', email: 'eu@exemplo.com', convId: 'silencio' });
    const before = messages('silencio', 50).length;
    await sc.fire(s.id, true);
    assert.equal(messages('silencio', 50).length, before); // nada no chat
    assert.deepEqual(mails, []); // nem e-mail
    assert.deepEqual([sc.schedules.get(s.id)!.runs[0].status, sc.schedules.get(s.id)!.runs[0].empty], ['done', true]); // mas registrou
    out = '2 unsubscribes: Loja X — Promo';
    await sc.fire(s.id, true);
    assert.equal(messages('silencio', 1)[0].text, 'triagem de e-mail'); // com novidade: instrução aparece (a resposta o motor posta)
    assert.deepEqual(mails, ['eu@exemplo.com']);
    assert.equal(sc.schedules.get(s.id)!.runs[0].empty, undefined);
    sc.deleteSchedule(s.id);
  } finally { Object.assign(sc.io, io); }
});

test('contexto: marcar app no Claude não apaga a sessão; sessão nova recebe o histórico recente', async () => {
  const { sessions, convs, addMsg } = await import('../server/db.ts');
  sessions.set('jarvis', 'ctx1', 'sid-claude'); sessions.set('atlas', 'ctx1', 'sid-codex');
  hub.updateBot('jarvis', { composio: ['outlook'] }); // Claude: retoma a mesma sessão com a config nova
  assert.equal(sessions.get('jarvis', 'ctx1'), 'sid-claude');
  hub.updateBot('atlas', { composio: ['outlook'] }); // Codex: config fixa na thread → thread nova
  assert.equal(sessions.get('atlas', 'ctx1'), undefined);
  hub.updateBot('jarvis', { engine: 'codex', model: 'm' }); // trocou de motor: sessão não serve mais
  assert.equal(sessions.get('jarvis', 'ctx1'), undefined);
  hub.updateBot('jarvis', { engine: 'claude', model: 'opus', composio: [] });
  // sessão nova numa conversa com histórico: as mensagens recentes vão junto (sem repetir a atual)
  convs.put({ id: 'ctx1', kind: 'bot', title: 'J', botIds: ['jarvis'], lastTs: 0 });
  addMsg({ convId: 'ctx1', role: 'user', text: 'conectei outra conta pessoal, do outlook...verifique' });
  addMsg({ convId: 'ctx1', role: 'bot', botId: 'jarvis', text: 'Outlook bloqueado para mim.' });
  addMsg({ convId: 'ctx1', role: 'user', text: 'verifique novamente' });
  const r = hub.recap('ctx1', 'verifique novamente');
  assert.match(r, /Histórico recente[\s\S]*outlook\.\.\.verifique[\s\S]*Jarvis: Outlook bloqueado[\s\S]*Fim do histórico/);
  assert.doesNotMatch(r, /verifique novamente/);
  assert.equal(hub.recap('ctx1', 'x', { taskId: 1 }), ''); // tarefa delegada monta o próprio contexto
  assert.equal(hub.recap('vazia', 'oi'), '');
});

test('MCP com header: chave não vai para a UI e não se perde ao salvar pela UI', async () => {
  const { bots } = await import('../server/db.ts');
  const url = 'https://exemplo.dev/mcp';
  hub.updateBot('nova', { mcp: [{ name: 'Conecta', url, headers: { 'x-chave': 'segredo' } }] });
  const pub: any = hub.publicBot(bots.get('nova')!);
  assert.equal(JSON.stringify(pub).includes('segredo'), false);
  hub.updateBot('nova', { mcp: pub.mcp }); // como a tela de editar bot envia
  assert.deepEqual(bots.get('nova')!.mcp, [{ name: 'conecta', url, headers: { 'x-chave': 'segredo' } }]);
});

test('fila: pedido em cima de outro aparece "Na fila" com o texto e pode sair antes de rodar', async () => {
  const { bots: bs, convs: cs, messages } = await import('../server/db.ts');
  cs.put({ id: 'fila', kind: 'bot', title: 'Fila', botIds: ['nova'], lastTs: 0 });
  const k = hub.runKey('nova', 'fila');
  hub.active.set(k, { botId: 'nova', convId: 'fila', depth: 0, chain: [], ac: new AbortController() }); // finge que está trabalhando
  const nova = bs.get('nova')!;
  const p = hub.runBot(nova, 'fila', 'x', { depth: 0, chain: [], label: 'resumir o relatório' });
  const q = hub.publicBot(nova).queue;
  assert.deepEqual(q.map(x => [x.convId, x.text]), [['fila', 'resumir o relatório']]);
  hub.cancelQueued(q[0].id);
  assert.equal(hub.publicBot(nova).queue.length, 0);
  assert.match(messages('fila', 1)[0].text, /tirado da fila/);
  assert.equal(await p, ''); // chegou a vez: pula sem rodar o motor
  hub.active.delete(k);
});

test('reações: bot reage com emoji à última msg do usuário, troca, tira e recusa texto', async () => {
  const { convs: cs, addMsg: add, react, messages } = await import('../server/db.ts');
  cs.put({ id: 'reac', kind: 'bot', title: 'Reac', botIds: ['nova'], lastTs: 0 });
  const u = add({ convId: 'reac', role: 'user', text: 'valeu!' });
  add({ convId: 'reac', role: 'bot', botId: 'nova', text: 'de nada' });
  assert.equal(react('reac', 'nova', '❤️').id, u.id); // padrão: última do usuário
  react('reac', 'atlas', '👍');
  react('reac', 'nova', '🎉'); // troca a dela, não duplica
  const meta = () => messages('reac').find(m => m.id === u.id)!.meta;
  assert.deepEqual(meta().reactions, [{ botId: 'atlas', emoji: '👍' }, { botId: 'nova', emoji: '🎉' }]);
  react('reac', 'atlas', '');
  assert.deepEqual(meta().reactions, [{ botId: 'nova', emoji: '🎉' }]);
  assert.throws(() => react('reac', 'nova', 'legal'), /emoji/);
  assert.throws(() => react('reac', 'nova', '👍', 999999), /não encontrada/);
});

test('respostas ricas: prévia de link (metas e bloqueio de rede local), checklist salva e guia no prompt', async () => {
  const pv = await import('../server/preview.ts');
  const m = pv.parseMeta(`<head><title>T</title><meta property="og:title" content="Nova regra &amp; app"><meta name="description" content="desc"><meta property="og:image" content="/img.png"><meta property="og:site_name" content="G1"></head>`, 'https://g1.globo.com/x');
  assert.deepEqual(m, { title: 'Nova regra & app', description: 'desc', image: 'https://g1.globo.com/img.png', site: 'G1' });
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.20.0.1', '169.254.1.1', '::1', 'fd00::1', '100.100.1.1']) assert.ok(pv.privateIp(ip), ip);
  assert.ok(!pv.privateIp('8.8.8.8'));
  await assert.rejects(pv.preview('http://127.0.0.1:8787/api/state'), /local/);
  await assert.rejects(pv.preview('file:///C:/x'), /http/);
  const { convs: cs, addMsg: add, setCheck, messages } = await import('../server/db.ts');
  cs.put({ id: 'rich', kind: 'bot', title: 'Rich', botIds: ['nova'], lastTs: 0 });
  const b = add({ convId: 'rich', role: 'bot', botId: 'nova', text: '- [ ] a\n- [ ] b' });
  setCheck(b.id, '0', true); setCheck(b.id, '6', false);
  assert.deepEqual(messages('rich').find(x => x.id === b.id)!.meta.checks, { '0': true, '6': false });
  assert.match(hub.system((await import('../server/db.ts')).bots.get('nova')!), /```formulario[\s\S]*```aprovar[\s\S]*OBRIGATÓRIO/);
});

test('agenda: erro passageiro do motor (modelo lotado) tenta de novo sozinho; erro comum não', async () => {
  const sc = await import('../server/schedule.ts');
  assert.ok(sc.transient('Selected model is at capacity. Please try a different model.'));
  assert.ok(sc.transient('HTTP 429 Too Many Requests') && sc.transient('503 Service Unavailable'));
  assert.ok(!sc.transient('pasta não existe') && !sc.transient('valor 5000 inválido'));
  const io = { ...sc.io }, retry = [...sc.RETRY_MIN];
  sc.RETRY_MIN.splice(0, 3, 0, 0, 0);
  let n = 0;
  sc.io.run = async () => { if (++n < 3) throw new Error('Selected model is at capacity.'); return 'Sem novas movimentações.'; };
  try {
    const s = sc.createSchedule({ botId: 'jarvis', title: 'Retry', prompt: 'monitorar', time: '07:00' });
    await sc.fire(s.id);
    assert.equal(n, 3);
    assert.equal(sc.schedules.get(s.id)!.runs[0].status, 'done');
    n = -10; sc.io.run = async () => { n++; throw new Error('pasta não existe'); };
    await sc.fire(s.id);
    assert.equal(n, -9); // erro comum: uma tentativa só
  } finally { Object.assign(sc.io, io); sc.RETRY_MIN.splice(0, 3, ...retry); }
});

test('complemento: msg nova com o bot trabalhando no seu pedido junta ao mesmo trabalho (sem fila de tarefa nova)', async () => {
  const { convs: cs, bots: bs, messages } = await import('../server/db.ts');
  cs.put({ id: 'steer', kind: 'bot', title: 'Steer', botIds: ['jarvis'], lastTs: 0 }); // jarvis = Claude: pausa e retoma
  const k = hub.runKey('jarvis', 'steer');
  const ac = new AbortController();
  hub.active.set(k, { botId: 'jarvis', convId: 'steer', depth: 0, chain: [], ac }); // finge que está no 1º pedido
  try {
    hub.send('steer', 'e inclua o PDF também');
    assert.equal((ac.signal.reason as any)?.steer, true); // turno atual pausado para juntar
    const q = hub.publicBot(bs.get('jarvis')!).queue;
    assert.equal(q.length, 1); // retomada com o complemento, logo atrás
    assert.equal(q[0].text, 'e inclua o PDF também');
    hub.cancelQueued(q[0].id); // não roda o motor no teste
    assert.equal(messages('steer').filter(m => m.role === 'user').length, 1);
    // tarefa delegada rodando nesta conversa: aí vai para a fila normal
    const ac2 = new AbortController();
    hub.active.set(k, { botId: 'jarvis', convId: 'steer', taskId: 99, depth: 1, chain: [], ac: ac2 });
    hub.send('steer', 'outra coisa');
    assert.equal(ac2.signal.aborted, false);
    hub.cancelQueued(hub.publicBot(bs.get('jarvis')!).queue[0].id);
  } finally { hub.active.delete(k); }
  await new Promise(r => setTimeout(r, 20));
});

test('reserva: modelo no limite segue no outro motor (Codex→Opus 5.5, Claude→GPT-6.1-Sol) e pula direto por 15 min', async () => {
  const { convs: cs, messages, bots: bs } = await import('../server/db.ts');
  assert.ok(hub.isLimit('Selected model is at capacity.') && hub.isLimit("You've hit your usage limit") && hub.isLimit('HTTP 429') && hub.isLimit('Overloaded'));
  assert.ok(!hub.isLimit('pasta não existe'));
  const orig = { ...hub.motors }, calls: string[] = [];
  const ok = (who: string) => async function* (o: any) { calls.push(`${who}:${o.model}`); yield { k: 'final', text: `resposta ${who}` } as any; };
  const lot = (who: string) => async function* (o: any) { calls.push(`${who}:${o.model}`); throw new Error('Selected model is at capacity.'); };
  cs.put({ id: 'fb', kind: 'bot', title: 'Fb', botIds: ['atlas'], lastTs: 0 }); // atlas = Codex
  try {
    hub.motors.codex = lot('codex') as any; hub.motors.claude = ok('claude') as any;
    assert.equal(await hub.runBot(bs.get('atlas')!, 'fb', 'oi'), 'resposta claude');
    assert.deepEqual(calls, [`codex:${bs.get('atlas')!.model}`, 'claude:opus']);
    const m = messages('fb').at(-1)!;
    assert.deepEqual([m.meta.engine, m.meta.model, m.meta.fallback], ['claude', 'opus', true]);
    calls.length = 0;
    await hub.runBot(bs.get('atlas')!, 'fb', 'de novo');
    assert.deepEqual(calls, ['claude:opus']); // dentro de 15 min: vai direto para a reserva
    // Claude no limite → Codex GPT-6.1-Sol
    hub.motors.claude = lot('claude') as any; hub.motors.codex = ok('codex') as any; calls.length = 0;
    cs.put({ id: 'fb2', kind: 'bot', title: 'Fb2', botIds: ['nova'], lastTs: 0 }); // nova = Claude haiku
    assert.equal(await hub.runBot(bs.get('nova')!, 'fb2', 'oi'), 'resposta codex');
    assert.deepEqual(calls, ['claude:haiku', 'codex:gpt-6.1-sol']);
    // erro comum não troca de motor
    hub.motors.claude = (async function* () { throw new Error('pasta não existe'); }) as any;
    cs.put({ id: 'fb3', kind: 'bot', title: 'Fb3', botIds: ['jarvis'], lastTs: 0 });
    await assert.rejects(hub.runBot(bs.get('jarvis')!, 'fb3', 'oi'), /pasta/);
  } finally { Object.assign(hub.motors, orig); }
});

test('avatar com cor: "atlas#A855F7" é aceito e normalizado; cor inválida ou avatar inexistente caem no padrão', async () => {
  const { bots: bs } = await import('../server/db.ts');
  assert.equal(hub.updateBot('atlas', { avatar: 'atlas#A855F7' }).avatar, 'atlas#a855f7');
  assert.equal(hub.updateBot('atlas', { avatar: 'atlas#xyz' }).avatar, 'atlas');
  assert.equal(hub.updateBot('atlas', { avatar: 'dragao#ff0000' }).avatar, 'orion');
  hub.updateBot('atlas', { avatar: 'atlas' });
  assert.equal(bs.get('atlas')!.avatar, 'atlas');
});

test('cofre: senha criptografada, nunca exposta na lista; pedido no chat espera a resposta; memória recusa senha', async () => {
  const v = await import('../server/vault.ts');
  const { readFileSync } = await import('node:fs');
  const { DATA, convs: cs, messages } = await import('../server/db.ts');
  const s = v.vault.save({ name: 'Workana', site: 'https://www.workana.com/login', username: 'eu@x.com', password: 'S3nh@Forte!', botIds: ['atlas'] });
  assert.deepEqual([s.site, s.username, (s as any).enc], ['workana.com', 'eu@x.com', undefined]);
  assert.ok(!readFileSync(`${DATA}/vault.json`, 'utf8').includes('S3nh@Forte!')); // criptografada no disco
  assert.equal(v.vault.list('atlas').length, 1); assert.equal(v.vault.list('nova').length, 0); // só do bot liberado
  assert.equal(v.vault.reveal(v.vault.find('atlas', 'workana')!), 'S3nh@Forte!');
  assert.ok(v.siteMatch('app.workana.com', 'workana.com') && !v.siteMatch('workana.com.evil.io', 'workana.com'));
  assert.ok(v.hasSecret('Login: eu@x.com / senha abc12345') && v.hasSecret('password: abc123') && !v.hasSecret('O usuário prefere respostas curtas'));
  cs.put({ id: 'ask', kind: 'bot', title: 'Ask', botIds: ['atlas'], lastTs: 0 });
  const { msg, result } = v.ask<{ ok: boolean }>({ convId: 'ask', botId: 'atlas', text: '🙋 precisa de você', meta: { kind: 'takeover' } }, 60_000);
  assert.equal(v.askMeta(msg.meta.req)!.kind, 'takeover');
  v.answer(msg.meta.req, 'done', { ok: true });
  assert.deepEqual(await result, { ok: true });
  assert.equal(messages('ask').at(-1)!.meta.status, 'done');
  assert.throws(() => v.answer(msg.meta.req, 'done', {}), /expirou/);
  v.vault.del(s.id); assert.equal(v.vault.list().length, 0);
});

test('subagente: tarefa avulsa no mesmo motor, sem navegador nem MCP; no limite usa a reserva', async () => {
  const { bots: bs } = await import('../server/db.ts');
  const orig = { ...hub.motors }, seen: any[] = [];
  hub.motors.codex = (async function* (o: any) { seen.push(o); throw new Error('Selected model is at capacity.'); }) as any;
  hub.motors.claude = (async function* (o: any) { seen.push(o); yield { k: 'final', text: 'resumo pronto' } as any; }) as any;
  try {
    hub.updateBot('atlas', { tools: ['browser', 'web'] });
    assert.equal(await hub.subagent('atlas', 'ask', 'resuma X'), 'resumo pronto');
    assert.deepEqual(seen.map(o => [o.model, o.mcp.length, o.tools.includes('browser'), o.sid]), [[bs.get('atlas')!.model, 0, false, undefined], ['opus', 0, false, undefined]]);
  } finally { Object.assign(hub.motors, orig); }
});

test('design: liga as skills na pasta do bot (Codex .agents, Claude .claude) e desliga sem apagar data/skills', async () => {
  const { mkdirSync, writeFileSync, existsSync, lstatSync } = await import('node:fs');
  const { join } = await import('node:path');
  mkdirSync(join(hub.SKILLS_DIR, 'pptx'), { recursive: true }); writeFileSync(join(hub.SKILLS_DIR, 'pptx', 'SKILL.md'), '---\nname: pptx\n---');
  const b = hub.updateBot('nova', { tools: ['files', 'design'] });
  hub.linkSkills(b);
  for (const d of ['.agents', '.claude']) assert.ok(existsSync(join(hub.botDir('nova'), d, 'skills', 'pptx', 'SKILL.md')), d);
  assert.match(hub.system(b), /Design e documentos[\s\S]*office_to_pdf/);
  hub.linkSkills(hub.updateBot('nova', { tools: ['files'] }));
  assert.ok(!existsSync(join(hub.botDir('nova'), '.agents', 'skills')));
  assert.ok(existsSync(join(hub.SKILLS_DIR, 'pptx', 'SKILL.md'))); // origem intacta
  assert.doesNotMatch(hub.system(hub.updateBot('nova', { tools: ['files'] })), /Design e documentos/);
  void lstatSync;
});

test('ditado: refino tem glossário com os bots e desliga pela configuração', async () => {
  const stt = await import('../server/stt.ts');
  const cfg = await import('../server/settings.ts');
  assert.ok(stt.glossary().includes('Atlas') && stt.glossary().includes('Codex'));
  assert.match(stt.REFINE_SYS, /NÃO responda ao conteúdo/);
  const prev = cfg.settings.sttRefine; cfg.settings.sttRefine = false;
  try { assert.equal(await stt.refine('texto qualquer'), 'texto qualquer'); } finally { cfg.settings.sttRefine = prev; }
});
