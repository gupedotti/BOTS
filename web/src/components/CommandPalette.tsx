import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bot, Brain, CalendarClock, CheckSquare, CornerDownLeft, MessageSquare, Plus, Search, Settings, SquarePen } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { go, newChat, openBot, openConv, set, useStore } from '@/store'
import { ago, cn } from '@/lib/utils'

type Cmd = { group: string; label: string; icon: ReactNode; hint?: string; run: () => void }

export function CommandPalette() {
  const open = useStore((s) => s.palette)
  const convs = useStore((s) => s.convs)
  const bots = useStore((s) => s.bots)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) { setQ(''); setI(0) } }, [open])

  const cmds = useMemo<Cmd[]>(() => [
    { group: 'Ações', label: 'Nova conversa', icon: <SquarePen />, hint: 'Ctrl Shift O', run: newChat },
    { group: 'Ações', label: 'Novo bot', icon: <Plus />, run: () => set({ view: 'bots', botDialog: 'new' }) },
    { group: 'Telas', label: 'Bots', icon: <Bot />, run: () => go('bots') },
    { group: 'Telas', label: 'Tarefas', icon: <CheckSquare />, run: () => go('tasks') },
    { group: 'Telas', label: 'Agenda', icon: <CalendarClock />, run: () => go('schedules') },
    { group: 'Telas', label: 'Memória', icon: <Brain />, run: () => go('memory') },
    { group: 'Telas', label: 'Configurações', icon: <Settings />, hint: 'Ctrl ,', run: () => go('settings') },
    ...[...convs].sort((a, b) => b.lastTs - a.lastTs).map((c): Cmd => ({
      group: 'Conversas', label: c.title, icon: <MessageSquare />, hint: ago(c.lastTs), run: () => openConv(c.id),
    })),
    ...bots.map((b): Cmd => ({ group: 'Bots', label: b.name, icon: <Avatar bot={b.avatar} size={18} />, hint: b.job, run: () => openBot(b.id) })),
  ], [convs, bots])

  const t = q.trim().toLowerCase()
  // sem busca: ações, telas, as 8 conversas mais recentes e os bots
  let nConv = 0
  const shown = t ? cmds.filter((c) => (c.label + ' ' + c.group).toLowerCase().includes(t)) : cmds.filter((c) => c.group !== 'Conversas' || nConv++ < 8)
  const sel = Math.min(i, shown.length - 1)
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' }) }, [sel])
  const pick = (c?: Cmd) => { if (!c) return; set({ palette: false }); c.run() }

  return (
    <Dialog open={open} onOpenChange={(o) => set({ palette: o })}>
      <DialogContent showCloseButton={false} aria-describedby={undefined}
        className="gap-0 overflow-hidden p-0 max-sm:flex max-sm:h-[85dvh] max-sm:flex-col max-sm:px-0 max-sm:pt-4 sm:top-[12%] sm:max-w-[580px] sm:translate-y-0">
        <DialogTitle className="sr-only">Buscar e comandos</DialogTitle>
        <label className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-5">
          <Search size={18} className="shrink-0 text-t3" />
          <input autoFocus aria-label="Buscar" placeholder="Buscar conversas, bots e telas…" value={q} className="min-w-0 flex-1 bg-transparent text-[15px]"
            onChange={(e) => { setQ(e.target.value); setI(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI((sel + 1) % Math.max(shown.length, 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI((sel - 1 + shown.length) % Math.max(shown.length, 1)) }
              if (e.key === 'Enter') { e.preventDefault(); pick(shown[sel]) }
            }} />
          <kbd className="max-sm:!hidden">Esc</kbd>
        </label>
        <div ref={list} role="listbox" aria-label="Resultados" className="overflow-y-auto overscroll-contain p-2 max-sm:min-h-0 max-sm:flex-1 sm:max-h-[min(440px,60dvh)]">
          {!shown.length && <p className="m-0 px-3 py-8 text-center text-[13px] text-t3">Nada encontrado para “{q}”.</p>}
          {shown.map((c, n) => (
            <div key={c.group + c.label + n}>
              {(n === 0 || shown[n - 1].group !== c.group) && <div className="px-3 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-t3 first:pt-1">{c.group}</div>}
              <button type="button" role="option" aria-selected={n === sel} data-i={n} onMouseMove={() => n !== sel && setI(n)} onClick={() => pick(c)}
                className={cn('flex h-11 w-full items-center gap-3 rounded-[14px] px-3 text-left text-[14px] text-t1 transition-colors [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-t2', n === sel && 'bg-white/[0.07] text-foreground [&_svg]:text-[#93c5fd]')}>
                {c.icon}
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && <span className="max-w-[45%] truncate text-xs text-t3">{c.hint}</span>}
                {n === sel && <CornerDownLeft className="!size-3.5 !text-t3" />}
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
