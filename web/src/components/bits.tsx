import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { DropdownMenu, Tooltip } from 'radix-ui'
import { Menu } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { cn, dur, roundBtn } from '@/lib/utils'
import { set, useStore } from '@/store'
import type { Bot, Effort, Models, Task, Tool } from '@/types'

export const Dot = ({ color, className, pulse }: { color: string; className?: string; pulse?: boolean }) => (
  <span className={cn('relative inline-flex size-[7px] shrink-0', className)}>
    {pulse && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: color }} />}
    <span className="relative inline-block size-[7px] rounded-full" style={{ background: color }} />
  </span>
)

// ponto de status: verde = trabalhando, âmbar = atenção/aguardando, cinza = parado
export function botState(b: Bot, tasks: Task[], bots: Bot[]) {
  if (b.status === 'working') {
    const t = tasks.find((t) => t.assignee === b.id && t.status === 'running')
    return { color: '#4ADE80', label: t ? `Trabalhando · #${t.id}` : 'Trabalhando', working: true }
  }
  if (b.status === 'queued') return { color: '#E6B34A', label: 'Na fila', working: false }
  const w = tasks.find((t) => t.requester === b.id && (t.status === 'running' || t.status === 'queued'))
  if (w) return { color: '#E6B34A', label: `Aguardando ${bots.find((x) => x.id === w.assignee)?.name ?? w.assignee}`, working: false }
  return { color: '#5B5955', label: 'Disponível', working: false }
}

export const TOOLS: [Tool, string][] = [['browser', 'Navegador'], ['files', 'Arquivos'], ['shell', 'Terminal'], ['web', 'Busca web'], ['design', 'Design e docs']]
export const toolName = (t: string) => TOOLS.find((x) => x[0] === t)?.[1] ?? t
export const EFFORTS: [Effort, string][] = [['low', 'Baixo'], ['medium', 'Médio'], ['high', 'Alto']]
export const effortName = (e: string) => EFFORTS.find((x) => x[0] === e)?.[1] ?? e

export const nameOf = (bots: Bot[], id: string) => (id === 'user' ? 'Você' : bots.find((b) => b.id === id)?.name ?? id)

// botão de abrir a barra lateral (drawer no celular; no desktop só aparece se estiver recolhida)
export function MenuBtn() {
  const open = useStore((s) => s.sidebar)
  const n = useStore((s) => s.convs.reduce((t, c) => t + (c.unread ?? 0), 0))
  return (
    <Tip label={<>Abrir barra lateral <kbd>Ctrl B</kbd></>}>
      <button type="button" aria-label={n ? `Abrir menu (${n} não lida${n > 1 ? 's' : ''})` : 'Abrir menu'} className={cn(roundBtn, 'relative size-10 md:size-11', open && 'md:hidden')} onClick={() => set({ sidebar: true })}>
        <Menu size={19} strokeWidth={1.8} />
        <Unread n={n} className="absolute -right-1 -top-1 ring-2 ring-black" />
      </button>
    </Tip>
  )
}

// selo vermelho de respostas não lidas (como no WhatsApp)
export const Unread = ({ n = 0, className }: { n?: number; className?: string }) =>
  n > 0 ? (
    <span aria-label={`${n} não lida${n > 1 ? 's' : ''}`}
      className={cn('pop inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-live px-1.5 text-[11px] font-bold leading-none tabular-nums text-white shadow-[0_0_14px_-2px_rgba(244,63,94,0.8)]', className)}>
      {n > 99 ? '99+' : n}
    </span>
  ) : null

export const TASK_STATUS: Record<Task['status'], { label: string; color: string }> = {
  queued: { label: 'Na fila', color: '#6b6b74' },
  running: { label: 'Trabalhando', color: '#4ADE80' },
  done: { label: 'Concluída', color: '#4ADE80' },
  failed: { label: 'Falhou', color: '#f43f5e' },
  refused: { label: 'Recusou', color: '#fbbf24' },
  canceled: { label: 'Cancelada', color: '#6b6b74' },
}
export const taskTime = (t: Task, now: number) => (t.startedAt ? dur((t.endedAt ?? now) - t.startedAt) : '')

export const engineName = (e: string) => (e === 'codex' ? 'Codex' : 'Claude Code')
export const modelName = (m: Models | null, engine: string, id: string) =>
  (engine === 'codex' ? m?.codex : m?.claude)?.find((x) => x.id === id)?.name ?? id

// relógio de 1 s, só enquanto `on`
export function useNow(on: boolean) {
  const [n, setN] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const i = setInterval(() => setN(Date.now()), 1000)
    return () => clearInterval(i)
  }, [on])
  return n
}

export function useMedia(q: string) {
  const [v, setV] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q)
    const f = () => setV(m.matches)
    m.addEventListener('change', f)
    f()
    return () => m.removeEventListener('change', f)
  }, [q])
  return v
}

// links e **negrito** para textos do usuário (as respostas dos bots usam <Markdown>)
export function Rich({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|\*\*[^*\n]+\*\*)/g).map((p, i) =>
    p.startsWith('http') ? <a key={i} href={p} target="_blank" rel="noreferrer" className="underline decoration-white/40 underline-offset-2 hover:decoration-white">{p}</a>
      : p.startsWith('**') && p.length > 4 ? <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong> : p)}</>
}

// ---------- primitivas visuais ----------
export function Tip({ label, side = 'top', children }: { label: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactElement }) {
  return (
    <Tooltip.Root delayDuration={400}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} collisionPadding={8}
          className="z-[80] flex items-center gap-1.5 rounded-xl border border-white/[0.09] bg-[#18181b]/95 px-2.5 py-1.5 text-xs text-foreground shadow-xl shadow-black/60 backdrop-blur-xl animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 [@media(hover:none)]:hidden">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void }
export function Dropdown({ trigger, items, align = 'end' }: { trigger: ReactElement; items: MenuItem[]; align?: 'start' | 'end' }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={4} collisionPadding={8}
          className="z-[70] min-w-52 origin-(--radix-dropdown-menu-content-transform-origin) rounded-[20px] border border-white/[0.09] bg-[#121214]/95 p-1.5 shadow-2xl shadow-black/70 backdrop-blur-xl duration-200 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          {items.map((it) => (
            <DropdownMenu.Item key={it.label} onSelect={it.onSelect}
              className={cn('flex h-10 cursor-pointer items-center gap-3 rounded-[14px] px-3 text-[14px] outline-none transition-colors data-[highlighted]:bg-white/[0.07] [&_svg]:size-[17px] [&_svg]:text-t2',
                it.danger && 'text-bad [&_svg]:text-bad data-[highlighted]:bg-live/10')}>
              {it.icon}{it.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function Seg<T extends string>({ value, opts, onChange, strong, size = 'md', disabled }: { value: T; opts: [T, string][]; onChange: (v: T) => void; strong?: boolean; size?: 'sm' | 'md'; disabled?: boolean }) {
  return (
    <div role="radiogroup" className={cn('flex gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-1', disabled && 'pointer-events-none opacity-40')}>
      {opts.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn('flex-1 whitespace-nowrap rounded-full px-3 text-t2 transition-[background-color,color,box-shadow] duration-200 hover:text-foreground', size === 'sm' ? 'h-7 text-[13px]' : 'h-9 text-[13.5px]',
            value === v ? (strong ? 'bg-grad font-semibold' : 'glass-btn font-medium text-foreground') : 'hover:bg-white/[0.05]')}>{l}</button>
      ))}
    </div>
  )
}

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3">
      {/* menu, título e ação na mesma linha; no celular a descrição desce para baixo */}
      <div className="flex min-w-0 items-center gap-3">
        <MenuBtn />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="m-0 truncate text-[24px] font-semibold leading-tight tracking-[-0.025em] md:text-[30px]">{title}</h1>
          {sub && <p className="m-0 hidden text-[14px] leading-relaxed text-t2 sm:block">{sub}</p>}
        </div>
        {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
      </div>
      {sub && <p className="m-0 text-[14px] leading-relaxed text-t2 sm:hidden">{sub}</p>}
    </header>
  )
}

// estado vazio com os avatares da equipe
export function Empty({ avatars = ['jarvis', 'atlas', 'lira'], title, text, children }: { avatars?: string[]; title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rise flex flex-col items-center gap-4 rounded-[28px] border border-dashed border-white/[0.09] bg-white/[0.015] px-6 py-12 text-center">
      <span className="float flex -space-x-2.5">
        {avatars.map((a, i) => <span key={a} className="rounded-full bg-background p-1" style={{ opacity: 1 - i * 0.22 }}><Avatar bot={a} size={36} /></span>)}
      </span>
      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        {text && <p className="m-0 text-[13.5px] leading-relaxed text-t2">{text}</p>}
      </div>
      {children}
    </div>
  )
}

export const Skel = ({ className }: { className?: string }) => <span aria-hidden="true" className={cn('skel block', className)} />
