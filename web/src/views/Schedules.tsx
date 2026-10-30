import { useState } from 'react'
import { CalendarClock, ChevronDown, Mail, MessageSquare, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Dot, Empty, PageHeader, Seg, Tip, nameOf } from '@/components/bits'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { act, api, confirmAsk, openBot, toast, useStore } from '@/store'
import { btn, btn2, cn, dur, field } from '@/lib/utils'
import type { SchedRun, Schedule } from '@/types'

const TZ = 'America/Sao_Paulo'
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const when = (ts: number) => new Date(ts).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace('.', '')
// instante → "AAAA-MM-DDTHH:MM" no horário de São Paulo (valor do campo datetime-local)
const spLocal = (ts: number) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ts).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
export function freq(s: Pick<Schedule, 'kind' | 'time' | 'days' | 'every'> & { at?: number }) {
  if (s.kind === 'once') return s.at ? `Uma vez · ${when(s.at)}` : 'Uma vez'
  if (s.kind === 'interval') return s.every % 60 ? `A cada ${s.every} min` : `A cada ${s.every / 60} h`
  const d = [...s.days].sort().join()
  const days = !s.days.length || d === '0,1,2,3,4,5,6' ? 'Todo dia' : d === '1,2,3,4,5' ? 'Seg a sex' : d === '0,6' ? 'Fins de semana' : s.days.map((x) => DAYS[x]).join(', ')
  return `${days} às ${s.time}`
}
const RUN: Record<SchedRun['status'], { label: string; color: string }> = {
  running: { label: 'Rodando', color: '#4ADE80' }, done: { label: 'Executada', color: '#4ADE80' },
  failed: { label: 'Falhou', color: '#f43f5e' }, skipped: { label: 'Pulada', color: '#fbbf24' },
}
const save = (id: number, p: Partial<Schedule>) => act(api<Schedule>(`/api/schedules/${id}`, 'PATCH', p))

export function Schedules() {
  const list = useStore((s) => s.schedules)
  const bots = useStore((s) => s.bots)
  const [edit, setEdit] = useState<null | 'new' | Schedule>(null)
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pb-[calc(2rem+var(--sab))] pt-3 md:px-10 md:py-8">
      <PageHeader title="Agenda" sub="Tarefas que o bot faz sozinho no horário (fuso de São Paulo). O resultado cai na conversa com ele e, se quiser, no seu e-mail.">
        <button type="button" className={btn} onClick={() => setEdit('new')} disabled={!bots.length}><Plus size={16} />Nova</button>
      </PageHeader>
      {!list.length && (
        <Empty avatars={['jarvis', 'atlas', 'nova']} title="Nenhuma tarefa agendada"
          text="Ex.: todo dia às 8h, seg a sex, o Jarvis resume suas notícias e compromissos e manda no chat e por e-mail.">
          <button type="button" className={btn} onClick={() => setEdit('new')} disabled={!bots.length}><Plus size={16} />Criar agenda</button>
        </Empty>
      )}
      <div className="flex flex-col gap-2">
        {list.map((s) => {
          const bot = bots.find((b) => b.id === s.botId)
          const last = s.runs[0]
          const isOpen = open === s.id
          return (
            <article key={s.id} className={cn('rise rounded-[22px] border border-white/[0.07] bg-white/[0.025] px-4 py-3.5', s.paused && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Avatar bot={bot?.avatar ?? 'orion'} size={34} working={last?.status === 'running'} />
                <button type="button" className="flex min-w-0 flex-1 flex-col gap-0.5 text-left" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                  <span className="flex min-w-0 items-center gap-1.5 text-[14.5px] font-semibold">
                    <span className="truncate">{s.title}</span>{s.email && <Mail size={13} className="shrink-0 text-t3" aria-label="envia e-mail" />}
                    <ChevronDown size={14} className={cn('shrink-0 text-t3 transition-transform', isOpen && 'rotate-180')} />
                  </span>
                  <span className="truncate text-[12.5px] text-t3">
                    {nameOf(bots, s.botId)} · {freq(s)} · {s.done ? (s.runs[0]?.status === 'skipped' ? 'pulada (servidor desligado)' : 'executada') : s.paused ? 'pausada' : `próxima ${when(s.nextAt)}`}
                  </span>
                  {last && (
                    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-t2">
                      <Dot color={RUN[last.status].color} pulse={last.status === 'running'} />
                      <span className="truncate">{RUN[last.status].label} {when(last.ts)}{last.ms ? ` · ${dur(last.ms)}` : ''}{last.error ? ` · ${last.error}` : ''}{last.empty ? ' · sem novidades (silêncio)' : ''}{last.email ? ` · e-mail ${last.email}` : ''}</span>
                    </span>
                  )}
                </button>
                {/* celular: ações descem para uma linha própria e o título fica com a largura toda */}
                <div className="flex shrink-0 items-center gap-1 max-sm:basis-full max-sm:justify-end max-sm:border-t max-sm:border-white/[0.05] max-sm:pt-1.5">
                  <Tip label={s.paused ? 'Retomar' : 'Pausar'}><span className="inline-flex px-1.5"><Switch aria-label={s.paused ? 'Retomar' : 'Pausar'} checked={!s.paused} onCheckedChange={(on) => save(s.id, { paused: !on })} /></span></Tip>
                  <Tip label="Rodar agora"><button type="button" aria-label="Rodar agora" className={iconBtn} disabled={last?.status === 'running'}
                    onClick={() => act(api(`/api/schedules/${s.id}/run`, 'POST')).then((r) => r && toast(`${bot?.name ?? 'Bot'} começou: ${s.title}`))}><Play size={15} /></button></Tip>
                  <Tip label="Abrir conversa"><button type="button" aria-label="Abrir conversa" className={iconBtn} onClick={() => openBot(s.botId)}><MessageSquare size={15} /></button></Tip>
                  <Tip label="Editar"><button type="button" aria-label="Editar" className={iconBtn} onClick={() => setEdit(s)}><Pencil size={15} /></button></Tip>
                  <Tip label="Excluir"><button type="button" aria-label="Excluir" className={cn(iconBtn, 'hover:text-bad')}
                    onClick={async () => { if (await confirmAsk({ title: `Excluir “${s.title}”?`, body: 'A agenda e o histórico somem. As mensagens já enviadas ficam na conversa.', ok: 'Excluir', danger: true })) act(api(`/api/schedules/${s.id}`, 'DELETE')) }}><Trash2 size={15} /></button></Tip>
                </div>
              </div>
              {isOpen && (
                <div className="fade mt-3 flex flex-col gap-2 border-t border-white/[0.06] pt-3 text-[13px]">
                  <p className="m-0 whitespace-pre-wrap break-words text-t1">{s.prompt}</p>
                  {s.email && <p className="m-0 text-t3">E-mail para {s.email}</p>}
                  <h3 className="m-0 mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-t3">Histórico</h3>
                  {!s.runs.length && <p className="m-0 text-t3">Ainda não rodou.</p>}
                  {s.runs.map((r) => (
                    <div key={r.ts} className="flex min-w-0 items-start gap-2 text-t2">
                      <Dot color={RUN[r.status].color} className="mt-[7px]" />
                      <span className="min-w-0 break-words">{when(r.ts)} · {RUN[r.status].label}{r.manual ? ' (manual)' : ''}{r.ms ? ` · ${dur(r.ms)}` : ''}{r.error ? ` · ${r.error}` : ''}{r.empty ? ' · sem novidades (silêncio)' : ''}{r.email ? ` · e-mail ${r.email}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>
      {edit && <Editor key={edit === 'new' ? 'new' : edit.id} s={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}
const iconBtn = 'inline-flex size-9 shrink-0 items-center justify-center rounded-full text-t2 transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:opacity-40'
const Label = ({ children }: { children: React.ReactNode }) => <span className="text-[13px] text-t1">{children}</span>

function Editor({ s, onClose }: { s: Schedule | null; onClose: () => void }) {
  const bots = useStore((st) => st.bots)
  const chief = bots.find((b) => b.isChief) ?? bots[0]
  type Form = Pick<Schedule, 'botId' | 'title' | 'prompt' | 'kind' | 'time' | 'days' | 'every' | 'email' | 'paused'>
  const [f, setF] = useState<Form>(() => s ?? { botId: chief?.id ?? '', title: '', prompt: '', kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5], every: 60, email: '', paused: false })
  const at0 = s?.at ? spLocal(s.at) : spLocal(Math.ceil((Date.now() + 3600_000) / 900_000) * 900_000) // padrão: daqui a ~1 h
  const [at, setAt] = useState(at0)
  const up = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }))
  const [busy, setBusy] = useState(false)
  const ok = !!f.botId && !!f.prompt.trim() && (f.kind === 'interval' ? f.every >= 5 : f.kind === 'once' ? /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(at) : /^\d\d:\d\d$/.test(f.time))
  async function submit() {
    setBusy(true)
    const body = { botId: f.botId, title: f.title, prompt: f.prompt, kind: f.kind, time: f.time, days: f.days, every: f.every, email: f.email, paused: f.paused,
      ...(f.kind === 'once' && { at, paused: s?.kind === 'once' && at === at0 ? f.paused : false }) } // data nova reativa
    const r = await act(s ? api<Schedule>(`/api/schedules/${s.id}`, 'PATCH', body) : api<Schedule>('/api/schedules', 'POST', body))
    setBusy(false)
    if (r) { toast(s ? 'Agenda salva' : `Agendada: ${freq(r)}`); onClose() }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" onOpenAutoFocus={(e) => { if (!matchMedia('(min-width:768px)').matches) e.preventDefault() }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg"><CalendarClock size={18} />{s ? 'Editar agenda' : 'Nova agenda'}</DialogTitle>
          <DialogDescription>No horário, o servidor manda a instrução ao bot como se fosse você. Fuso de São Paulo.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (ok && !busy) submit() }}>
          <div className="flex flex-col gap-2"><Label>Bot</Label>
            <div className="flex flex-wrap gap-1.5">
              {bots.map((b) => (
                <button key={b.id} type="button" aria-pressed={f.botId === b.id} onClick={() => up({ botId: b.id })}
                  className={cn('flex h-10 items-center gap-2 rounded-full border pl-1 pr-3.5 text-[13.5px] transition-colors', f.botId === b.id ? 'border-brand/50 bg-brand/15 text-foreground' : 'border-white/[0.08] bg-white/[0.03] text-t2 hover:text-foreground')}>
                  <Avatar bot={b.avatar} size={30} />{b.name}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-2"><Label>Instrução</Label>
            <textarea className={cn(field, 'resize-y leading-relaxed')} rows={4} value={f.prompt} onChange={(e) => up({ prompt: e.target.value })}
              placeholder="Ex.: Me mande o briefing do dia: 3 manchetes do g1, compromissos da agenda e e-mails importantes. Curto." />
          </label>
          <label className="flex flex-col gap-2"><Label>Nome (opcional)</Label>
            <input className={field} value={f.title} onChange={(e) => up({ title: e.target.value })} placeholder="Briefing diário" />
          </label>
          <div className="flex flex-col gap-2"><Label>Quando</Label>
            <Seg value={f.kind} opts={[['once', 'Uma vez'], ['daily', 'Horário fixo'], ['interval', 'Intervalo']]} onChange={(kind) => up({ kind })} />
            {f.kind === 'once' ? (
              <div className="flex flex-wrap items-center gap-2">
                <input type="datetime-local" className={cn(field, 'w-[230px] [color-scheme:dark]')} value={at} min={spLocal(Date.now())} onChange={(e) => setAt(e.target.value)} aria-label="Data e hora" />
                <span className="w-full text-[12px] text-t3">Roda uma vez nesse horário (São Paulo) e se desativa. Bom para lembretes.</span>
              </div>
            ) : f.kind === 'daily' ? (
              <div className="flex flex-wrap items-center gap-2">
                <input type="time" className={cn(field, 'w-[130px] [color-scheme:dark]')} value={f.time} onChange={(e) => up({ time: e.target.value })} aria-label="Horário" />
                <div role="group" aria-label="Dias" className="flex flex-wrap gap-1">
                  {DAYS.map((d, i) => {
                    const on = f.days.includes(i)
                    return <button key={d} type="button" aria-pressed={on} onClick={() => up({ days: on ? f.days.filter((x) => x !== i) : [...f.days, i].sort() })}
                      className={cn('h-9 w-11 rounded-full border text-[13px] transition-colors', on ? 'border-brand/50 bg-brand/15 text-foreground' : 'border-white/[0.08] bg-white/[0.03] text-t3 hover:text-foreground')}>{d}</button>
                  })}
                </div>
                <span className="w-full text-[12px] text-t3">{freq(f)}{!f.days.length && ' (nenhum dia marcado = todo dia)'}</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-t2">
                A cada
                <input type="number" min={5} step={5} className={cn(field, 'w-[110px]')} value={f.every} onChange={(e) => up({ every: Number(e.target.value) })} aria-label="Minutos" />
                minutos (mín. 5)
              </div>
            )}
          </div>
          <label className="flex flex-col gap-2"><Label>Enviar também por e-mail (opcional)</Label>
            <input type="email" className={field} value={f.email} onChange={(e) => up({ email: e.target.value })} placeholder="voce@exemplo.com" />
            <span className="text-[12px] text-t3">Sai pelo Gmail conectado no Composio Connect (Configurações → Integrações).</span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={btn2} onClick={onClose}>Cancelar</button>
            <button type="submit" className={btn} disabled={!ok || busy}>{s ? 'Salvar' : 'Agendar'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
