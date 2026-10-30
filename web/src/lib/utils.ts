import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...i: ClassValue[]) => twMerge(clsx(i))

// ---- classes reutilizadas ----
const tr = 'transition-[background-color,border-color,color,opacity,box-shadow,filter] duration-200'
// principal: pílula com gradiente azul → ciano (acento do app)
export const btn = `inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-grad px-5 text-sm font-semibold whitespace-nowrap ${tr} hover:brightness-110 disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none`
// secundário: vidro
export const btn2 = `inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.04] px-4 text-sm text-foreground whitespace-nowrap ${tr} hover:border-white/[0.16] hover:bg-white/[0.08] disabled:pointer-events-none disabled:opacity-40`
export const btnDanger = `inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full border border-live/30 bg-live/10 px-4 text-sm font-medium text-bad whitespace-nowrap ${tr} hover:bg-live/20 disabled:pointer-events-none disabled:opacity-40`
export const iconBtn = `inline-flex size-9 shrink-0 items-center justify-center rounded-full text-t2 ${tr} hover:bg-white/[0.07] hover:text-foreground disabled:pointer-events-none disabled:opacity-40`
// botão redondo de vidro (cabeçalhos, como na referência)
export const roundBtn = `glass-btn inline-flex size-11 shrink-0 items-center justify-center rounded-full text-foreground ${tr} hover:brightness-125 disabled:pointer-events-none disabled:opacity-40`
export const field = `w-full rounded-2xl border border-white/[0.09] bg-white/[0.035] px-4 py-2.5 text-foreground ${tr} hover:border-white/[0.15] focus:border-brand/60 focus:bg-white/[0.05] focus:shadow-[0_0_0_4px_rgba(59,130,246,0.14)]`
export const card = 'panel-card'

// ---- formatação ----
export const hhmm = (ts: number) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
export const hhmmss = (ts: number) => new Date(ts).toLocaleTimeString('pt-BR', { hour12: false })
export const dayMonth = (ts: number) => new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '')
export const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export const size = (n: number) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
export const ago = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `${m} min`
  if (m < 1440) return `${Math.round(m / 60)} h`
  return dayMonth(ts)
}
export const dayLabel = (ts: number) => {
  const d = new Date(ts), t = new Date()
  const diff = Math.round((new Date(t.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { weekday: diff < 7 ? 'long' : undefined, day: 'numeric', month: 'long', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' })
}
export const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite' }
export async function copy(text: string) { try { await navigator.clipboard.writeText(text); return true } catch { return false } }
