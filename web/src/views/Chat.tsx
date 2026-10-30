import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Popover } from 'radix-ui'
import {
  AlertCircle, ArrowDown, ArrowUp, Brain, Camera, Check, ChevronDown, ChevronRight, FilePen, FileText, Globe, Keyboard,
  ListChecks, Loader2, Mic, Target, Trash2, Paperclip, Reply, Settings, X,MousePointerClick, Network, Newspaper, Plus, RotateCcw, Search, Sparkles, Square, Terminal, UserRound, Users, Wrench, type LucideIcon,
  FolderOpen,
  MoreHorizontal,
} from 'lucide-react'
import { Avatar, Orb } from '@/components/Avatar'
import { CopyBtn, Markdown, botFiles } from '@/components/Markdown'
import { FileGrid, FileViewer, checkFiles, type FileRef } from '@/components/FilePreview'
import { SecretAsk, TakeoverAsk } from '@/components/Asks'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DRAFT, MsgCtx } from '@/components/RichBlocks'
import { Dot, Dropdown, EFFORTS, MenuBtn, Rich, Seg, Skel, TASK_STATUS, Tip, effortName, engineName, modelName, nameOf, taskTime, toolName, useMedia, useNow } from '@/components/bits'
import { Computer } from '@/views/Computer'
import { act, api, askDelete, closeMission, putBot, retry, send, set, startConv, stopConv, toast, useStore } from '@/store'
import { recMime, startLiveStt, toWav16k } from '@/lib/audio'
import { cn, dayLabel, dur, greeting, hhmm, roundBtn, size } from '@/lib/utils'
import type { ActivityItem, Att, Bot, Conv, Effort, Msg, Task } from '@/types'

// chips da tela inicial: rótulo curto + pedido completo
const SUGGESTIONS: [LucideIcon, string, string][] = [
  [Newspaper, 'Manchetes do dia', 'Abra g1.globo.com e me traga as 3 manchetes'],
  [Search, 'Novidades de IA', 'Pesquise as novidades de IA desta semana e resuma em 5 tópicos'],
  [ListChecks, 'Planejar a semana', 'Me ajude a planejar minha semana: pergunte o que preciso fazer e monte uma lista por dia'],
  [UserRound, 'O que sabe de mim?', 'O que você sabe sobre mim?'],
  [Brain, 'Lembrar preferência', 'Lembre que prefiro respostas curtas e diretas'],
  [Users, 'Montar equipe', 'Sugira 3 bots especialistas para a minha equipe e o trabalho de cada um'],
  [Globe, 'Pesquisar um site', 'Abra um site que eu indicar e me resuma o conteúdo principal'],
  [Sparkles, 'Ideias de conteúdo', 'Me dê 5 ideias de posts para redes sociais sobre o meu trabalho'],
]

export function Chat() {
  const conv = useStore((s) => s.convs.find((c) => c.id === s.convId))
  const bots = useStore((s) => s.bots)
  const tasks = useStore((s) => s.tasks)
  const selBot = useStore((s) => s.selBot)
  const panel = useStore((s) => s.panel)
  const msgs = useStore((s) => (conv ? s.msgs[conv.id] : undefined))
  const deltas = useStore((s) => (conv ? s.deltas[conv.id] : undefined))
  const activity = useStore((s) => s.activity)
  const wide = useMedia('(min-width:1280px)')
  const chief = bots.find((b) => b.isChief) ?? bots[0]

  // bots envolvidos: os da conversa + quem recebeu tarefa dela (ex.: Jarvis delegou ao Atlas)
  const involved = useMemo(() => {
    if (!conv) return chief ? [chief] : []
    const ids = [...new Set([...conv.botIds, ...tasks.filter((t) => t.convId === conv.id).map((t) => t.assignee)])]
    return ids.map((id) => bots.find((b) => b.id === id)).filter((b): b is Bot => !!b)
  }, [conv, bots, tasks, chief])
  // trabalhando NESTA conversa (o mesmo bot pode estar ocupado em outra, em paralelo)
  const busyHere = (b: Bot) => !!conv && !!b.busyIn?.includes(conv.id)
  const activeId = selBot ?? involved.find(busyHere)?.id ?? involved.find((b) => b.tools.includes('browser'))?.id ?? involved[0]?.id
  // bot da pílula e da engrenagem: na conversa com um bot é sempre o dono dela (quem ele chamou por delegação não toma o lugar)
  const owner = conv?.kind === 'bot' ? bots.find((b) => b.id === conv.botIds[0]) : undefined
  const headBot = owner ?? involved.find((b) => b.isChief) ?? involved[0]
  const working = involved.filter(busyHere)
  const busy = working.length > 0
  const now = useNow(busy)
  // navegador "em uso": bot com navegador trabalhando e com ação de navegador nos últimos 20s → ícone pisca
  const browsing = working.find((b) => b.tools.includes('browser') &&
    (activity[b.id] ?? []).some((a) => now - a.ts < 20_000 && (!a.convId || a.convId === conv?.id) && (a.kind === 'nav' || /(^|__)browser_|^(clicar|digitar|ler texto|snapshot|screenshot)/.test(a.text))))
  const lastUser = msgs ? [...msgs].reverse().find((m) => m.role === 'user') : undefined
  const all = useMemo(() => convFiles(msgs ?? []), [msgs])
  const gone = useStore((s) => s.gone)
  const files = useMemo(() => all.filter((f) => !gone[f.url]), [all, gone]) // contador sem os apagados
  const allKey = all.map((f) => f.url).join('|')
  useEffect(() => { if (all.length) checkFiles(all.map((f) => f.url)) }, [allKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [art, setArt] = useState(false)
  useEffect(() => setArt(false), [conv?.id])
  const empty = !conv || (msgs !== undefined && !msgs.length && !busy && !tasks.some((t) => t.convId === conv.id))
  const submit = (t: string, files: File[] = []) => (conv ? send(conv.id, t, files) : chief && startConv(chief.id, t, files))
  // arrastar arquivo para qualquer ponto da conversa: mostra o aviso e, ao soltar, vira anexo no composer
  const [drag, setDrag] = useState(false)
  const depth = useRef(0)
  // busca dentro da conversa (lupa no cabeçalho, "…" no celular ou Ctrl F)
  const [find, setFind] = useState(false)
  useEffect(() => setFind(false), [conv?.id])
  useEffect(() => {
    if (!conv || empty) return
    const f = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setFind(true); setTimeout(() => document.getElementById('gb-find')?.focus(), 0) } }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [conv?.id, empty])
  const isFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files')

  return (
    <div className="flex min-h-0 flex-1">
      <section aria-label="Conversa" className="relative flex min-w-0 flex-1 flex-col"
        onDragEnter={(e) => { if (!isFiles(e) || !chief) return; e.preventDefault(); depth.current++; setDrag(true) }}
        onDragOver={(e) => { if (isFiles(e) && chief) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
        onDragLeave={(e) => { if (isFiles(e) && --depth.current <= 0) { depth.current = 0; setDrag(false) } }}
        onDrop={(e) => {
          if (!isFiles(e)) return
          e.preventDefault(); depth.current = 0; setDrag(false)
          if (e.dataTransfer.files.length) dispatchEvent(new CustomEvent(ATTACH, { detail: [...e.dataTransfer.files] }))
        }}>
        {drag && (
          <div aria-hidden="true" className="fade pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-3 rounded-[28px] border-2 border-dashed border-brand/60 bg-black/75 text-center backdrop-blur-sm md:inset-4">
            <span className="bg-grad pop inline-flex size-16 items-center justify-center rounded-full"><Paperclip size={26} /></span>
            <span className="text-[18px] font-semibold">Solte para anexar</span>
            <span className="text-[13px] text-t2">Até 10 arquivos de 25 MB · imagens, PDFs, textos e mais</span>
          </div>
        )}
        {/* cabeçalho flutuante: botões de vidro nas pontas e a pílula do bot no centro */}
        <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-[80px] items-center gap-2 bg-[linear-gradient(to_bottom,#000_0%,#000_52%,rgba(0,0,0,0.75)_76%,transparent)] pb-2 px-3 md:px-5 [&>*]:pointer-events-auto">
          <div className="flex shrink-0 items-center md:min-w-[148px]"><MenuBtn /></div>
          <div className="flex min-w-0 flex-1 justify-center"><ChatTitle conv={conv} lead={headBot} working={working} since={lastUser?.ts} now={now} /></div>
          <div className="flex shrink-0 items-center justify-end gap-2 md:min-w-[148px]">
            {involved.length > 1 && (
              <span className="mr-1 hidden -space-x-2 lg:flex">
                {involved.map((b) => (
                  <Tip key={b.id} label={`Computador de ${b.name}`} side="bottom">
                    <button type="button" aria-label={`Ver computador de ${b.name}`} onClick={() => set({ selBot: b.id, panel: true })}
                      className={cn('rounded-full bg-black p-0.5 transition-transform duration-200 hover:z-10 hover:-translate-y-0.5', activeId === b.id && panel && 'ring-1 ring-brand/60')}>
                      <Avatar bot={b.avatar} size={26} working={busyHere(b)} />
                    </button>
                  </Tip>
                ))}
              </span>
            )}
            {conv && !empty && files.length > 0 && (
              <Tip label="Arquivos desta conversa" side="bottom">
                <button type="button" aria-label={`Arquivos desta conversa (${files.length})`} onClick={() => setArt(true)} className={cn(roundBtn, 'relative hidden size-11 md:inline-flex')}>
                  <FolderOpen size={18} strokeWidth={1.8} />
                  <span className="absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10.5px] font-semibold tabular-nums text-white">{files.length}</span>
                </button>
              </Tip>
            )}
            {conv && !empty && (
              <Tip label={<>Buscar na conversa <kbd>Ctrl F</kbd></>} side="bottom">
                <button type="button" aria-label="Buscar na conversa" aria-pressed={find} onClick={() => setFind(!find)}
                  className={cn(roundBtn, 'hidden size-11 md:inline-flex', find && 'text-[#93c5fd]')}><Search size={18} strokeWidth={1.8} /></button>
              </Tip>
            )}
            {/* celular: Buscar e Arquivos num menu só, para a pílula do bot caber */}
            {conv && !empty && (
              <Dropdown trigger={<button type="button" aria-label="Mais opções da conversa" className={cn(roundBtn, 'relative size-10 md:hidden')}><MoreHorizontal size={18} />{files.length > 0 && <span aria-hidden="true" className="absolute right-1 top-1 size-2 rounded-full bg-brand" />}</button>} items={[
                { label: 'Buscar na conversa', icon: <Search />, onSelect: () => setFind(true) },
                ...(files.length ? [{ label: `Arquivos (${files.length})`, icon: <FolderOpen />, onSelect: () => setArt(true) }] : []),
              ]} />
            )}
            <Artifacts files={files} open={art} onOpenChange={setArt} />
            {activeId && (
              <Tip label={browsing ? `${browsing.name} está usando o navegador` : panel ? 'Minimizar navegador' : 'Abrir navegador'} side="bottom">
                <button type="button" aria-pressed={panel}
                  aria-label={browsing ? `Navegador em uso por ${browsing.name}: ${panel ? 'minimizar' : 'abrir'}` : panel ? 'Minimizar navegador' : 'Abrir navegador'}
                  className={cn(roundBtn, 'relative size-10 md:size-11', panel && 'text-[#93c5fd]', browsing && !panel && 'animate-pulse')}
                  onClick={() => { if (browsing && !panel) set({ selBot: browsing.id }); set({ panel: !panel }) }}>
                  <Globe size={18} strokeWidth={1.7} />
                  {browsing && <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-live ring-2 ring-black" />}
                </button>
              </Tip>
            )}
            {conv?.kind === 'mission' ? (
              <Dropdown trigger={<button type="button" aria-label="Opções da missão" className={cn(roundBtn, 'size-10 md:size-11')}><Settings size={18} strokeWidth={1.8} /></button>} items={[
                ...(conv.mission?.status !== 'closed' ? [{ label: 'Encerrar missão', icon: <Target />, onSelect: () => closeMission(conv.id) }] : []),
                { label: 'Apagar missão', icon: <Trash2 />, danger: true, onSelect: () => askDelete(conv) },
              ]} />
            ) : headBot && (
              <Tip label={`Configurações do ${headBot.name}`} side="bottom">
                <button type="button" aria-label={`Configurações do ${headBot.name}`} onClick={() => set({ botDialog: headBot.id })}
                  className={cn(roundBtn, 'size-10 md:size-11')}><Settings size={18} strokeWidth={1.8} /></button>
              </Tip>
            )}
          </div>
        </header>
        {empty
          ? <Welcome conv={conv} bots={bots} chief={chief} onSend={submit} busy={busy} />
          : <>
            {find && conv && <FindBar key={conv.id} count={msgs?.length ?? 0} onClose={() => setFind(false)} />}
            <Timeline conv={conv} bots={bots} tasks={tasks} involved={involved} msgs={msgs} deltas={deltas} />
            <Composer conv={conv} bots={bots} busy={busy} onSend={submit} />
          </>}
      </section>
      {panel && activeId && <Computer botId={activeId} bots={involved} overlay={!wide} />}
      <FileViewer />
    </div>
  )
}

// ---------- arquivos da conversa: anexos seus e arquivos dos bots, do mais novo ao mais antigo; dá para apagar ----------
function convFiles(msgs: Msg[]) {
  const out = new Map<string, FileRef>()
  for (const m of [...msgs].reverse()) {
    if (m.role === 'bot') for (const f of botFiles(m.text)) if (!out.has(f.url)) out.set(f.url, f)
    for (const a of m.meta?.attachments ?? []) if (!out.has(a.url)) out.set(a.url, a)
  }
  return [...out.values()]
}
function Artifacts({ files, open, onOpenChange }: { files: FileRef[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const gone = useStore((s) => s.gone)
  useEffect(() => { if (open) checkFiles(files.map((f) => f.url)) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const live = files.filter((f) => !gone[f.url])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Arquivos desta conversa</DialogTitle>
          <DialogDescription>{live.length} arquivo{live.length === 1 ? '' : 's'}, do mais novo ao mais antigo. Toque para ver em tela cheia.</DialogDescription>
        </DialogHeader>
        {live.length ? <FileGrid files={live} onDelete /> : <p className="m-0 py-6 text-center text-[13.5px] text-t3">Nenhum arquivo.</p>}
      </DialogContent>
    </Dialog>
  )
}

const ATTACH = 'gubots:attach' // evento: arquivos soltos no chat → composer
const REPLY = 'gubots:reply' // evento: trecho selecionado de uma resposta → citação no composer

// ---------- responder trecho: selecionar texto de uma resposta mostra "Responder" ----------
function ReplyPop() {
  const [sel, setSel] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null)
  useEffect(() => {
    let t = 0
    const read = () => {
      const s = getSelection()
      const r = s && !s.isCollapsed && s.rangeCount ? s.getRangeAt(0) : undefined
      const node = r?.commonAncestorContainer
      const el = node && (node.nodeType === 1 ? node as Element : node.parentElement)
      const text = s?.toString().trim() ?? ''
      if (!r || !text || !el?.closest('[data-reply]')) return setSel(null)
      const b = r.getBoundingClientRect()
      const touch = matchMedia('(hover:none)').matches // no celular o menu nativo fica em cima: vai embaixo
      const below = touch || b.top < 130
      setSel({ text: text.slice(0, 2000), x: Math.min(Math.max(b.left + b.width / 2, 70), innerWidth - 70), y: below ? b.bottom + 10 : b.top - 10, below })
    }
    const f = () => { clearTimeout(t); t = window.setTimeout(read, 120) }
    document.addEventListener('selectionchange', f)
    addEventListener('scroll', f, true)
    return () => { clearTimeout(t); document.removeEventListener('selectionchange', f); removeEventListener('scroll', f, true) }
  }, [])
  if (!sel) return null
  const go = () => { dispatchEvent(new CustomEvent(REPLY, { detail: sel.text })); getSelection()?.removeAllRanges(); setSel(null) }
  return (
    // pointerdown só segura a seleção; a ação vem no fim do toque/clique — no iPhone o teclado só abre se o foco vier daí
    <button type="button" onPointerDown={(e) => e.preventDefault()} onTouchEnd={(e) => { e.preventDefault(); go() }} onClick={go}
      style={{ left: sel.x, top: sel.y }}
      className={cn('pop fixed z-50 inline-flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/[0.1] bg-[#18181b]/95 px-3.5 text-[13px] font-medium shadow-xl shadow-black/60 backdrop-blur-xl hover:bg-[#232327]', !sel.below && '-translate-y-full')}>
      <Reply size={14} />Responder
    </button>
  )
}

// texto do usuário que começa com citação ("> …") → [citação, resto]
const splitQuote = (t: string): [string, string] => {
  const m = /^((?:>[^\n]*(?:\n|$))+)\n*/.exec(t)
  return m ? [m[1].split('\n').map((l) => l.replace(/^> ?/, '')).join('\n').trim(), t.slice(m[0].length)] : ['', t]
}

// ---------- pílula do cabeçalho: quem, modelo e o que está fazendo; toque abre a troca de modelo ----------
function ChatTitle({ conv, lead, working, since, now }: { conv?: Conv; lead?: Bot; working: Bot[]; since?: number; now: number }) {
  const models = useStore((s) => s.models)
  const activity = useStore((s) => (working[0] ? s.activity[working[0].id] : undefined))
  const bots = useStore((s) => s.bots)
  const last = activity?.filter((a) => !a.convId || a.convId === conv?.id).at(-1)
  const doing = working.length ? (last && now - last.ts < 30_000 ? describe(last, bots)[1] : 'pensando…') : ''
  const mi = conv?.kind === 'mission' ? conv.mission : undefined
  const title = mi ? conv!.title : lead?.name ?? 'Gubots'
  // missão: passos desde a sua última mensagem e estado
  const step = mi ? (mi.status === 'closed' ? 'encerrada' : mi.status === 'paused' ? 'pausada · você decide' : `passo ${Math.min(mi.steps, 15)}/15`) : ''
  const sub = working.length
    ? <span className="flex min-w-0 items-center gap-1"><span className="truncate text-ok">{working.length > 1 ? `${working.map((b) => b.name).join(', ')} trabalhando` : mi ? `${working[0].name}: ${doing}` : doing}</span>{since && <span className="shrink-0 tabular-nums text-t3">{dur(now - since)}</span>}{step && <span className="shrink-0 tabular-nums text-t3">· {step}</span>}</span>
    : mi ? `${conv!.botIds.length} bots · ${step}`
    : lead ? modelName(models, lead.engine, lead.model) : ''
  const pill = (
    <button type="button" aria-label={mi ? title : `${title}: trocar modelo`} disabled={!lead || !!mi}
      className="glass flex h-11 min-w-0 max-w-full items-center gap-2.5 rounded-full py-1 pl-1 pr-4 text-left transition-[filter] duration-200 enabled:hover:brightness-125 disabled:cursor-default data-[state=open]:brightness-125 md:h-12 md:max-w-[420px]">
      {mi ? <span className="glass-btn inline-flex size-9 shrink-0 items-center justify-center rounded-full md:size-10"><Target size={16} strokeWidth={1.9} /></span> : lead && (
          <span className="relative inline-flex shrink-0">
            <Avatar bot={lead.avatar} size={36} working={lead.status === 'working'} />
            <span className={cn('absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[#151517]', working.length ? 'bg-ok shadow-[0_0_8px_rgba(74,222,128,0.9)]' : 'bg-ok')} />
          </span>
        )}
      <span className="flex min-w-0 flex-col leading-[1.15]">
        <span className="flex min-w-0 items-center gap-1 text-[14px] font-semibold">
          <span className="truncate">{title}</span>
          {lead && !mi && <ChevronDown size={13} className="shrink-0 text-t3" />}
        </span>
        <span className="min-w-0 truncate text-[11.5px] text-t3">{sub}</span>
      </span>
    </button>
  )
  return !lead || mi ? pill : <ModelPopover bot={lead}>{pill}</ModelPopover>
}

// ---------- busca na conversa: destaca no texto (CSS Custom Highlight), "2 de 5", setas e Enter navegam ----------
const fold = (t: string) => t.replace(/./gsu, (c) => c.normalize('NFD')[0].toLowerCase()) // sem acento e caixa, mesmo tamanho
function FindBar({ count, onClose }: { count: number; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Range[]>([])
  const [i, setI] = useState(0)
  const hl = typeof CSS !== 'undefined' && 'highlights' in CSS ? (CSS as any).highlights as Map<string, unknown> : undefined
  useEffect(() => { // procura nas mensagens carregadas (texto visível da conversa)
    const root = document.getElementById('gb-timeline')
    const term = fold(q.trim())
    const out: Range[] = []
    if (root && term.length > 1) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('button, [aria-hidden="true"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) })
      for (let n = w.nextNode(); n && out.length < 500; n = w.nextNode()) {
        const t = fold(n.textContent ?? '')
        for (let k = t.indexOf(term); k >= 0; k = t.indexOf(term, k + term.length)) { const r = document.createRange(); r.setStart(n, k); r.setEnd(n, k + term.length); out.push(r) }
      }
    }
    setHits(out)
    setI((v) => (out.length ? Math.min(v, out.length - 1) : 0))
  }, [q, count])
  useEffect(() => { // pinta todos e o atual; leva o atual para o centro
    const H = (window as any).Highlight
    if (hl && H) { hl.set('gb-find', new H(...hits)); hits[i] ? hl.set('gb-find-cur', new H(hits[i])) : hl.delete('gb-find-cur') }
    hits[i]?.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [hits, i])
  useEffect(() => () => { hl?.delete('gb-find'); hl?.delete('gb-find-cur') }, [])
  const step = (d: number) => hits.length && setI((v) => (v + d + hits.length) % hits.length)
  return (
    <div data-findbar className="pop absolute inset-x-3 top-[74px] z-30 mx-auto flex h-12 max-w-[560px] items-center gap-1 rounded-full glass pl-4 pr-1.5 md:inset-x-6">
      <Search size={16} className="shrink-0 text-t3" />
      <input id="gb-find" autoFocus aria-label="Buscar na conversa" placeholder="Buscar nesta conversa" value={q} onChange={(e) => { setQ(e.target.value); setI(0) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
          if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
        }}
        className="min-w-0 flex-1 bg-transparent px-1.5 text-[15px]" />
      <span className="shrink-0 px-1 text-[12px] tabular-nums text-t3" aria-live="polite">{q.trim().length > 1 ? (hits.length ? `${i + 1} de ${hits.length}` : 'nada') : ''}</span>
      <button type="button" aria-label="Anterior" disabled={!hits.length} onClick={() => step(-1)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-t2 hover:bg-white/[0.07] hover:text-foreground disabled:opacity-30"><ArrowUp size={16} /></button>
      <button type="button" aria-label="Próxima" disabled={!hits.length} onClick={() => step(1)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-t2 hover:bg-white/[0.07] hover:text-foreground disabled:opacity-30"><ArrowDown size={16} /></button>
      <button type="button" aria-label="Fechar busca" onClick={onClose} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-t2 hover:bg-white/[0.07] hover:text-foreground"><X size={16} /></button>
    </div>
  )
}

// ---------- boas-vindas: orb, saudação e chips (como na referência) ----------
function Welcome({ conv, bots, chief, onSend, busy }: { conv?: Conv; bots: Bot[]; chief?: Bot; onSend: (t: string, files?: File[]) => void; busy: boolean }) {
  const name = useStore((s) => s.settings.userName)
  const md = useMedia('(min-width:768px)')
  const short = useMedia('(max-height:640px)')
  const members = conv ? conv.botIds.map((id) => bots.find((b) => b.id === id)).filter((b): b is Bot => !!b) : chief ? [chief] : []
  const lead = members.find((b) => b.isChief) ?? members[0]
  if (!lead)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pt-[72px] text-center">
        <Orb size={140} />
        <h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Nenhum bot ainda</h1>
        <p className="m-0 max-w-xs text-t2">Crie o primeiro bot para começar a conversar.</p>
        <button type="button" className="bg-grad inline-flex h-11 items-center gap-2 rounded-full px-6 font-semibold" onClick={() => set({ view: 'bots', botDialog: 'new' })}><Plus size={16} />Novo bot</button>
      </div>
    )
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto overflow-x-hidden px-6 pb-4 pt-[80px] text-center">
        <Orb size={short ? 120 : md ? 210 : 172} active={busy} className="view-in" />
        <p className="rise m-0 mt-9 text-[15px] text-t2 [animation-delay:80ms] md:mt-11 md:text-[16px]">
          {greeting()}{name ? `, ${name}` : ''}! Sou o {lead.name}.
        </p>
        <h1 className="rise m-0 mt-2 max-w-[15ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.035em] [animation-delay:140ms] md:text-[44px]">
          Como posso ajudar hoje?
        </h1>
      </div>
      <div className="rise mx-auto w-full max-w-[808px] [animation-delay:200ms]">
        <div className="no-scrollbar grid auto-cols-max grid-flow-col grid-rows-2 gap-2 overflow-x-auto px-3 pb-3 [mask-image:linear-gradient(90deg,transparent,#000_14px,#000_calc(100%-14px),transparent)] md:flex md:flex-wrap md:justify-center md:px-6 md:[mask-image:none]">
          {SUGGESTIONS.map(([Icon, label, t]) => (
            <button key={label} type="button" onClick={() => onSend(t)} title={t}
              className="glass-btn inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full pl-3 pr-4 text-[13.5px] text-t1 transition-[filter,color] duration-200 hover:text-foreground hover:brightness-125">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-white/[0.06]"><Icon size={13} strokeWidth={1.9} /></span>{label}
            </button>
          ))}
        </div>
      </div>
      <Composer conv={conv} bots={bots} busy={busy} onSend={onSend} />
    </div>
  )
}

// ---------- ferramentas → chips legíveis ----------
const host = (u?: string) => { if (!u) return 'a página'; try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u.slice(0, 40) } }
function describe(a: ActivityItem, bots: Bot[]): [LucideIcon, string] {
  if (a.kind === 'error') return [AlertCircle, a.text.slice(0, 90)]
  if (a.kind === 'nav') return [Globe, `em ${host(a.text)}`]
  const sp = a.text.indexOf(' ')
  const name = (sp < 0 ? a.text : a.text.slice(0, sp)).split(/__|\./).pop()!.toLowerCase()
  const rest = sp < 0 ? '' : a.text.slice(sp + 1)
  const arg = (k: string) => new RegExp(`"${k}"\\s*:\\s*"([^"]*)`).exec(rest)?.[1]
  const plain = rest.startsWith('{') || rest.startsWith('[') ? '' : rest.replace(/^"|"$/g, '')
  switch (name) {
    case 'browser_open': return arg('url') === 'back' ? [Globe, 'voltando à página anterior'] : [Globe, `abrindo ${host(arg('url'))}`]
    case 'browser_snapshot': case 'browser_get_text': return [FileText, 'lendo a página']
    case 'browser_click': return [MousePointerClick, arg('text') ? `clicando em “${arg('text')}”` : 'clicando']
    case 'browser_type': return [Keyboard, 'digitando']
    case 'browser_screenshot': return [Camera, 'olhando a tela']
    case 'remember': return [Brain, 'lembrando…']
    case 'recall': return [Brain, 'consultando a memória']
    case 'forget': return [Brain, 'esquecendo um fato']
    case 'graph_query': return [Network, 'consultando o grafo']
    case 'delegate_task': return [Users, `delegando ao ${nameOf(bots, arg('assignee') ?? '?')}`]
    case 'list_agents': case 'get_agent': return [Users, 'consultando a equipe']
    case 'websearch': case 'web_search': { const q = arg('query') ?? plain; return [Search, q ? `pesquisando “${q.slice(0, 50)}”` : 'pesquisando na web'] }
    case 'webfetch': case 'web_fetch': return [Globe, `lendo ${host(arg('url'))}`]
    case 'bash': case 'shell': case 'powershell': return [Terminal, 'executando um comando']
    case 'read': case 'glob': case 'grep': case 'ls': return [FileText, 'lendo arquivos']
    case 'write': case 'edit': case 'multiedit': case 'apply_patch': case 'notebookedit': return [FilePen, 'escrevendo um arquivo']
    case 'todowrite': return [ListChecks, 'organizando os passos']
    default: return [Wrench, name.replace(/_/g, ' ')]
  }
}
// só o que é passo do bot (a navegação já aparece como "abrindo …")
const stepsOf = (l: ActivityItem[] | undefined, convId: string, from: number, to = Infinity) => (l ?? []).filter((a) => a.convId === convId && a.ts >= from && a.ts <= to && (a.kind === 'tool' || a.kind === 'error'))

function Chip({ a, bots, active }: { a: ActivityItem; bots: Bot[]; active?: boolean }) {
  const [Icon, label] = describe(a, bots)
  return (
    <span className={cn('rise inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 text-[12.5px] text-t2',
      a.kind === 'error' && 'border-live/25 bg-live/[0.06] text-bad', active && 'border-brand/30 bg-brand/[0.08]')}>
      <Icon size={13} strokeWidth={1.8} className={cn('shrink-0', active && 'text-[#93c5fd]')} />
      <span className={cn('truncate', active && 'shimmer-text')}>{label}</span>
    </span>
  )
}

function Steps({ items, bots }: { items: ActivityItem[]; bots: Bot[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-2.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.025] pl-2.5 pr-2 text-[12.5px] text-t2 transition-colors hover:border-white/[0.14] hover:text-foreground">
        <Wrench size={12} />{items.length} passo{items.length > 1 ? 's' : ''}<ChevronRight size={13} className={cn('transition-transform duration-300 ease-[var(--ease)]', open && 'rotate-90')} />
      </button>
      <div className={cn('grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease)]', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <div className="min-h-0 overflow-hidden" inert={!open}><div className="flex flex-wrap gap-1.5 pt-2">{items.map((a, i) => <Chip key={i} a={a} bots={bots} />)}</div></div>
      </div>
    </div>
  )
}

// ---------- linha do tempo ----------
// tarefa entre bots vira conversa: quem pede chama "@bot …", o executor entra, responde e sai
type Item = { ts: number; msg?: Msg; task?: Task; kind?: 'ask' | 'join' | 'leave' }

function Timeline({ conv, bots, tasks, involved, msgs, deltas }: { conv: Conv; bots: Bot[]; tasks: Task[]; involved: Bot[]; msgs?: Msg[]; deltas?: Record<string, string> }) {
  const activity = useStore((s) => s.activity)
  const models = useStore((s) => s.models)
  const taskList = useMemo(() => tasks.filter((t) => t.convId === conv.id), [tasks, conv.id])
  const now = useNow(taskList.some((t) => t.status === 'running'))

  const items = useMemo(() => {
    // o aviso "A → B: objetivo" do servidor é trocado pelo pedido "@B objetivo" na voz de quem pediu
    const its = (msgs || []).filter((m) => !(m.meta?.kind === 'delegation' && m.botId && m.taskId != null && taskList.some((t) => t.id === m.taskId))).map((m): Item => ({ ts: m.ts, msg: m }))
    const ev = taskList.flatMap((t): Item[] => [
      { ts: t.createdAt, task: t, kind: 'ask' },
      ...(t.startedAt ? [{ ts: t.startedAt, task: t, kind: 'join' as const }] : []),
      ...(t.endedAt && t.startedAt && t.status !== 'refused' ? [{ ts: t.endedAt + 1, task: t, kind: 'leave' as const }] : []),
    ])
    // empate: pedido antes de entrar, entrar antes da resposta
    const rank = (i: Item) => (i.kind === 'ask' ? 0 : i.kind === 'join' ? 1 : 2)
    return [...its, ...ev].sort((a, b) => a.ts - b.ts || rank(a) - rank(b))
  }, [msgs, taskList])

  const live = involved.filter((b) => b.busyIn?.includes(conv.id) || deltas?.[b.id] != null)
  const lastUserTs = [...(msgs || [])].reverse().find((m) => m.role === 'user')?.ts ?? 0
  const lastBotId = [...(msgs || [])].reverse().find((m) => m.role !== 'user')?.id

  // "Novas mensagens": antes da 1ª resposta depois do "lido até" de quando a conversa abriu ou do seu último pedido
  const opened = useRef({ id: '', ts: 0 })
  if (opened.current.id !== conv.id) opened.current = { id: conv.id, ts: conv.readTs ?? Infinity }
  const since = Math.max(opened.current.ts, lastUserTs)

  const box = useRef<HTMLDivElement>(null)
  const follow = useRef(true) // segue o fim só até a resposta nova chegar ao topo; depois a tela fica parada
  const pinned = useRef(-1)
  const [atEnd, setAtEnd] = useState(true)
  const dlen = Object.values(deltas || {}).reduce((n, t) => n + t.length, 0)
  const alen = live.reduce((n, b) => n + (activity[b.id]?.length ?? 0), 0)
  // antes do efeito de rolagem: abrir a conversa ou mandar pedido volta a seguir o fim
  useLayoutEffect(() => { follow.current = true; pinned.current = -1; setAtEnd(true) }, [conv.id])
  useLayoutEffect(() => { follow.current = true }, [lastUserTs])
  useLayoutEffect(() => {
    const e = box.current
    if (!e || !follow.current) return
    const bottom = e.scrollHeight - e.clientHeight
    const d = e.querySelector<HTMLElement>('#gb-new')
    if (d) {
      const top = e.scrollTop + d.getBoundingClientRect().top - e.getBoundingClientRect().top - 92
      if (top <= bottom) { e.scrollTop = Math.max(0, top); follow.current = false; pinned.current = since; return }
    }
    e.scrollTop = bottom
  }, [items.length, dlen, alen, live.length, conv.id, since])

  const who = (id?: string) => bots.find((b) => b.id === id)
  const out: ReactNode[] = []
  let day = ''
  let prev: Msg | undefined
  let prevUserTs = 0
  let sep = false
  for (const it of items) {
    const d = new Date(it.ts).toDateString()
    if (d !== day) { day = d; prev = undefined; out.push(<DaySep key={'d' + it.ts} ts={it.ts} />) }
    if (!sep && it.ts > since && it.msg?.role !== 'user') { sep = true; prev = undefined; out.push(<NewSep key="new" />) }
    if (it.task) {
      out.push(it.kind === 'ask'
        ? <Summon key={'a' + it.task.id} task={it.task} bots={bots} now={now} />
        : <Presence key={it.kind! + it.task.id} task={it.task} bots={bots} join={it.kind === 'join'} now={now} />)
      prev = undefined; continue
    }
    const m = it.msg!
    const card = null
    if (m.role === 'user') { out.push(<UserMsg key={m.id} m={m} cont={prev?.role === 'user' && m.ts - prev.ts < 5 * 60_000} />); prevUserTs = m.ts }
    else if (m.role === 'system') out.push(<SystemMsg key={m.id} m={m} card={card} last={m.id === lastBotId} />)
    else {
      const b = who(m.botId)
      const eng = m.meta?.engine ?? b?.engine ?? 'claude'
      const cont = prev?.role === 'bot' && prev.botId === m.botId && m.ts - prev.ts < 5 * 60_000
      out.push(
        <BotMsg key={m.id} m={m} bot={b} cont={cont} last={m.id === lastBotId} card={card} open={m.ts > lastUserTs}
          model={modelName(models, eng, m.meta?.model ?? b?.model ?? '') + ((m.meta as { fallback?: boolean } | undefined)?.fallback ? ' · reserva' : '')} steps={stepsOf(activity[m.botId ?? ''], conv.id, prevUserTs, m.ts)} bots={bots} />,
      )
    }
    prev = m
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={(e) => { const t = e.currentTarget; const end = t.scrollHeight - t.scrollTop - t.clientHeight < 80; follow.current = end && pinned.current !== since; if (end !== atEnd) setAtEnd(end) }}>
        <div id="gb-timeline" className="mx-auto flex w-full max-w-[800px] flex-col gap-7 px-4 pb-8 pt-[84px] md:px-6">
          {msgs === undefined && <TimelineSkeleton />}
          {out}
          {!sep && live.length > 0 && msgs !== undefined && <NewSep />}
          {live.map((b) => <LiveRow key={'live' + b.id} bot={b} text={deltas?.[b.id]} bots={bots}
            steps={stepsOf(activity[b.id], conv.id, Math.max(lastUserTs, taskList.find((t) => t.assignee === b.id && t.status === 'running')?.startedAt ?? 0))} />)}
        </div>
      </div>
      {/* esmaece o fim da conversa sob o composer */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black to-transparent" />
      <button type="button" aria-label="Ir para o fim" tabIndex={atEnd ? -1 : 0}
        onClick={() => box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' })}
        className={cn(roundBtn, 'absolute bottom-4 left-1/2 z-10 size-10 -translate-x-1/2 transition-[opacity,transform,filter] duration-300',
          atEnd ? 'pointer-events-none translate-y-3 opacity-0' : 'opacity-100')}>
        <ArrowDown size={17} />
      </button>
      <ReplyPop />
    </div>
  )
}

const TimelineSkeleton = () => (
  <div className="flex flex-col gap-7 pt-2" aria-label="Carregando mensagens">
    <Skel className="ml-auto h-11 w-2/5 rounded-[22px]" />
    <div className="flex flex-col gap-2.5"><div className="flex items-center gap-2.5"><Skel className="size-7 rounded-full" /><Skel className="h-3.5 w-20" /></div><Skel className="h-4 w-11/12" /><Skel className="h-4 w-3/4" /></div>
    <Skel className="ml-auto h-11 w-1/3 rounded-[22px]" />
  </div>
)

const DaySep = ({ ts }: { ts: number }) => (
  <div className="flex justify-center">
    <span className="rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1 text-[11.5px] font-medium text-t3 first-letter:uppercase">{dayLabel(ts)}</span>
  </div>
)

const NewSep = () => (
  <div id="gb-new" className="fade flex items-center gap-3 text-[11.5px] font-medium text-[#93c5fd]">
    <span className="h-px flex-1 bg-[#93c5fd]/30" />Novas mensagens<span className="h-px flex-1 bg-[#93c5fd]/30" />
  </div>
)

const actionsRow = 'inline-flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'
const smallBtn = 'inline-flex size-8 items-center justify-center rounded-full text-t3 transition-colors hover:bg-white/[0.07] hover:text-foreground'

const UserMsg = memo(function UserMsg({ m, cont }: { m: Msg; cont?: boolean }) {
  const pending = String(m.id).startsWith('tmp-')
  const [quote, body] = splitQuote(m.text)
  return (
    <div className={cn('rise group flex flex-col items-end gap-1', cont && '-mt-5')}>
      {!!m.meta?.attachments?.length && <Attachments list={m.meta.attachments} />}
      {quote && (
        <div className="flex max-w-[86%] items-start gap-2 rounded-[16px] border-l-2 border-brand/60 bg-white/[0.04] py-1.5 pl-3 pr-3.5 text-[13px] leading-snug text-t2 md:max-w-[74%]">
          <Reply size={13} className="mt-[3px] shrink-0 text-t3" /><span className="line-clamp-3 whitespace-pre-wrap break-words">{quote}</span>
        </div>
      )}
      {body && (
        <div className={cn('max-w-[86%] whitespace-pre-wrap break-words rounded-[24px] bg-[linear-gradient(135deg,#2563eb_0%,#0891b2_100%)] px-4 py-2.5 text-[15.5px] leading-[1.5] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_30px_-14px_rgba(14,116,144,0.8)] transition-opacity md:max-w-[74%] [&_a]:text-white [&_a]:decoration-white/50',
          cont ? 'rounded-tr-[10px]' : 'rounded-br-[8px]', pending && 'opacity-60')}>
          <Rich text={body} />
        </div>
      )}
      <Reactions m={m} className="-mt-3 mr-3" />
      <div className="flex h-7 items-center gap-0.5 pr-1">
        <span className={actionsRow}><CopyBtn text={m.text} className="size-8 justify-center rounded-full px-0" /></span>
        <span className="px-1 text-[11px] tabular-nums text-t3">{pending ? 'enviando…' : hhmm(m.ts)}</span>
        {!pending && <Check size={13} strokeWidth={2.2} className="text-[#bfdbfe]" />}
      </div>
    </div>
  )
})

// reações dos bots (ferramenta react): emoji + quem reagiu, como no WhatsApp
function Reactions({ m, className }: { m: Msg; className?: string }) {
  const bots = useStore((s) => s.bots)
  const list = m.meta?.reactions
  if (!list?.length) return null
  const by = new Map<string, string[]>()
  for (const r of list) by.set(r.emoji, [...(by.get(r.emoji) ?? []), r.botId])
  return (
    <div className={cn('pop relative z-[1] flex flex-wrap gap-1', className)}>
      {[...by].map(([e, ids]) => {
        const names = ids.map((id) => bots.find((b) => b.id === id)?.name ?? id)
        return (
          <Tip key={e} label={`${names.join(', ')} reagi${ids.length > 1 ? 'ram' : 'u'}`}>
            <span className="inline-flex h-7 items-center gap-1 rounded-full border border-white/[0.1] bg-[#18181b] pl-1.5 pr-1 text-[15px] leading-none shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
              <span>{e}</span>
              <span className="flex -space-x-1.5">{ids.slice(0, 3).map((id) => <span key={id} className="rounded-full bg-[#18181b] p-px"><Avatar bot={bots.find((b) => b.id === id)?.avatar ?? 'jarvis'} size={16} /></span>)}</span>
            </span>
          </Tip>
        )
      })}
    </div>
  )
}

// resposta do bot: cabeçalho (avatar, nome, modelo) e o texto em largura total, sem balão — melhor leitura no celular
// só a linha ao vivo anima o avatar; as mensagens antigas ficam paradas
function BotHead({ bot, name, working, children }: { bot?: Bot; name: string; working?: boolean; children?: ReactNode }) {
  return (
    <div className="flex h-8 min-w-0 items-center gap-2.5">
      <Avatar bot={bot?.avatar ?? 'jarvis'} size={28} working={working} />
      <span className="truncate text-[14px] font-semibold">{name}</span>
      {children}
    </div>
  )
}

// open = você ainda não respondeu depois dela (botões, formulário e aprovação ficam ativos)
function BotMsg({ m, bot, cont, last, card, model, steps, bots, open }: { m: Msg; bot?: Bot; cont: boolean; last: boolean; card: ReactNode; model: string; steps: ActivityItem[]; bots: Bot[]; open?: boolean }) {
  const refusal = m.meta?.kind === 'refusal'
  const error = m.meta?.kind === 'error'
  const files = useMemo(() => botFiles(m.text), [m.text])
  const checks = (m.meta as { checks?: Record<string, boolean> } | undefined)?.checks
  const info = useMemo(() => ({ id: m.id, convId: m.convId, open, checks }), [m.id, m.convId, open, checks])
  return (
    <div className={cn('rise group flex min-w-0 flex-col gap-2', cont && '-mt-4')}>
      {!cont && <BotHead bot={bot} name={bot?.name ?? m.botId ?? 'bot'}>{model && <span className="truncate rounded-full border border-white/[0.07] px-2 text-[11px] leading-[20px] text-t3">{model}</span>}</BotHead>}
      <div className={cn('min-w-0 md:pl-[38px]', (refusal || error) && 'rounded-2xl border px-4 py-3', refusal && 'border-warn/25 bg-warn/[0.05]', error && 'border-live/25 bg-live/[0.05]')}>
        {steps.length > 0 && <Steps items={steps} bots={bots} />}
        {m.text && <div data-reply><MsgCtx.Provider value={info}><Markdown text={m.text} className={cn(refusal && 'text-warn', error && 'text-bad')} /></MsgCtx.Provider></div>}
        {files.length > 0 && <div className="mt-3"><FileGrid files={files} /></div>}
        <Reactions m={m} className="mt-2" />
        {card && <div className="mt-3">{card}</div>}
      </div>
      <div className="-mt-1 flex h-8 items-center gap-0.5 md:pl-[34px]">
        <span className="px-1 text-[11px] tabular-nums text-t3">{hhmm(m.ts)}</span>
        <span className={actionsRow}>
          <CopyBtn text={m.text} className="size-8 justify-center rounded-full px-0" />
          {last && <Tip label="Tentar de novo"><button type="button" aria-label="Tentar de novo" className={smallBtn} onClick={() => retry(m.convId)}><RotateCcw size={14} /></button></Tip>}
        </span>
      </div>
    </div>
  )
}

function SystemMsg({ m, card, last }: { m: Msg; card: ReactNode; last: boolean }) {
  const k = m.meta?.kind as string | undefined
  if (k === 'secret-request') return <SecretAsk m={m} />
  if (k === 'takeover') return <TakeoverAsk m={m} />
  if (k === 'delegation' && card) return <div className="rise">{card}</div>
  if (k === 'error' && /interrompid/i.test(m.text))
    return <div className="rise flex justify-center"><span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1 text-xs text-t3"><Square size={9} fill="currentColor" />Interrompido · {hhmm(m.ts)}</span></div>
  if (k === 'error' || k === 'refusal')
    return (
      <div className="rise flex flex-col gap-2">
        {card}
        <div className={cn('flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-2xl border px-4 py-3 text-[14px] leading-relaxed',
          k === 'error' ? 'border-live/25 bg-live/[0.06] text-bad' : 'border-warn/25 bg-warn/[0.06] text-warn')}>
          <AlertCircle size={16} className="mt-[3px] shrink-0" />
          <span className="min-w-0 flex-1 basis-48 whitespace-pre-wrap break-words">{m.text}</span>
          {last && k === 'error' && <button type="button" className="ml-auto shrink-0 rounded-full border border-current/30 px-3 py-1 text-xs font-medium hover:bg-white/5" onClick={() => retry(m.convId)}>Tentar de novo</button>}
        </div>
      </div>
    )
  return <div className="rise flex flex-col gap-2">{card}<p className="m-0 whitespace-pre-wrap break-words text-center text-xs text-t3">{m.text}</p></div>
}

const STREAMING = { streaming: true }
function LiveRow({ bot, text, steps, bots }: { bot: Bot; text?: string; steps: ActivityItem[]; bots: Bot[] }) {
  const shown = steps.slice(-4)
  return (
    <div className="rise flex min-w-0 flex-col gap-2" aria-live="polite">
      <BotHead bot={bot} name={bot.name} working><span className="shimmer-text text-[12px] font-medium">trabalhando</span></BotHead>
      <div className="flex min-w-0 flex-col gap-2.5 md:pl-[38px]">
        {!!shown.length && (
          <div className="flex flex-wrap gap-1.5">
            {steps.length > shown.length && <span className="inline-flex h-8 items-center rounded-full px-1.5 text-[12.5px] text-t3">+{steps.length - shown.length}</span>}
            {shown.map((a, i) => <Chip key={a.ts + a.text} a={a} bots={bots} active={!text && i === shown.length - 1} />)}
          </div>
        )}
        {text ? <MsgCtx.Provider value={STREAMING}><Markdown text={text} streaming /></MsgCtx.Provider> : (
          <span className="flex h-7 items-center gap-1.5" role="status" aria-label="pensando">
            {[0, 1, 2].map((i) => <span key={i} className="typing-dot size-2 rounded-full bg-[#bfdbfe]" style={{ animationDelay: i * 0.16 + 's' }} />)}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------- tarefa entre bots como conversa ----------
// pedido: mensagem de quem pediu, "@Executor objetivo"; o rodapé leva à tarefa
function Summon({ task: t, bots, now }: { task: Task; bots: Bot[]; now: number }) {
  const req = bots.find((x) => x.id === t.requester)
  const st = TASK_STATUS[t.status]
  const [open, setOpen] = useState(false)
  return (
    <div className="rise flex min-w-0 flex-col gap-2">
      <BotHead bot={req} name={req?.name ?? nameOf(bots, t.requester)} />
      <div className="min-w-0 md:pl-[38px]">
        <p className={cn('m-0 whitespace-pre-wrap break-words text-[15.5px] leading-[1.6]', !open && 'line-clamp-4')} onClick={() => setOpen(!open)}>
          <span className="font-semibold text-[#93c5fd]">@{nameOf(bots, t.assignee)}</span> {t.objective}
        </p>
        <button type="button" onClick={() => set({ view: 'tasks', taskSel: t.id })}
          className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full text-[11.5px] text-t3 transition-colors hover:text-foreground">
          <Dot color={st.color} pulse={t.status === 'running'} /><span className="truncate">tarefa #{t.id} · {st.label}{taskTime(t, now) && ` · ${taskTime(t, now)}`}{t.requires.length ? ` · requer ${t.requires.map(toolName).join(', ')}` : ''}</span><ChevronRight size={12} className="shrink-0" />
        </button>
      </div>
    </div>
  )
}

// "Forja entrou na conversa" / "Forja saiu · concluiu"
function Presence({ task: t, bots, join, now }: { task: Task; bots: Bot[]; join: boolean; now: number }) {
  const b = bots.find((x) => x.id === t.assignee)
  const end = { done: 'concluiu', failed: 'falhou', canceled: 'cancelada', refused: 'recusou', running: '', queued: '' }[t.status]
  return (
    <div className="rise -my-3 flex justify-center">
      <button type="button" onClick={() => set({ view: 'tasks', taskSel: t.id })}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] py-0.5 pl-1 pr-3 text-[11.5px] text-t3 transition-colors hover:text-foreground">
        <Avatar bot={b?.avatar ?? 'jarvis'} size={18} working={join && t.status === 'running'} />
        <span className="truncate">{b?.name ?? t.assignee} {join ? 'entrou na conversa' : `saiu · ${end}${taskTime(t, now) ? ` em ${taskTime(t, now)}` : ''}`}</span>
        <span className="tabular-nums">· {hhmm(join ? t.startedAt! : t.endedAt!)}</span>
      </button>
    </div>
  )
}

// ---------- anexos ----------
function PendingFile({ f, onRemove }: { f: File; onRemove: () => void }) {
  const [url] = useState(() => (f.type.startsWith('image/') ? URL.createObjectURL(f) : ''))
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return (
    <span className="pop group relative inline-flex h-14 max-w-[220px] shrink-0 items-center gap-2.5 rounded-[18px] border border-white/[0.08] bg-white/[0.04] pr-3" title={f.name}>
      {url ? <img src={url} alt="" className="h-14 w-14 rounded-[18px] object-cover" /> : <span className="ml-1.5 inline-flex size-10 items-center justify-center rounded-[14px] bg-white/[0.06]"><FileText size={18} /></span>}
      <span className="flex min-w-0 flex-col leading-tight"><span className="truncate text-[12.5px] font-medium">{f.name}</span><span className="text-[11px] text-t3">{size(f.size)}</span></span>
      <button type="button" aria-label={`Remover ${f.name}`} onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 inline-flex size-6 items-center justify-center rounded-full border border-white/10 bg-[#18181b] text-t2 hover:text-foreground"><X size={12} /></button>
    </span>
  )
}

// anexos do seu balão: cartões com preview, Expandir e Baixar
const Attachments = ({ list }: { list: Att[] }) => <div className="max-w-[86%]"><FileGrid files={list} end /></div>

// ---------- troca de modelo e raciocínio (pílula do cabeçalho) ----------
function ModelPopover({ bot, children }: { bot: Bot; children: ReactElement }) {
  const models = useStore((s) => s.models)
  const list = models?.[bot.engine] ?? []
  const info = list.find((m) => m.id === bot.model)
  const allowed = (e?: string[]) => EFFORTS.filter(([x]) => !e?.length || e.includes(x))
  const save = async (p: Partial<Bot>) => { const b = await act(api<Bot>('/api/bots/' + bot.id, 'PUT', p)); if (b) putBot(b) }
  const pickModel = (id: string, e?: string[]) => {
    const ok = allowed(e).map(([x]) => x)
    save({ model: id, ...(ok.length && !ok.includes(bot.effort) ? { effort: (ok.includes('medium') ? 'medium' : ok[0]) as Effort } : {}) })
  }
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="center" sideOffset={10} collisionPadding={12}
          className="z-[70] w-[min(320px,calc(100vw-24px))] origin-(--radix-popover-content-transform-origin) rounded-[24px] border border-white/[0.09] bg-[#121214]/95 p-2 shadow-2xl shadow-black/70 outline-none backdrop-blur-xl duration-200 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <div className="flex items-center gap-3 px-2 pb-2.5 pt-1.5">
            <Avatar bot={bot.avatar} size={34} />
            <span className="flex min-w-0 flex-col leading-tight"><span className="truncate text-[14px] font-semibold">{bot.name}</span><span className="text-xs text-t3">{engineName(bot.engine)} · raciocínio {effortName(bot.effort).toLowerCase()}</span></span>
          </div>
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-t3">Modelo</div>
          <div className="flex max-h-60 flex-col overflow-y-auto">
            {list.map((m) => (
              <button key={m.id} type="button" onClick={() => pickModel(m.id, m.efforts)}
                className={cn('flex h-10 shrink-0 items-center gap-2 rounded-[14px] px-2.5 text-left text-[14px] text-t1 transition-colors hover:bg-white/[0.06]', m.id === bot.model && 'bg-white/[0.06] text-foreground')}>
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                {m.id === bot.model && <Check size={15} className="text-[#93c5fd]" />}
              </button>
            ))}
            {!list.length && <p className="m-0 px-2.5 py-2 text-[13px] text-t3">{models ? (models.errors?.[bot.engine] ?? 'Nenhum modelo') : 'Carregando…'}</p>}
          </div>
          <div className="mt-1.5 flex flex-col gap-2 border-t border-white/[0.06] px-1 pb-1 pt-3">
            <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-t3">Raciocínio</span>
            <Seg size="sm" value={bot.effort} onChange={(e: Effort) => save({ effort: e })} opts={allowed(info?.efforts)} disabled={!!info?.efforts && !info.efforts.length} />
            <span className="px-1 text-[11px] text-t3">Vale para todas as conversas do {bot.name}.</span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// fatores fixos das barras do ditado (parecem ondas, sem aleatório a cada render)
const BARS = Array.from({ length: 32 }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)))

function Composer({ conv, bots, busy, onSend }: { conv?: Conv; bots: Bot[]; busy: boolean; onSend: (t: string, files?: File[]) => void }) {
  const sttEngine = useStore((s) => s.settings.sttEngine)
  const enter = useStore((s) => s.settings.sendOnEnter)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [quote, setQuote] = useState('') // trecho de uma resposta que esta mensagem responde
  const pick = useRef<HTMLInputElement>(null)
  const add = (l: FileList | File[] | null) => {
    const ok = [...(l ?? [])].filter((f) => f.size <= 25 * 1024 * 1024)
    if (ok.length < (l?.length ?? 0)) toast('Arquivos acima de 25 MB foram ignorados')
    setFiles((cur) => [...cur, ...ok].slice(0, 10))
  }
  const [rec, setRec] = useState(0) // início da gravação (0 = parado)
  const now = useNow(rec > 0)
  const ta = useRef<HTMLTextAreaElement>(null)
  const wave = useRef<HTMLDivElement>(null)
  const [stt, setStt] = useState(false) // transcrevendo o ditado
  const [live, setLive] = useState<string | null>(null) // ditado em tempo real (null = sem Web Speech nesta gravação)
  const [refine, setRefine] = useState(false) // o texto do tempo real está no campo e o Whisper vai refinar
  const stop = useRef<(discard?: boolean) => void>(undefined)
  useEffect(() => () => stop.current?.(true), []) // desmontou: solta o microfone e descarta
  useEffect(() => { // arquivos soltos em qualquer ponto do chat entram como anexo
    const f = (e: Event) => { add((e as CustomEvent<File[]>).detail); ta.current?.focus() }
    addEventListener(ATTACH, f)
    const r = (e: Event) => { // foco já no campo, cursor no fim, para digitar direto
      setQuote((e as CustomEvent<string>).detail)
      const t = ta.current; if (!t) return
      t.focus(); t.setSelectionRange(t.value.length, t.value.length)
      requestAnimationFrame(() => { if (document.activeElement !== t) t.focus() })
    }
    addEventListener(REPLY, r)
    const d = (e: Event) => { setText((e as CustomEvent<string>).detail); setTimeout(() => { const t = ta.current; if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length) } }) } // "Editar" da aprovação
    addEventListener(DRAFT, d)
    return () => { removeEventListener(ATTACH, f); removeEventListener(REPLY, r); removeEventListener(DRAFT, d) }
  }, [])
  const chiefAll = bots.find((b) => b.isChief) ?? bots[0]
  const members = conv ? conv.botIds.map((id) => bots.find((b) => b.id === id)).filter((b): b is Bot => !!b) : chiefAll ? [chiefAll] : []
  const chief = members.find((b) => b.isChief) ?? members[0]
  const mission = conv?.kind === 'mission'
  const name = mission ? conv!.title : chief?.name ?? 'o bot'
  const [target, setTarget] = useState<string[]>([]) // missão: bots marcados com @ (vazio = orquestrador decide)
  useEffect(() => setTarget([]), [conv?.id])

  useEffect(() => { setText(''); setFiles([]); setQuote(''); stop.current?.(true); if (matchMedia('(min-width:768px)').matches) ta.current?.focus() }, [conv?.id])
  useEffect(() => { // cresce com o texto
    const e = ta.current
    if (!e) return
    e.style.height = ''
    if (text) e.style.height = Math.min(e.scrollHeight, 220) + 'px'
  }, [text])
  useEffect(() => { // Esc: gravando → transcreve; senão para o bot (fora de diálogos)
    if (!rec && (!busy || !conv)) return
    const f = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"],[data-radix-popper-content-wrapper]')) return
      if (rec) { e.preventDefault(); stop.current?.() } else if (conv) stopConv(conv.id)
    }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [busy, conv?.id, rec])

  const submit = () => {
    let t = text.trim()
    if (!t && !files.length) return
    // missão: marcados que o texto ainda não cita entram como @id no começo
    const tags = mission ? target.filter((id) => !t.toLowerCase().includes('@' + id)) : []
    if (tags.length) t = `${tags.map((id) => '@' + id).join(' ')} ${t}`
    // citação em Markdown no começo: o bot entende que a pergunta é sobre esse trecho
    if (quote) t = quote.split('\n').map((l) => '> ' + l).join('\n') + '\n\n' + t
    stop.current?.(true)
    setText('')
    setQuote('')
    const f = files
    setFiles([])
    onSend(t, f)
  }

  // Ditado: grava com MediaRecorder; ao parar, converte para WAV 16 kHz e o servidor transcreve com Whisper.
  // Misto: enquanto grava, a Web Speech API do navegador mostra o texto parcial; ao parar, ele entra no campo
  // e o Whisper o SUBSTITUI pelo texto final ("refinando…"). Sem Web Speech ou se ela falhar: só o Whisper.
  // Se o servidor falhar, fica o parcial. stop.current(true) descarta a gravação.
  async function mic() {
    if (stt) return
    if (rec || stop.current) return stop.current?.()
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast(window.isSecureContext ? 'Este navegador não grava áudio' : 'O microfone só funciona em HTTPS')
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }) }
    catch { return toast('Sem acesso ao microfone: libere a permissão no navegador') }
    const mime = recMime()
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    let discard = false
    const base = text.trim() // o que já estava escrito antes do ditado
    const join = (t: string) => (base && t ? base + ' ' : base) + t
    let partial = ''
    // Groq: o texto ao vivo vem do Whisper large-v3 (áudio até agora a cada ~3,5 s, respeita o limite grátis de 20/min);
    // outros motores: reconhecimento do próprio navegador (não existe no iPhone)
    const groq = sttEngine === 'groq'
    const stopLive = groq ? null : startLiveStt((t) => { partial = t; setLive(t) })
    setLive(stopLive || groq ? '' : null)
    let inFlight = false
    const tickLive = groq ? setInterval(() => {
      if (inFlight || chunks.length < 2) return
      inFlight = true
      const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' })
      toWav16k(blob).then((w) => api<{ text: string }>('/api/stt?partial=1', 'POST', w))
        .then((r) => { if (r?.text && stop.current) { partial = r.text; setLive(r.text) } }).catch(() => {}).finally(() => { inFlight = false })
    }, 3500) : undefined
    // volume ao vivo → barras animadas (escreve direto no CSS, sem re-render)
    let raf = 0
    let ac: AudioContext | undefined
    try {
      ac = new AudioContext()
      const an = ac.createAnalyser()
      an.fftSize = 512
      ac.createMediaStreamSource(stream).connect(an)
      const buf = new Uint8Array(an.fftSize)
      const tick = () => {
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x }
        wave.current?.style.setProperty('--lvl', Math.min(1, Math.sqrt(sum / buf.length) * 5).toFixed(3))
        raf = requestAnimationFrame(tick)
      }
      tick()
    } catch { /* sem Web Audio: barras ficam paradas */ }
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    mr.onstop = async () => {
      clearTimeout(limit); clearInterval(tickLive)
      cancelAnimationFrame(raf); ac?.close().catch(() => {})
      stream.getTracks().forEach((t) => t.stop())
      stopLive?.(); setLive(null)
      setRec(0); stop.current = undefined
      const raw = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' })
      if (discard || raw.size < 1000) return
      // o parcial entra já no campo; o Whisper troca pelo final só se você não editou nesse meio-tempo
      const snap = partial ? join(partial) : undefined
      if (snap) setText(snap)
      setRefine(!!snap); setStt(true)
      try {
        const audio = await toWav16k(raw).catch(() => raw)
        const r = await api<{ text: string }>('/api/stt' + (conv ? `?conv=${conv.id}` : ''), 'POST', audio) // volta já refinado (pontuação, typos, nomes)
        if (r?.text) setText((t) => (snap ? (t === snap ? join(r.text) : t) : (t.trim() ? t.trimEnd() + ' ' : '') + r.text))
        else if (!snap) toast('Não ouvi nada no áudio')
      } catch (e) { if ((e as Error).message !== '401') toast(snap ? 'Refino falhou: ficou o texto do tempo real' : 'Falha na transcrição: ' + (e as Error).message) }
      finally { setStt(false); setRefine(false); ta.current?.focus() }
    }
    const end = (drop?: boolean) => { discard = !!drop; if (mr.state !== 'inactive') mr.stop() }
    const limit = setTimeout(end, 5 * 60_000) // máx. 5 min por ditado
    stop.current = end
    mr.start(1000) // pedaços a cada 1 s (o texto ao vivo do Groq usa o que já foi gravado)
    setRec(Date.now())
    api('/api/stt/warm', 'POST').catch(() => {}) // carrega o modelo enquanto você fala
  }

  const has = !!text.trim() || files.length > 0
  // pedidos esperando o bot terminar o atual nesta conversa (X tira da fila)
  const queued = conv ? bots.flatMap((b) => (b.queue ?? []).filter((q) => q.convId === conv.id)) : []
  const canStop = busy && !has && !!conv && !rec
  // botão principal (gradiente, como na referência): microfone → enviar quando há texto → parar quando o bot trabalha
  const main = rec
    ? { label: 'Parar e transcrever', icon: <Square size={14} fill="currentColor" />, onClick: mic, cls: 'bg-live text-white shadow-[0_0_0_6px_rgba(244,63,94,0.18),0_12px_30px_-8px_rgba(244,63,94,0.9)]' }
    : has ? { label: 'Enviar', icon: <ArrowUp size={19} strokeWidth={2.3} />, onClick: submit, cls: 'bg-grad' }
    : canStop ? { label: 'Parar', icon: <Square size={13} fill="currentColor" />, onClick: () => stopConv(conv!.id), cls: 'bg-white text-black' }
    : { label: stt ? 'Transcrevendo…' : 'Ditar por voz', icon: stt ? <Loader2 size={19} className="animate-spin" /> : <Mic size={19} strokeWidth={2} />, onClick: mic, cls: 'bg-grad' }

  return (
    <div className="relative z-10 mx-auto w-full max-w-[808px] px-3 pb-[max(0.75rem,var(--sab))] md:px-6 md:pb-5">
      {queued.length > 0 && (
        <div role="status" className="fade mx-2 mb-2 flex flex-col gap-1 rounded-[20px] border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[13px]">
          <span className="text-[11.5px] font-medium text-t3">Na fila ({queued.length}) · roda quando terminar o atual</span>
          {queued.map((q, i) => (
            <span key={q.id} className="flex min-w-0 items-center gap-2 text-t2">
              <span className="shrink-0 tabular-nums text-t3">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate" title={q.text}>{q.text}</span>
              <button type="button" aria-label="Tirar da fila" title="Tirar da fila" onClick={() => act(api(`/api/queue/${q.id}`, 'DELETE'))}
                className="-my-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-t3 hover:bg-white/[0.07] hover:text-foreground"><X size={14} /></button>
            </span>
          ))}
        </div>
      )}
      {rec > 0 && <div aria-hidden="true" className="rec-glow fade pointer-events-none fixed inset-x-0 bottom-0 -z-10 h-[46dvh]" />}
      <form onSubmit={(e) => { e.preventDefault(); submit() }}
        onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); add(e.clipboardData.files) } }}
        className={cn('glass relative flex flex-col gap-1 rounded-[30px] p-1.5 transition-[border-color,box-shadow] duration-300',
          rec ? '!border-live/40' : 'focus-within:!border-white/[0.16] focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.08),0_12px_32px_-14px_rgba(0,0,0,0.9)]')}>
        {mission && chief && !rec && (
          <div role="group" aria-label="Quem recebe" className="flex flex-wrap gap-1.5 px-1 pt-0.5">
            {[{ id: '', name: `${chief.name} decide` }, ...members.filter((b) => b.id !== chief.id)].map((b) => {
              const on = b.id ? target.includes(b.id) : !target.length
              return (
                <button key={b.id || 'lead'} type="button" aria-pressed={on}
                  onClick={() => setTarget((t) => (!b.id ? [] : t.includes(b.id) ? t.filter((x) => x !== b.id) : [...t, b.id]))}
                  className={cn('h-8 rounded-full border px-3 text-[13px] transition-colors', on ? 'border-brand/50 bg-brand/15 text-foreground' : 'border-white/[0.08] bg-white/[0.03] text-t2 hover:text-foreground')}>
                  @ {b.name}
                </button>
              )
            })}
          </div>
        )}
        {quote && !rec && (
          <div className="pop mx-1.5 mt-1.5 flex items-start gap-2 rounded-[18px] border-l-2 border-brand/60 bg-white/[0.04] py-2 pl-3 pr-1.5 text-[13px] leading-snug text-t2">
            <Reply size={14} className="mt-[2px] shrink-0 text-[#93c5fd]" />
            <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words">{quote}</span>
            <button type="button" aria-label="Remover citação" onClick={() => setQuote('')} className="-my-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-t3 hover:bg-white/[0.07] hover:text-foreground"><X size={14} /></button>
          </div>
        )}
        {rec > 0 && live !== null && (
          <p aria-live="polite" className="fade m-0 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words px-3 pt-2 text-[15px] leading-[1.45] text-foreground">
            {text.trim() && <span className="text-t2">{text.trim()} </span>}{live || <span className="text-t3">Fale… o texto aparece aqui</span>}
          </p>
        )}
        {stt && refine && (
          <span role="status" className="fade flex items-center gap-1.5 px-3 pt-1.5 text-[11.5px] text-t3"><Loader2 size={12} className="animate-spin" />Refinando…</span>
        )}
        {files.length > 0 && (
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-1.5 pb-1 pt-2">
            {files.map((f, i) => <PendingFile key={i + f.name} f={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />)}
          </div>
        )}
        <input ref={pick} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <div className="flex items-end gap-1.5">
          <Tip label="Anexar arquivos (ou arraste/cole aqui)">
            <button type="button" aria-label="Anexar arquivos" onClick={() => pick.current?.click()} disabled={!!rec}
              className="glass-btn inline-flex size-11 shrink-0 items-center justify-center rounded-full text-t1 transition-[filter,opacity] hover:brightness-125 disabled:opacity-40"><Plus size={20} strokeWidth={1.8} /></button>
          </Tip>
          {rec ? (
            <div className="fade flex h-11 min-w-0 flex-1 items-center gap-3 px-1.5 text-bad">
              <span className="size-2 shrink-0 rounded-full bg-live rec-ring" />
              <span className="shrink-0 text-[14px] font-medium tabular-nums">{dur(now - rec)}</span>
              <div ref={wave} className="flex h-7 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden text-[#fb7185]">
                {BARS.map((k, i) => <span key={i} className="wave-bar shrink-0" style={{ '--k': k } as React.CSSProperties} />)}
              </div>
              <button type="button" aria-label="Descartar gravação" onClick={() => stop.current?.(true)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-t2 hover:bg-white/[0.07] hover:text-foreground"><X size={17} /></button>
            </div>
          ) : (
            <textarea ref={ta} rows={1} aria-label={`Mensagem para ${name}`} value={text}
              placeholder={stt ? 'Transcrevendo…' : mission ? `Mensagem na missão ${name}` : `Mensagem para ${name}…`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                const mod = e.ctrlKey || e.metaKey
                if (enter ? !e.shiftKey : mod) { e.preventDefault(); submit() }
              }}
              className="max-h-[220px] min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-[11px] text-[16px] leading-[1.4] text-foreground md:text-[15px]" />
          )}
          {has && !rec && (
            <Tip label={stt ? 'Transcrevendo…' : 'Ditar por voz'}>
              <button type="button" aria-label="Ditar por voz" onClick={mic} disabled={stt}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-t2 transition-colors hover:bg-white/[0.07] hover:text-foreground disabled:opacity-50">
                {stt ? <Loader2 size={18} className="animate-spin" /> : <Mic size={19} strokeWidth={1.8} />}
              </button>
            </Tip>
          )}
          <Tip label={main.label === 'Parar' ? <>Parar <kbd>Esc</kbd></> : main.label}>
            <button type="button" aria-label={main.label} aria-pressed={main.label === 'Parar e transcrever' || undefined} onClick={main.onClick} disabled={stt && !has}
              className={cn('relative inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-[background,box-shadow,transform,filter] duration-300 ease-[var(--spring)] hover:brightness-110 disabled:opacity-60', main.cls)}>
              {rec > 0 && <><span aria-hidden="true" className="ripple absolute inset-0 rounded-full bg-live/40" /><span aria-hidden="true" className="ripple absolute inset-0 rounded-full bg-live/30 [animation-delay:0.6s]" /></>}
              <span key={main.label} className="pop relative inline-flex">{main.icon}</span>
            </button>
          </Tip>
        </div>
      </form>
      <p className="m-0 mt-2 hidden text-center text-[11px] text-t3 md:block">
        {rec ? <>Fale à vontade · <kbd>Esc</kbd> ou o quadrado para transcrever</> : enter ? <><kbd>Enter</kbd> envia · <kbd>Shift Enter</kbd> quebra linha · arraste ou cole arquivos{busy && <> · <kbd>Esc</kbd> para</>}</> : <><kbd>Ctrl Enter</kbd> envia · arraste ou cole arquivos{busy && <> · <kbd>Esc</kbd> para</>}</>}
      </p>
    </div>
  )
}
