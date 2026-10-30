import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bot, Brain, CalendarClock, CheckSquare, ChevronRight, Target, LogOut, MessageSquare, Monitor, MoreHorizontal, Pencil, PanelLeftClose, Plus, Power, Settings, Trash2, type LucideIcon } from 'lucide-react'
import { Avatar, Logo } from '@/components/Avatar'
import { Dropdown, Tip, Unread, botState } from '@/components/bits'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { btn, cn, ago, field, iconBtn } from '@/lib/utils'
import { api, askDelete, closeMission, confirmAsk, get, go, logout, newChat, newMission, openBot, openConv, set, useStore, type View } from '@/store'

const row = 'flex w-full items-center gap-3 rounded-2xl px-2.5 text-left transition-colors duration-200 hover:bg-white/[0.05] active:bg-white/[0.07]'
const SK = 'gubots-sidebar-sec'
const remote = !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname)

function useSections() {
  const [s, setS] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(SK) || '{}') } catch { return {} } })
  const toggle = (k: string) => setS((o) => { const n = { ...o, [k]: !o[k] }; try { localStorage.setItem(SK, JSON.stringify(n)) } catch { /* ignore */ } return n })
  return [s, toggle] as const // true = recolhida
}

// rótulo de seção: caixa-alta pequena, contador e ação à direita — separa claramente "o que é lista" de "o que é navegação"
function Section({ id, title, count, closed, toggle, action, children }: { id: string; title: string; count?: number; closed: boolean; toggle: (k: string) => void; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <div className="flex h-8 items-center pr-1">
        <button type="button" aria-expanded={!closed} onClick={() => toggle(id)}
          className="flex h-8 flex-1 items-center gap-1.5 rounded-lg px-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-t3 transition-colors hover:text-t2">
          <ChevronRight size={12} strokeWidth={2.2} className={cn('-ml-0.5 transition-transform duration-300 ease-[var(--ease)]', !closed && 'rotate-90')} />
          {title}
          {count != null && count > 0 && <span className="rounded-full bg-white/[0.06] px-1.5 text-[10px] font-semibold leading-4 tracking-normal text-t2">{count}</span>}
        </button>
        {action}
      </div>
      <div className={cn('grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease)]', closed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100')}>
        <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden pt-0.5" inert={closed}>{children}</div>
      </div>
    </section>
  )
}

const more = (label: string) => (
  <button type="button" aria-label={label}
    className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-t3 opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100">
    <MoreHorizontal size={16} />
  </button>
)

// celular: arrastar a gaveta para a esquerda fecha, seguindo o dedo
function useSwipeClose() {
  const drawer = useRef<HTMLElement>(null)
  const shade = useRef<HTMLDivElement>(null)
  const d = useRef<{ x: number; y: number; dx: number; lock?: 'x' | 'y' } | null>(null)
  const reset = () => {
    const el = drawer.current
    if (el) { el.style.transition = ''; el.style.transform = '' }
    if (shade.current) { shade.current.style.transition = ''; shade.current.style.opacity = '' }
  }
  return {
    drawer, shade,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => { if (!matchMedia('(min-width:768px)').matches) d.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0 } },
      onTouchMove: (e: React.TouchEvent) => {
        const s = d.current, el = drawer.current
        if (!s || !el) return
        const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y
        if (!s.lock && Math.abs(dx) + Math.abs(dy) > 8) s.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        if (s.lock !== 'x') return
        s.dx = Math.min(0, dx)
        el.style.transition = 'none'; el.style.transform = `translateX(${s.dx}px)`
        if (shade.current) { shade.current.style.transition = 'none'; shade.current.style.opacity = String(Math.max(0, 1 + s.dx / el.offsetWidth)) }
      },
      onTouchEnd: () => {
        const s = d.current
        d.current = null
        if (!s || s.lock !== 'x') return
        reset()
        if (s.dx < -64) set({ sidebar: false })
      },
    },
  }
}

// celular: deslizar o dedo da esquerda para a direita em qualquer ponto da tela abre a gaveta (segue o dedo).
// Ignora campos, a tela do navegador do bot, diálogos e áreas já roladas na horizontal (tabelas, chips, código).
function useSwipeOpen(open: boolean, drawer: React.RefObject<HTMLElement | null>, shade: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (open) return
    let s: { x: number; y: number; dx: number; lock?: 'x' | 'y' } | null = null
    const blocked = (t: EventTarget | null) => {
      for (let n = t instanceof Element ? t : null; n && n !== document.body; n = n.parentElement) {
        if (n.matches('input, textarea, canvas, [role="dialog"], [data-no-swipe]')) return true
        if (n.scrollLeft > 0) return true // área rolada na horizontal: o dedo para a direita rola de volta
      }
      return false
    }
    const reset = () => {
      const el = drawer.current, sh = shade.current
      if (el) { el.style.transition = ''; el.style.transform = '' }
      if (sh) { sh.style.transition = ''; sh.style.opacity = '' }
    }
    const start = (e: TouchEvent) => {
      s = null
      const st = get()
      if (matchMedia('(min-width:768px)').matches || e.touches.length !== 1 || st.panel || st.ask || st.palette || st.botDialog || blocked(e.target)) return
      s = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0 }
    }
    const move = (e: TouchEvent) => {
      const el = drawer.current
      if (!s || !el) return
      const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y
      if (!s.lock && Math.abs(dx) + Math.abs(dy) > 10) s.lock = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
      if (s.lock !== 'x') return
      if (e.cancelable) e.preventDefault() // o gesto é nosso: o navegador não rola nem volta de página
      const w = el.offsetWidth
      s.dx = Math.max(0, Math.min(w, dx))
      el.style.transition = 'none'; el.style.transform = `translateX(${s.dx - w}px)`
      if (shade.current) { shade.current.style.transition = 'none'; shade.current.style.opacity = String(s.dx / w) }
    }
    const end = () => {
      const v = s
      s = null
      if (!v || v.lock !== 'x') return
      reset()
      if (v.dx > 60) set({ sidebar: true })
    }
    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', end)
    document.addEventListener('touchcancel', end)
    return () => {
      document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', end)
      reset()
    }
  }, [open, drawer, shade])
}

export function Sidebar() {
  const bots = useStore((s) => s.bots)
  const convs = useStore((s) => s.convs)
  const tasks = useStore((s) => s.tasks)
  const schedules = useStore((s) => s.schedules)
  const convId = useStore((s) => s.convId)
  const [missionDlg, setMissionDlg] = useState(false)
  const missions = useStore((s) => s.convs).filter((c) => c.kind === 'mission').sort((a, b) => b.lastTs - a.lastTs)
  const view = useStore((s) => s.view)
  const open = useStore((s) => s.sidebar)
  const online = useStore((s) => s.online)
  const userName = useStore((s) => s.settings.userName) || 'Você'
  const [sec, toggle] = useSections()
  const swipe = useSwipeClose()
  useSwipeOpen(open, swipe.drawer, swipe.shade)
  const attention = tasks.filter((t) => t.status === 'refused' || t.status === 'failed').length
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'queued').length
  const working = bots.filter((b) => b.status === 'working').length

  // navegação principal: uma linha de ícones no rodapé da gaveta (rótulo na dica e para leitores de tela)
  const nav = (v: View, label: string, Icon: LucideIcon, badge?: { n: number; tone: 'warn' | 'ok' | 'live' } | false) => {
    const on = view === v
    return (
      <Tip key={v} label={label}>
        <button type="button" aria-label={label} aria-current={on ? 'page' : undefined}
          onClick={() => (v === 'chat' ? (view === 'chat' ? newChat() : go('chat')) : go(v))}
          className={cn('relative inline-flex h-11 flex-1 items-center justify-center rounded-full text-t2 transition-[color,background-color,filter] duration-200 hover:bg-white/[0.06] hover:text-foreground',
            on && 'glass-btn text-[#93c5fd] hover:bg-transparent hover:text-[#93c5fd]')}>
          <Icon size={20} strokeWidth={on ? 2 : 1.7} />
          {badge && badge.n > 0 && (
            <span className={cn('absolute right-[calc(50%-20px)] top-1 min-w-[18px] rounded-full px-1 text-center text-[10px] font-bold leading-[18px] tabular-nums ring-2 ring-[#0d0d0f]',
              badge.tone === 'warn' ? 'bg-warn text-black' : badge.tone === 'live' ? 'bg-live text-white' : 'bg-ok text-black')}>{badge.n > 99 ? '99+' : badge.n}</span>
          )}
        </button>
      </Tip>
    )
  }

  return (
    <>
      <div aria-hidden="true" ref={swipe.shade} onClick={() => set({ sidebar: false })}
        className={cn('fixed inset-0 z-30 bg-black/60 backdrop-blur-[3px] transition-opacity duration-300 md:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')} />
      <aside aria-label="Navegação" inert={!open} ref={swipe.drawer} {...swipe.handlers}
        className={cn('fixed inset-y-0 left-0 z-40 w-[300px] max-w-[86vw] overflow-hidden border-r border-white/[0.06] bg-side transition-[transform,width,border-color] duration-[420ms] ease-[var(--ease)] max-md:shadow-2xl max-md:shadow-black md:static md:z-auto md:max-w-none md:translate-x-0',
          open ? 'translate-x-0 md:w-[284px]' : '-translate-x-full md:w-0 md:border-transparent')}>
        <div className="flex h-full w-[300px] max-w-[86vw] flex-col pb-[var(--sab)] pt-[var(--sat)] md:w-[284px]">
          {/* marca */}
          <div className="flex h-16 shrink-0 items-center justify-between pl-4 pr-3">
            <button type="button" onClick={newChat} className="flex items-center gap-2.5 rounded-full text-[17px] font-semibold tracking-[-0.01em]">
              <span className="glass-btn inline-flex size-9 items-center justify-center rounded-full"><Logo size={19} /></span>Gubots
            </button>
            <Tip label={<>Recolher <kbd>Ctrl B</kbd></>} side="right">
              <button type="button" aria-label="Recolher barra lateral" className={iconBtn} onClick={() => set({ sidebar: false })}><PanelLeftClose size={18} strokeWidth={1.7} /></button>
            </Tip>
          </div>

          {/* listas */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-3 pb-3 pt-1">
            <Section id="bots" title="Equipe" count={bots.length} closed={!!sec.bots} toggle={toggle}
              action={<Tip label="Novo bot"><button type="button" aria-label="Novo bot" className={cn(iconBtn, 'size-8')} onClick={() => set({ view: 'bots', botDialog: 'new' })}><Plus size={15} /></button></Tip>}>
              {bots.map((b) => {
                const st = botState(b, tasks, bots)
                // a conversa com o bot fica no próprio item da equipe (a mais recente com ele)
                const dms = convs.filter((c) => c.kind === 'bot' && c.botIds.length === 1 && c.botIds[0] === b.id)
                const dm = dms.sort((x, y) => y.lastTs - x.lastTs)[0]
                const n = dms.reduce((t, c) => t + (c.unread ?? 0), 0)
                const active = view === 'chat' && !!convId && dms.some((c) => c.id === convId)
                return (
                  <div key={b.id} className="group relative">
                    <button type="button" onClick={() => openBot(b.id)} aria-current={active ? 'page' : undefined}
                      className={cn(row, 'py-2 pr-11', active && 'bg-white/[0.08] hover:bg-white/[0.08]')}>
                      <span className="relative inline-flex shrink-0">
                        <span className={cn('rounded-full p-[2px] transition-shadow duration-300', st.working && 'shadow-[0_0_0_2px_rgba(74,222,128,0.55),0_0_16px_rgba(74,222,128,0.3)]')}><Avatar bot={b.avatar} size={34} working={st.working} /></span>
                        <span className="absolute bottom-0 right-0 size-3 rounded-full border-[2.5px] border-side" style={{ background: st.working ? '#4ADE80' : st.color === '#5B5955' ? '#4ADE80' : st.color }} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className={cn('truncate text-[14px] font-semibold', n || active ? 'text-foreground' : 'text-t1')}>{b.name}</span>
                          {b.isChief && <span className="shrink-0 rounded-full border border-brand/30 bg-brand/10 px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-wide text-[#93c5fd]">chefe</span>}
                        </span>
                        <span className={cn('truncate text-[12px]', st.working ? 'shimmer-text font-medium' : st.color === '#E6B34A' ? 'text-warn' : 'text-t3')}>{st.label}</span>
                      </span>
                      {n ? <Unread n={n} /> : dm && <span className="shrink-0 self-start pt-0.5 text-[11px] tabular-nums text-t3 group-hover:opacity-0 [@media(hover:none)]:opacity-0">{ago(dm.lastTs)}</span>}
                    </button>
                    <Dropdown trigger={more(`Opções de ${b.name}`)} items={[
                      { label: 'Conversar', icon: <MessageSquare />, onSelect: () => openBot(b.id) },
                      { label: 'Ver navegador', icon: <Monitor />, onSelect: () => openBot(b.id, true) },
                      { label: 'Configurar bot', icon: <Pencil />, onSelect: () => set({ botDialog: b.id }) },
                      ...(dm ? [{ label: 'Apagar conversa', icon: <Trash2 />, danger: true, onSelect: () => askDelete(dm) }] : []),
                    ]} />
                  </div>
                )
              })}
            </Section>

            <Section id="missions" title="Missões" count={missions.length} closed={!!sec.missions} toggle={toggle}
              action={<Tip label="Nova missão"><button type="button" aria-label="Nova missão" className={cn(iconBtn, 'size-8')} onClick={() => setMissionDlg(true)}><Plus size={15} /></button></Tip>}>
              {missions.map((c) => {
                const active = view === 'chat' && convId === c.id
                const st = c.mission?.status === 'closed' ? 'encerrada' : c.mission?.status === 'paused' ? 'pausada' : bots.some((b) => b.busyIn?.includes(c.id)) ? 'trabalhando' : 'aguardando você'
                return (
                  <div key={c.id} className="group relative">
                    <button type="button" onClick={() => openConv(c.id)} aria-current={active ? 'page' : undefined} className={cn(row, 'py-2 pr-11', active && 'bg-white/[0.08] hover:bg-white/[0.08]')}>
                      <span className="glass-btn inline-flex size-8 shrink-0 items-center justify-center rounded-full"><Target size={14} strokeWidth={1.9} /></span>
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className={cn('truncate text-[14px] font-medium', !!c.unread && 'font-semibold text-foreground')}>{c.title}</span>
                        <span className={cn('truncate text-[12px]', st === 'trabalhando' ? 'shimmer-text font-medium' : 'text-t3')}>{c.botIds.length} bots · {st}</span>
                      </span>
                      <Unread n={c.unread} />
                    </button>
                    <Dropdown trigger={more(`Opções de ${c.title}`)} items={[
                      ...(c.mission?.status !== 'closed' ? [{ label: 'Encerrar missão', icon: <Target />, onSelect: () => closeMission(c.id) }] : []),
                      { label: 'Apagar missão', icon: <Trash2 />, danger: true, onSelect: () => askDelete(c) },
                    ]} />
                  </div>
                )
              })}
              {!missions.length && (
                <button type="button" onClick={() => setMissionDlg(true)} className={cn(row, 'h-11 text-[13.5px] text-t3 hover:text-t2')}>
                  <span className="inline-flex size-8 items-center justify-center rounded-full border border-dashed border-white/[0.16]"><Plus size={14} /></span>Criar uma missão
                </button>
              )}
            </Section>
          </div>

          {/* rodapé: navegação em ícones + usuário */}
          <div className="flex flex-col gap-2.5 border-t border-white/[0.05] p-3">
            <nav aria-label="Seções" className="flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.025] p-1">
              {nav('chat', 'Conversas', MessageSquare, { n: convs.reduce((t, c) => t + (c.unread ?? 0), 0), tone: 'live' })}
              {nav('bots', 'Bots', Bot, { n: working, tone: 'ok' })}
              {nav('tasks', 'Tarefas', CheckSquare, attention > 0 ? { n: attention, tone: 'warn' } : { n: running, tone: 'ok' })}
              {nav('schedules', 'Agenda', CalendarClock, { n: schedules.filter((x) => x.runs[0]?.status === 'running').length, tone: 'ok' })}
              {nav('memory', 'Memória', Brain)}
            </nav>
            <div className="glass flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-1">
              <span className="bg-grad relative inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold">
                {userName.slice(0, 1).toUpperCase()}
                <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-[2.5px] border-[#111113]" style={{ background: online ? '#4ADE80' : '#f43f5e' }} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-[13.5px] font-semibold">{userName}</span>
                <span className="truncate text-[12px] text-t3">{online ? 'Conectado' : 'Reconectando…'}</span>
              </span>
              <Tip label={<>Configurações <kbd>Ctrl ,</kbd></>}>
                <button type="button" aria-label="Configurações" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => go('settings')}
                  className={cn(iconBtn, view === 'settings' && 'bg-white/[0.1] text-foreground')}><Settings size={17} /></button>
              </Tip>
              <Dropdown align="end" trigger={<button type="button" aria-label="Mais opções da conta" className={iconBtn}><MoreHorizontal size={17} /></button>} items={[
                ...(remote ? [{ label: 'Sair', icon: <LogOut />, onSelect: logout }] : []),
                { label: 'Encerrar o Gubots', icon: <Power />, danger: true, onSelect: async () => { if (await confirmAsk({ title: 'Encerrar o Gubots?', body: 'O servidor e os navegadores dos bots serão fechados. Bots trabalhando serão interrompidos.', ok: 'Encerrar', danger: true })) api('/api/quit', 'POST').catch(() => {}) } },
              ]} />
            </div>
          </div>
        </div>
      </aside>
      <MissionDialog open={missionDlg} onClose={() => setMissionDlg(false)} />
    </>
  )
}

// nova missão: título, problema e 2 a 6 bots; o chefe entra sempre como orquestrador
function MissionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const bots = useStore((s) => s.bots)
  const chief = bots.find((b) => b.isChief)
  const [title, setTitle] = useState('')
  const [problem, setProblem] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const ok = !!problem.trim() && sel.length >= 2 && sel.length <= 6
  const submit = async () => {
    setBusy(true)
    if (await newMission(title.trim(), problem.trim(), sel)) { setTitle(''); setProblem(''); setSel([]); onClose() }
    setBusy(false)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova missão</DialogTitle>
          <DialogDescription>{chief?.name ?? 'O chefe'} orquestra: chama um bot por vez com @, revisa cada entrega à vista e chama o próximo. Todos leem o histórico da missão.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (ok && !busy) submit() }}>
          <input className={field} placeholder="Título (opcional), ex.: Lançamento do site" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={cn(field, 'resize-y leading-relaxed')} rows={4} autoFocus={matchMedia('(min-width:768px)').matches}
            placeholder="Problema: o que precisa ser resolvido, contexto e o que é entrega pronta." value={problem} onChange={(e) => setProblem(e.target.value)} />
          <div className="flex flex-col gap-1">
            <span className="px-1 text-[13px] text-t2">Bots (2 a 6) · {sel.length} escolhidos</span>
            <div className="-mx-1 flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {bots.map((b) => (
                <label key={b.id} className="flex cursor-pointer items-center gap-3 rounded-2xl px-2.5 py-2 transition-colors hover:bg-white/[0.05]">
                  <Checkbox checked={sel.includes(b.id)} onCheckedChange={(c) => setSel(c ? [...sel, b.id] : sel.filter((x) => x !== b.id))} />
                  <Avatar bot={b.avatar} size={28} />
                  <span className="flex min-w-0 flex-col leading-tight"><span className="font-medium">{b.name}</span><span className="truncate text-[12px] text-t3">{b.job}</span></span>
                  {b.isChief && <span className="ml-auto shrink-0 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-xs text-[#93c5fd]">orquestra</span>}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" className={cn(btn, 'h-11')} disabled={!ok || busy}>Começar missão</button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
