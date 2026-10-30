// Respostas ricas: blocos de código com linguagem especial viram componentes no chat.
// ```opcoes · ```formulario · ```aprovar · ```grafico · ```linha-do-tempo (+ avisos, checklist e prévia de link no Markdown)
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ExternalLink, Loader2, ShieldCheck } from 'lucide-react'
import { api, send } from '@/store'
import { cn } from '@/lib/utils'

// mensagem dona do Markdown: quem responde, se ainda está aberta (sem resposta sua depois) e checklist salva
export type MsgInfo = { id?: number | string; convId?: string; open?: boolean; streaming?: boolean; checks?: Record<string, boolean> }
export const MsgCtx = createContext<MsgInfo>({})
export const DRAFT = 'gubots:draft' // evento: texto pronto para editar no composer
export const RICH = new Set(['opcoes', 'opções', 'options', 'formulario', 'formulário', 'form', 'aprovar', 'approve', 'grafico', 'gráfico', 'chart', 'linha-do-tempo', 'timeline'])

const reply = (c: MsgInfo, text: string) => { if (c.convId) send(c.convId, text) }
function json<T>(s: string): T | null { try { return JSON.parse(s) as T } catch { return null } }
const Building = ({ what }: { what: string }) => (
  <div className="my-3 flex h-12 items-center gap-2 rounded-2xl border border-white/[0.07] bg-surface px-4 text-[13px] text-t3"><Loader2 size={14} className="animate-spin" />montando {what}…</div>
)
const Bad = ({ text }: { text: string }) => <pre className="my-3 overflow-auto rounded-2xl border border-white/[0.07] bg-surface p-3 text-xs text-t2">{text}</pre>
const chip = 'inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-4 text-[14px] font-medium text-t1 transition-[background-color,filter] hover:bg-white/[0.08] disabled:pointer-events-none disabled:opacity-40'
const main = 'inline-flex h-9 items-center gap-2 rounded-full bg-grad px-4 text-[14px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-40'

export function RichBlock({ lang, text }: { lang: string; text: string }) {
  const k = lang.normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (k === 'opcoes' || k === 'options') return <Options text={text} />
  if (k === 'formulario' || k === 'form') return <Form text={text} />
  if (k === 'aprovar' || k === 'approve') return <Approve text={text} />
  if (k === 'grafico' || k === 'chart') return <Chart text={text} />
  return <Timeline text={text} />
}

// 1 · botões de resposta rápida: um toque responde; somem depois que você responde
function Options({ text }: { text: string }) {
  const c = useContext(MsgCtx)
  const opts = text.split('\n').map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 8)
  if (!c.open && !c.streaming) return null
  return (
    <div className="my-3 flex flex-wrap gap-2">
      {opts.map((o, i) => <button key={o} type="button" disabled={!c.open || c.streaming} onClick={() => reply(c, o)} className={i === 0 ? main : chip}>{o}</button>)}
    </div>
  )
}

// 2 · aprovar antes de agir: o bot para e só segue depois de "Aprovado"
type ApproveData = { titulo?: string; itens?: Record<string, string>; texto?: string }
function Approve({ text }: { text: string }) {
  const c = useContext(MsgCtx)
  const d = json<ApproveData>(text)
  if (!d) return c.streaming ? <Building what="aprovação" /> : <Bad text={text} />
  const title = d.titulo || 'Ação'
  return (
    <div className="my-3 overflow-hidden rounded-[20px] border border-warn/25 bg-surface">
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3 text-[14px] font-semibold"><ShieldCheck size={16} className="shrink-0 text-warn" />{title}<span className="ml-auto text-[11.5px] font-medium text-warn">{c.open ? 'precisa da sua aprovação' : 'respondido'}</span></div>
      <div className="flex flex-col gap-1.5 px-4 py-3 text-[14px]">
        {Object.entries(d.itens ?? {}).map(([k, v]) => <div key={k} className="flex gap-3"><span className="w-20 shrink-0 text-t3">{k}</span><span className="min-w-0 break-words">{String(v)}</span></div>)}
        {d.texto && <p className="m-0 mt-1 whitespace-pre-wrap break-words rounded-xl bg-white/[0.03] p-3 text-t2">{d.texto}</p>}
      </div>
      {c.open && !c.streaming && (
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          <button type="button" className={main} onClick={() => reply(c, `✅ Aprovado: ${title}`)}><Check size={15} />Aprovar</button>
          <button type="button" className={chip} onClick={() => dispatchEvent(new CustomEvent(DRAFT, { detail: `✏️ Antes de "${title}", mude: ` }))}>Editar</button>
          <button type="button" className={cn(chip, 'text-t2')} onClick={() => reply(c, `❌ Cancelado: ${title}`)}>Cancelar</button>
        </div>
      )}
    </div>
  )
}

// 3 · formulário: vários dados de uma vez, já com o que o bot sabe; enviar responde com os campos
type Field = { nome?: string; rotulo?: string; tipo?: string; opcoes?: string[]; valor?: string | number; obrigatorio?: boolean }
type FormData = { titulo?: string; enviar?: string; campos?: Field[] }
const input = 'h-10 w-full min-w-0 rounded-xl border border-white/[0.1] bg-[#0a0a0b] px-3 text-[15px] text-foreground outline-none transition-colors focus:border-brand/60'
function Form({ text }: { text: string }) {
  const c = useContext(MsgCtx)
  const d = json<FormData>(text)
  const fields = useMemo(() => (d?.campos ?? []).map((f, i) => ({ ...f, key: f.nome || f.rotulo || String(i), label: f.rotulo || f.nome || `Campo ${i + 1}` })), [text]) // eslint-disable-line react-hooks/exhaustive-deps
  const [v, setV] = useState<Record<string, string>>({})
  useEffect(() => setV(Object.fromEntries(fields.map((f) => [f.key, f.valor != null ? String(f.valor) : '']))), [fields])
  if (!d) return c.streaming ? <Building what="formulário" /> : <Bad text={text} />
  const off = !c.open || c.streaming
  const missing = fields.some((f) => f.obrigatorio && !v[f.key]?.trim())
  const submit = () => reply(c, `📝 ${d.titulo || 'Formulário'}\n` + fields.map((f) => `- ${f.label}: ${v[f.key]?.trim() || '(vazio)'}`).join('\n'))
  return (
    <form className="my-3 overflow-hidden rounded-[20px] border border-white/[0.08] bg-surface" onSubmit={(e) => { e.preventDefault(); if (!off && !missing) submit() }}>
      {d.titulo && <div className="border-b border-white/[0.06] px-4 py-3 text-[14px] font-semibold">📝 {d.titulo}</div>}
      <fieldset disabled={off} className="m-0 grid grid-cols-1 gap-3 border-0 p-4 sm:grid-cols-2">
        {fields.map((f) => {
          const t = (f.tipo ?? 'texto').toLowerCase(), set = (x: string) => setV((o) => ({ ...o, [f.key]: x }))
          const wide = t === 'escolha' || t === 'longo' || (f.opcoes?.length ?? 0) > 0 && t !== 'lista'
          return (
            <label key={f.key} className={cn('flex min-w-0 flex-col gap-1.5 text-[12.5px] text-t2', wide && 'sm:col-span-2')}>
              <span>{f.label}{f.obrigatorio && <span className="text-warn"> *</span>}</span>
              {t === 'escolha' || (f.opcoes?.length && t !== 'lista')
                ? <span className="flex flex-wrap gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-1 self-start">
                    {(f.opcoes ?? []).map((o) => <button key={o} type="button" onClick={() => set(o)} className={cn('rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors', v[f.key] === o ? 'bg-brand/20 text-foreground' : 'text-t2 hover:text-foreground')}>{o}</button>)}
                  </span>
                : t === 'lista'
                  ? <select className={input} value={v[f.key] ?? ''} onChange={(e) => set(e.target.value)}><option value="" />{(f.opcoes ?? []).map((o) => <option key={o}>{o}</option>)}</select>
                  : t === 'longo'
                    ? <textarea className={cn(input, 'h-24 py-2')} value={v[f.key] ?? ''} onChange={(e) => set(e.target.value)} />
                    : <input className={input} inputMode={t === 'numero' ? 'decimal' : undefined} placeholder={t === 'data' ? 'dd/mm/aaaa' : undefined} value={v[f.key] ?? ''} onChange={(e) => set(e.target.value)} />}
            </label>
          )
        })}
      </fieldset>
      {!off && (
        <div className="flex gap-2 px-4 pb-4">
          <button type="submit" className={main} disabled={missing}>{d.enviar || 'Enviar'}</button>
          <button type="button" className={cn(chip, 'text-t2')} onClick={() => reply(c, `❌ Cancelado: ${d.titulo || 'formulário'}`)}>Cancelar</button>
        </div>
      )}
    </form>
  )
}

// 4 · gráfico de barras ou linha (SVG próprio, sem dependência)
type ChartData = { tipo?: string; titulo?: string; rotulos?: string[]; series?: { nome?: string; valores?: number[] }[]; prefixo?: string; sufixo?: string }
const COLORS = ['#3b82f6', '#22d3ee', '#a855f7', '#f59e0b', '#22c55e', '#f43f5e']
function fmt(n: number, d: ChartData, short = false) {
  const a = Math.abs(n)
  const s = short && a >= 1000 ? (a >= 1e6 ? (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k') : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  return `${d.prefixo ?? ''}${s}${d.sufixo ?? ''}`
}
function Chart({ text }: { text: string }) {
  const c = useContext(MsgCtx)
  const d = json<ChartData>(text)
  const [hover, setHover] = useState<number | null>(null)
  if (!d) return c.streaming ? <Building what="gráfico" /> : <Bad text={text} />
  const labels = d.rotulos ?? [], series = (d.series ?? []).filter((s) => s.valores?.length).slice(0, 6)
  const vals = series.flatMap((s) => s.valores!.map(Number).filter(Number.isFinite))
  if (!labels.length || !vals.length) return <Bad text={text} />
  const W = 640, H = 240, L = 54, R = 12, T = 16, B = 30
  const max = Math.max(...vals, 0), min = Math.min(...vals, 0)
  const span = max - min || 1, step = 10 ** Math.floor(Math.log10(span / 4)), tick = [1, 2, 2.5, 5, 10].map((m) => m * step).find((t) => span / t <= 5)!
  const top = Math.ceil(max / tick) * tick, bot = Math.floor(min / tick) * tick
  const y = (n: number) => T + (H - T - B) * (1 - (n - bot) / (top - bot || 1))
  const band = (W - L - R) / labels.length
  const line = d.tipo === 'linha' || d.tipo === 'line'
  const ticks: number[] = []; for (let t = bot; t <= top + tick / 2; t += tick) ticks.push(t)
  const bw = Math.min(46, (band * 0.7) / series.length)
  return (
    <div className="my-3 rounded-[20px] border border-white/[0.07] bg-surface p-4">
      {d.titulo && <div className="mb-2 text-[13.5px] font-semibold">{d.titulo}</div>}
      {series.length > 1 && <div className="mb-2 flex flex-wrap gap-3 text-xs text-t2">{series.map((s, i) => <span key={i} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: COLORS[i] }} />{s.nome}</span>)}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={d.titulo || 'gráfico'} onMouseLeave={() => setHover(null)}>
        <defs>{COLORS.map((col, i) => <linearGradient key={i} id={`gb-g${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity="1" /><stop offset="1" stopColor={col} stopOpacity="0.55" /></linearGradient>)}</defs>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" /><text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#76767f">{fmt(t, d, true)}</text></g>)}
        {labels.map((l, i) => <text key={i} x={L + band * (i + 0.5)} y={H - 10} textAnchor="middle" fontSize="11" fill={hover === i ? '#e7e7ea' : '#a1a1aa'}>{l.length > 10 ? l.slice(0, 9) + '…' : l}</text>)}
        {labels.map((_, i) => <rect key={i} x={L + band * i} y={T} width={band} height={H - T - B} fill={hover === i ? 'rgba(255,255,255,0.03)' : 'transparent'} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />)}
        {series.map((s, si) => line
          ? <g key={si} className="pointer-events-none">
              <polyline fill="none" stroke={COLORS[si]} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={s.valores!.map((v, i) => `${L + band * (i + 0.5)},${y(Number(v))}`).join(' ')} />
              {s.valores!.map((v, i) => <circle key={i} cx={L + band * (i + 0.5)} cy={y(Number(v))} r={hover === i ? 5 : 3.5} fill="#111113" stroke={COLORS[si]} strokeWidth="2" />)}
            </g>
          : <g key={si} className="pointer-events-none">{s.valores!.map((v, i) => {
              const x = L + band * (i + 0.5) - (bw * series.length) / 2 + bw * si, y0 = y(Math.max(0, bot)), y1 = y(Number(v))
              return <rect key={i} x={x + 1} y={Math.min(y0, y1)} width={bw - 2} height={Math.max(1, Math.abs(y0 - y1))} rx={Math.min(6, bw / 4)} fill={`url(#gb-g${si})`} opacity={hover == null || hover === i ? 1 : 0.55} />
            })}</g>)}
        {hover != null && (
          <g className="pointer-events-none">
            {series.map((s, si) => <text key={si} x={L + band * (hover + 0.5)} y={Math.max(12, y(Math.max(...series.map((x) => Number(x.valores![hover] ?? 0)))) - 8 - si * 14)} textAnchor="middle" fontSize="12" fontWeight="600" fill={series.length > 1 ? COLORS[si] : '#fff'}>{fmt(Number(s.valores![hover] ?? 0), d)}</text>)}
          </g>
        )}
      </svg>
    </div>
  )
}

// 8 · linha do tempo: "dd/mm/aaaa | texto" por linha; datas futuras ficam em destaque (prazo)
function parseDate(s: string) {
  const m = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(s)
  if (!m) return null
  const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getFullYear()
  return new Date(y, Number(m[2]) - 1, Number(m[1]))
}
function Timeline({ text }: { text: string }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const items = text.split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).map((l) => {
    const [a, ...b] = l.split(/\s*[|]\s*|\s+[—–-]\s+|:\s+/)
    const rest = b.join(' · ')
    const dt = parseDate(a)
    return { when: rest ? a : '', what: rest || a, future: !!dt && dt >= today }
  })
  return (
    <div className="relative my-3 flex flex-col gap-3.5 pl-7 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-0.5 before:bg-white/[0.08]">
      {items.map((it, i) => (
        <div key={i} className="relative text-[14.5px] leading-snug">
          <span className={cn('absolute -left-[25px] top-[3px] size-3.5 rounded-full border-2 bg-surface', it.future ? 'border-warn' : 'border-brand')} />
          {it.when && <div className={cn('text-[12px]', it.future ? 'font-medium text-warn' : 'text-t3')}>{it.when}{it.future && ' · a vencer'}</div>}
          <div>{it.what}</div>
        </div>
      ))}
    </div>
  )
}

// 7 · avisos: > [!aviso] / [!ok] / [!erro] / [!dica] (também NOTE, TIP, WARNING, CAUTION, IMPORTANT)
export const CALLOUT: Record<string, { icon: string; label: string; cls: string }> = {
  aviso: { icon: '⚠️', label: 'Atenção', cls: 'border-warn/25 bg-warn/[0.06] text-[#fde68a]' },
  ok: { icon: '✅', label: 'Pronto', cls: 'border-ok/25 bg-ok/[0.06] text-[#bbf7d0]' },
  erro: { icon: '⛔', label: 'Erro', cls: 'border-live/25 bg-live/[0.06] text-[#fecdd3]' },
  dica: { icon: '💡', label: 'Dica', cls: 'border-brand/30 bg-brand/[0.07] text-[#bfdbfe]' },
}
export const CALLOUT_ALIAS: Record<string, string> = { warning: 'aviso', caution: 'erro', important: 'aviso', note: 'dica', tip: 'dica', info: 'dica', sucesso: 'ok', success: 'ok', error: 'erro', atencao: 'aviso', nota: 'dica' }
export function Callout({ kind, children }: { kind: string; children: ReactNode }) {
  const k = CALLOUT[kind] ?? CALLOUT.dica
  return (
    <div className={cn('callout my-3 flex gap-2.5 rounded-2xl border px-4 py-3 text-[14.5px]', k.cls)}>
      <span className="shrink-0 leading-[1.6]">{k.icon}</span>
      <div className="min-w-0 flex-1"><b className="block text-[13px]">{k.label}</b>{children}</div>
    </div>
  )
}

// 6 · checklist: marca e salva na mensagem (vale em todos os aparelhos)
export function TaskBox({ k, checked }: { k: string; checked: boolean }) {
  const c = useContext(MsgCtx)
  const on = c.checks?.[k] ?? checked
  const can = typeof c.id === 'number'
  return (
    <button type="button" role="checkbox" aria-checked={on} disabled={!can} onClick={() => api(`/api/messages/${c.id}/check`, 'POST', { key: k, on: !on }).catch(() => {})}
      className={cn('task-box mr-2 inline-flex size-5 shrink-0 translate-y-[3px] items-center justify-center rounded-[7px] border-[1.5px] align-top transition-colors', on ? 'border-brand bg-brand text-white' : 'border-white/25 hover:border-white/50')}>
      {on && <Check size={13} strokeWidth={3} />}
    </button>
  )
}
export function TaskProgress({ keys, initial }: { keys: string[]; initial: boolean[] }) {
  const c = useContext(MsgCtx)
  const done = keys.filter((k, i) => c.checks?.[k] ?? initial[i]).length
  return (
    <div className="mb-1.5 flex items-center gap-2.5 text-[12px] text-t3">
      <span className="tabular-nums">{done} de {keys.length}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]"><span className="block h-full rounded-full bg-[linear-gradient(90deg,#2563eb,#06b6d4)] transition-[width] duration-500" style={{ width: `${(done / keys.length) * 100}%` }} /></span>
    </div>
  )
}

// 9 · prévia de link: link sozinho numa linha vira cartão (título, descrição e imagem do site)
type Preview = { url: string; title?: string; description?: string; image?: string; site?: string }
const previews = new Map<string, Promise<Preview | null>>()
export function LinkCard({ href, children }: { href: string; children: ReactNode }) {
  const [p, setP] = useState<Preview | null | undefined>(undefined)
  useEffect(() => {
    let dead = false
    if (!previews.has(href)) previews.set(href, api<Preview>('/api/preview?url=' + encodeURIComponent(href)).catch(() => null))
    previews.get(href)!.then((r) => { if (!dead) setP(r) })
    return () => { dead = true }
  }, [href])
  const host = (() => { try { return new URL(href).hostname.replace(/^www\./, '') } catch { return href } })()
  if (p === null || (p && !p.title)) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="link-card my-2 flex max-w-[560px] overflow-hidden rounded-[18px] border border-white/[0.08] bg-surface !no-underline transition-colors hover:border-white/[0.16]">
      {p?.image && <img src={p.image} alt="" loading="lazy" className="w-32 shrink-0 object-cover sm:w-40" onError={(e) => (e.currentTarget.style.display = 'none')} />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 px-3.5 py-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-t3"><ExternalLink size={11} />{p?.site || host}</span>
        {p ? <span className="line-clamp-2 text-[14px] font-semibold leading-snug text-foreground">{p.title}</span> : <span className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" />}
        {p?.description && <span className="line-clamp-2 text-[13px] leading-snug text-t2">{p.description}</span>}
      </span>
    </a>
  )
}

