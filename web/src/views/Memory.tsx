import { useEffect, useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { Empty, MenuBtn, Skel, nameOf } from '@/components/bits'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { act, api, confirmAsk, openConv, set, toast, useStore } from '@/store'
import { btn2, cn, dayMonth, field } from '@/lib/utils'
import type { Fact, Graph, Msg } from '@/types'

type Found = { facts: Fact[]; messages: Msg[]; notes: { name: string; snippet: string }[] }

const trig = 'h-9 flex-none rounded-full border-0 px-4 text-[13.5px] font-medium text-t2 transition-colors hover:text-foreground focus-visible:ring-0 focus-visible:outline-none data-[state=active]:glass-btn data-[state=active]:text-foreground data-[state=active]:shadow-none'
const card = 'panel-card flex flex-col gap-3 p-5'

export function Memory() {
  const bots = useStore((s) => s.bots)
  const tick = useStore((s) => s.factsTick)
  const [q, setQ] = useState('')
  const [facts, setFacts] = useState<Fact[] | null>(null)
  const [found, setFound] = useState<Found | null>(null)
  const [graph, setGraph] = useState<Graph | null>(null)
  const [tab, setTab] = useState('facts')
  const [newFact, setNewFact] = useState('')

  const loadFacts = () => api<Fact[]>('/api/memory/facts').then((f) => setFacts(f || [])).catch(() => {})
  const loadGraph = () => api<Graph>('/api/memory/graph').then(setGraph).catch(() => {})
  useEffect(() => { loadFacts() }, [tick])
  useEffect(() => { loadGraph() }, [])
  useEffect(() => { // enquanto o servidor atualiza o grafo em lote, confere de tempos em tempos
    if (!graph?.running) return
    const t = setInterval(loadGraph, 5000)
    return () => clearInterval(t)
  }, [graph?.running])
  const search = () => api<Found>('/api/memory/search?q=' + encodeURIComponent(q.trim())).then(setFound).catch((e: Error) => toast(e.message))
  useEffect(() => { // busca com atraso
    if (!q.trim()) return setFound(null)
    const t = setTimeout(search, 350)
    return () => clearTimeout(t)
  }, [q])

  const shown = (found ? found.facts : facts ?? []).slice().sort((a, b) => +a.obsolete - +b.obsolete || +!!b.pinned - +!!a.pinned || b.ts - a.ts)
  const byId = (id?: string | number) => facts?.find((f) => f.id === id)

  async function addFact() {
    if (!newFact.trim()) return
    if (await act(api('/api/memory/facts', 'POST', { text: newFact.trim() })) !== undefined) { setNewFact(''); loadFacts() }
  }
  async function pin(id: string | number, pinned: boolean) {
    if (await act(api('/api/memory/facts/' + id, 'PATCH', { pinned })) !== undefined) { loadFacts(); if (q.trim()) search() }
  }
  async function obsolete(id: string | number, hard = false) {
    if (hard && !(await confirmAsk({ title: 'Apagar este fato de vez?', body: 'Some da memória e da busca. Não dá para desfazer.', ok: 'Apagar', danger: true }))) return
    if (await act(api('/api/memory/facts/' + id + (hard ? '?hard' : ''), 'DELETE')) !== undefined) { loadFacts(); if (q.trim()) search() }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-6 px-4 pb-[calc(2rem+var(--sab))] pt-3 md:px-10 md:py-8">
        <header className="mx-auto flex w-full max-w-[760px] flex-col items-center gap-4 text-center">
          <div className="grid w-full grid-cols-[2.75rem_1fr_2.75rem] items-center md:block"><MenuBtn /><span className="text-[15px] font-semibold md:hidden">Memória</span></div>
          <h1 className="m-0 text-[28px] font-semibold leading-tight tracking-[-0.03em] md:text-[36px]">O que a equipe sabe?</h1>
          <p className="-mt-1 m-0 max-w-[46ch] text-[14.5px] leading-relaxed text-t2">Fatos que os bots lembram, o grafo de conhecimento e o histórico das conversas.</p>
          <label className="glass mt-1 flex h-14 w-full items-center gap-3 rounded-full px-5 text-t2 transition-[border-color,box-shadow] duration-200 focus-within:!border-brand/50 focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.1)]">
            <Search size={18} strokeWidth={1.6} />
            <input type="search" aria-label="Buscar na memória" placeholder="Buscar em fatos, conversas e notas" value={q} onChange={(e) => setQ(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground" />
          </label>
        </header>

        <Tabs value={tab} onValueChange={setTab} className="mx-auto w-full max-w-[1100px] gap-6">
          <TabsList className="mx-auto h-auto gap-1 rounded-full border border-white/[0.07] bg-white/[0.03] p-1">
            <TabsTrigger value="facts" className={trig}>Fatos</TabsTrigger>
            <TabsTrigger value="graph" className={trig}>Grafo</TabsTrigger>
            <TabsTrigger value="history" className={trig}>Histórico</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap gap-6">
            <div className="min-w-0 flex-[1.4_1_420px]">
              <TabsContent value="facts" className="flex flex-col">
                <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addFact() }}>
                  <input className={cn(field, '!rounded-full !py-2')} placeholder="Anotar um fato para a equipe lembrar" value={newFact} onChange={(e) => setNewFact(e.target.value)} />
                  <button type="submit" className={btn2} disabled={!newFact.trim()}><Plus size={15} />Adicionar</button>
                </form>
                {facts === null && !found && [0, 1, 2, 3].map((i) => <Skel key={i} className="my-2 h-14" />)}
                {facts !== null && !shown.length && (found ? <p className="py-4 text-t3">Nenhum fato encontrado.</p>
                  : <Empty avatars={['jarvis', 'lira']} title="A equipe ainda não lembra de nada" text="Peça “Lembre que…” no chat ou anote um fato acima. Os bots consultam esta memória antes de responder." />)}
                {shown.map((f) => (
                  <article key={f.id} className="rise group flex flex-col gap-1.5 border-b border-white/[0.06] px-2 py-4 transition-colors last:border-0 hover:bg-white/[0.02] md:px-3">
                    <span className={cn('whitespace-pre-wrap break-words text-[15px] leading-relaxed text-t1', f.obsolete && 'text-t3 line-through')}>{f.text}</span>
                    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-t3">
                      {f.pinned && !f.obsolete && <span className="rounded-full bg-[#93c5fd]/15 px-2 py-0.5 text-[#93c5fd]">Permanente</span>}
                      {f.obsolete ? 'Obsoleto' : nameOf(bots, f.botId)} · {dayMonth(f.ts)}
                      {f.obsolete && byId(f.replacedBy) && <> · substituído por “{byId(f.replacedBy)!.text.slice(0, 40)}”</>}
                      {(f.source.convId || f.source.taskId != null) && <> · <button type="button" className="text-[#93c5fd] underline decoration-[#93c5fd]/40 underline-offset-2" onClick={() => f.source.convId ? openConv(f.source.convId) : set({ view: 'tasks', taskSel: f.source.taskId! })}>origem</button></>}
                      {!f.obsolete && <button type="button" title="Regra permanente vai no topo de todo pedido, para todos os bots" className="ml-auto rounded-full px-2 py-0.5 text-t2 opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100" onClick={() => pin(f.id, !f.pinned)}>{f.pinned ? 'Desafixar' : 'Tornar permanente'}</button>}
                      {!f.obsolete && <button type="button" className="rounded-full px-2 py-0.5 text-t2 opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100" onClick={() => obsolete(f.id)}>Marcar obsoleto</button>}
                      {f.obsolete && <button type="button" className="ml-auto rounded-full px-2 py-0.5 text-bad opacity-0 transition-opacity hover:bg-white/[0.06] focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100" onClick={() => obsolete(f.id, true)}>Apagar</button>}
                    </span>
                  </article>
                ))}
                {!!found?.notes.length && (
                  <div className="mt-5 flex flex-col gap-1">
                    <h2 className="m-0 mb-1 text-xs font-medium text-t3">Notas</h2>
                    {found.notes.map((n) => (
                      <div key={n.name} className="flex flex-col gap-1 border-b border-white/[0.06] px-1 py-3"><span className="font-medium">{n.name}</span><span className="text-[13px] text-t2">{n.snippet}</span></div>
                    ))}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="graph"><GraphView graph={graph} reload={loadGraph} /></TabsContent>
              <TabsContent value="history" className="flex flex-col">
                {!found && <p className="py-4 text-t3">Busque acima para ver trechos de conversas.</p>}
                {found && !found.messages.length && <p className="py-4 text-t3">Nenhuma mensagem encontrada.</p>}
                {found?.messages.map((m) => (
                  <article key={m.id} className="flex flex-col gap-1.5 border-b border-white/[0.06] px-1 py-4">
                    <span className="line-clamp-4 whitespace-pre-wrap leading-normal">{m.text}</span>
                    <span className="text-xs text-t3">{m.role === 'user' ? 'Você' : nameOf(bots, m.botId ?? '')} · {dayMonth(m.ts)} · <button type="button" className="text-[#93c5fd] underline decoration-[#93c5fd]/40 underline-offset-2" onClick={() => openConv(m.convId)}>abrir conversa</button></span>
                  </article>
                ))}
              </TabsContent>
            </div>
            <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4"><Inbox /><Review items={graph?.review ?? []} /></aside>
          </div>
        </Tabs>
      </div>
    </div>
  )
}

const PALETTE = ['#60a5fa', '#22d3ee', '#FCFCFC', '#22C55E', '#FF6A1A', '#F2B33D', '#8F8D88']

// layout de forças simples, calculado uma vez por grafo
function layout(g: Graph, W: number, H: number) {
  const n = g.nodes.length
  const idx = new Map(g.nodes.map((x, i) => [x.id, i]))
  const p = g.nodes.map((_, i) => ({ x: W / 2 + Math.cos(i * 2.4) * Math.sqrt(i + 1) * 14, y: H / 2 + Math.sin(i * 2.4) * Math.sqrt(i + 1) * 14, vx: 0, vy: 0 }))
  const E = g.edges.map((e) => [idx.get(e.source), idx.get(e.target)] as const).filter((e): e is readonly [number, number] => e[0] != null && e[1] != null)
  for (let it = 0; it < 250; it++) {
    const cool = 1 - it / 250
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = p[i].x - p[j].x, dy = p[i].y - p[j].y
      const d2 = Math.max(dx * dx + dy * dy, 0.5), d = Math.sqrt(d2), f = 1400 / d2
      p[i].vx += (dx / d) * f; p[i].vy += (dy / d) * f; p[j].vx -= (dx / d) * f; p[j].vy -= (dy / d) * f
    }
    for (const [a, b] of E) {
      const dx = p[b].x - p[a].x, dy = p[b].y - p[a].y, d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.5), f = (d - 80) * 0.03
      p[a].vx += (dx / d) * f; p[a].vy += (dy / d) * f; p[b].vx -= (dx / d) * f; p[b].vy -= (dy / d) * f
    }
    for (const q of p) {
      q.vx += (W / 2 - q.x) * 0.004; q.vy += (H / 2 - q.y) * 0.004
      q.x += q.vx * 0.5 * cool; q.y += q.vy * 0.5 * cool; q.vx *= 0.6; q.vy *= 0.6
    }
  }
  // encaixa tudo na área visível
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const fit = (v: number, a: number, b: number, m: number, size: number) => (b - a < 1 ? size / 2 : m + ((v - a) / (b - a)) * (size - 2 * m))
  return p.map((q) => ({ x: fit(q.x, x0, x1, 50, W), y: fit(q.y, y0, y1, 30, H) }))
}

function GraphView({ graph, reload }: { graph: Graph | null; reload: () => void }) {
  const W = 800, H = 520
  const pos = useMemo(() => (graph?.nodes.length ? layout(graph, W, H) : []), [graph])
  const comms = useMemo(() => [...new Set(graph?.nodes.map((n) => String(n.community ?? '')))], [graph])
  const upd = graph?.updatedAt
  const when = upd ? new Date(typeof upd === 'number' && upd < 1e12 ? upd * 1000 : upd).toLocaleString('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  const at = new Map(graph?.nodes.map((n, i) => [n.id, pos[i]]))

  async function update() {
    if (await act(api('/api/memory/graph/update', 'POST')) !== undefined) { toast('Atualização do grafo iniciada. Ela roda em lote.'); setTimeout(reload, 3000) }
  }
  return (
    <section aria-label="Grafo" className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-sm font-semibold">Grafo</h2>
        <span className="text-xs text-t3">{when && `atualizado ${when}`}</span>
        <button type="button" className={cn(btn2, 'ml-auto h-8 text-[13px]')} disabled={graph?.running} onClick={update}>{graph?.running ? 'Atualizando…' : 'Atualizar grafo'}</button>
      </div>
      {graph?.nodes.length ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Grafo de conhecimento">
          {graph.edges.map((e, i) => {
            const a = at.get(e.source), b = at.get(e.target)
            if (!a || !b) return null
            return (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#FCFCFC" strokeOpacity={e.confidence === 'EXTRACTED' ? 0.25 : 0.4}
                strokeDasharray={e.confidence === 'EXTRACTED' ? undefined : e.confidence === 'INFERRED' ? '5 4' : '1.5 4'}><title>{`${e.relation} (${e.confidence})`}</title></line>
            )
          })}
          {graph.nodes.map((n, i) => (
            <g key={n.id}>
              <circle cx={pos[i].x} cy={pos[i].y} r={6} fill={PALETTE[comms.indexOf(String(n.community ?? '')) % PALETTE.length]} />
              <text x={pos[i].x} y={pos[i].y + 18} textAnchor="middle" fontSize={11} fill="#e7e7ea" paintOrder="stroke" stroke="#0a0a0b" strokeWidth={3}>{n.label}</text>
            </g>
          ))}
        </svg>
      ) : <p className="py-6 text-center text-t3">O grafo ainda está vazio. Adicione notas na Inbox e atualize.</p>}
      <span className="text-xs text-t3">Linha cheia: extraído · tracejada: inferido ou ambíguo</span>
    </section>
  )
}

function Inbox() {
  const [txt, setTxt] = useState('')
  const [path, setPath] = useState('')
  const [over, setOver] = useState(false)

  async function files(list: File[]) {
    let ok = 0
    for (const f of list) if (await act(api('/api/memory/inbox?name=' + encodeURIComponent(f.name), 'POST', f)) !== undefined) ok++
    if (ok) toast(`${ok} arquivo${ok > 1 ? 's' : ''} na inbox`)
  }
  async function text() {
    const t = txt.trim()
    if (!t) return
    const body = /^https?:\/\/\S+$/i.test(t) ? { url: t } : { name: `nota-${Date.now()}.md`, text: t }
    if (await act(api('/api/memory/inbox', 'POST', body)) !== undefined) { setTxt(''); toast('Enviado para a inbox') }
  }
  async function obsidian() {
    const r = await act(api<{ path: string }>('/api/memory/obsidian', 'POST'))
    if (r) setPath(r.path)
  }
  return (
    <section aria-label="Inbox" className={card}>
      <h2 className="m-0 text-sm font-semibold">Inbox</h2>
      <label className={cn('flex cursor-pointer flex-col items-center gap-1.5 rounded-[18px] border border-dashed px-3 py-5 text-center text-t2 transition-colors', over ? 'border-brand/60 bg-brand/[0.06]' : 'border-white/[0.16] hover:border-white/30')}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false)
          if (e.dataTransfer.files.length) files([...e.dataTransfer.files])
          else { const u = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'); if (u) api('/api/memory/inbox', 'POST', { url: u.trim() }).then(() => toast('Link na inbox')).catch((x: Error) => toast(x.message)) }
        }}>
        <span className="text-foreground">Solte notas, PDFs ou links</span>
        <span className="text-xs">Entram no grafo na próxima atualização</span>
        <input type="file" multiple className="sr-only" onChange={(e) => { files([...(e.target.files ?? [])]); e.target.value = '' }} />
      </label>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); text() }}>
        <input className={cn(field, '!rounded-full !py-2 text-[13px]')} placeholder="Colar link ou escrever nota" value={txt} onChange={(e) => setTxt(e.target.value)} />
        <button type="submit" className={cn(btn2, 'h-9')} disabled={!txt.trim()}>Enviar</button>
      </form>
      <button type="button" className={cn(btn2, 'h-9 text-[13px]')} onClick={obsidian}>Exportar para Obsidian</button>
      {path && <span className="break-all text-xs text-t3">Exportado para {path}</span>}
    </section>
  )
}

function Review({ items }: { items: string[] }) {
  return (
    <section aria-label="Para revisar" className={card}>
      <h2 className="m-0 text-sm font-semibold">Para revisar</h2>
      {!items.length && <span className="text-t3">Nada para revisar.</span>}
      {items.map((r, i) => (
        <span key={i} className="flex gap-2.5 break-words leading-snug"><span className="mt-1.5 size-[7px] shrink-0 rounded-full bg-warn" />{r}</span>
      ))}
    </section>
  )
}
