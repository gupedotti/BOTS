import { AlertCircle, ArrowLeft, Check, MessageSquare, MousePointerClick, RotateCcw, Trash2, X } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Dot, Empty, PageHeader, TASK_STATUS, Tip, nameOf, taskTime, toolName, useNow } from '@/components/bits'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { act, api, openConv, set, useStore } from '@/store'
import { btn, btn2, cn, hhmm } from '@/lib/utils'
import type { Bot, Task } from '@/types'

const needs = (t: Task) => t.status === 'refused' || t.status === 'failed'
const suggestOf = (t: Task, bots: Bot[]) => {
  const s = t.refusal?.suggest?.toLowerCase()
  return s ? bots.find((b) => b.id.toLowerCase() === s || b.name.toLowerCase() === s) : undefined
}
const reassign = (t: Task, to: string) => act(api(`/api/tasks/${t.id}/reassign`, 'POST', { assignee: to }))
const remove = (t: Task) => act(api(`/api/tasks/${t.id}`, 'DELETE'))
const canRetry = (t: Task) => t.status === 'failed' // recusa = falta ferramenta: o mesmo bot recusaria de novo
const iconBtn = 'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-t2 transition-colors hover:bg-white/[0.08] hover:text-foreground'

export function Tasks() {
  const tasks = useStore((s) => s.tasks)
  const bots = useStore((s) => s.bots)
  const sel = useStore((s) => s.taskSel)
  const now = useNow(tasks.some((t) => t.status === 'running'))
  const pick = (st: Task['status'][], sort: (t: Task) => number = (t) => -t.createdAt) =>
    tasks.filter((t) => st.includes(t.status)).sort((a, b) => sort(a) - sort(b))
  const groups: [string, Task[]][] = [
    ['Em andamento', pick(['running'])],
    ['Na fila', pick(['queued'], (t) => t.createdAt)],
    ['Precisa de você', pick(['refused', 'failed'])],
    ['Concluídas', pick(['done', 'canceled'], (t) => -(t.endedAt ?? t.createdAt)).slice(0, 30)],
  ]
  const task = tasks.find((t) => t.id === sel)

  return (
    <div className="flex min-h-0 flex-1">
      <section aria-label="Lista de tarefas" className={cn('flex min-w-0 flex-1 flex-col gap-7 overflow-y-auto overscroll-contain px-4 pb-[calc(2rem+var(--sab))] pt-3 md:px-10 md:py-8', task && 'hidden md:flex')}>
        <PageHeader title="Tarefas" sub="Tudo que um bot pediu para outro, com quem fez e o que voltou." />
        {!tasks.length && (
          <Empty avatars={['jarvis', 'atlas', 'nova']} title="Nenhuma tarefa ainda"
            text="Quando o Jarvis delegar trabalho para outro bot, a tarefa aparece aqui com quem pediu, quem fez, quanto tempo levou e o resultado." />
        )}
        {groups.filter(([, l]) => l.length).map(([title, list]) => (
          <div key={title} className="flex flex-col gap-1">
            <h2 className={cn('m-0 mb-1.5 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.1em]', title === 'Precisa de você' ? 'text-warn' : 'text-t3')}>{title}<span className="rounded-full bg-white/[0.06] px-1.5 text-[10.5px] tracking-normal text-t2">{list.length}</span></h2>
            {list.map((t) => <Row key={t.id} t={t} bots={bots} tasks={tasks} now={now} active={t.id === sel} />)}
          </div>
        ))}
      </section>
      <section aria-label="Detalhe da tarefa" className={cn('min-w-0 flex-1 overflow-y-auto overscroll-contain border-white/[0.06] bg-panel px-4 pb-[calc(2rem+var(--sab))] pt-3 md:border-l md:px-8 md:py-8', !task && (tasks.length ? 'hidden md:flex md:items-center md:justify-center' : 'hidden'))}>
        {task ? <div key={task.id} className="view-in"><Detail t={task} bots={bots} tasks={tasks} now={now} /></div> : (
          <div className="flex flex-col items-center gap-3 text-center text-t3">
            <span className="glass-btn inline-flex size-12 items-center justify-center rounded-full"><MousePointerClick size={18} strokeWidth={1.6} /></span>
            <span className="text-[13.5px]">Selecione uma tarefa para ver a cadeia de delegação.</span>
          </div>
        )}
      </section>
    </div>
  )
}

function Row({ t, bots, tasks, now, active }: { t: Task; bots: Bot[]; tasks: Task[]; now: number; active: boolean }) {
  const sug = suggestOf(t, bots)
  const waiting = t.status === 'queued' && t.dependsOn.filter((d) => tasks.find((x) => x.id === d)?.status !== 'done')
  const sub = [`${nameOf(bots, t.requester)} → ${nameOf(bots, t.assignee)}`, `#${t.id}`, waiting && waiting.length ? `espera ${waiting.map((d) => '#' + d).join(', ')}` : '']
  if (needs(t)) sub.push(t.refusal ? `${nameOf(bots, t.assignee)} recusou: ${t.refusal.reason}` : 'falhou')
  return (
    <div className={cn('rise flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[20px] border border-transparent px-3.5 py-3 transition-colors duration-200 hover:bg-white/[0.04]', active && 'border-white/[0.08] bg-white/[0.05] hover:bg-white/[0.05]')}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => set({ taskSel: t.id })}>
        <Icon s={t.status} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 break-words text-[14.5px] font-medium leading-snug">{t.objective}</span>
          <span className="truncate text-xs text-t3">{sub.filter(Boolean).join(' · ')}</span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-t2">{taskTime(t, now)}</span>
      </button>
      {needs(t) && (
        <span className="ml-7 flex shrink-0 items-center gap-0.5 sm:ml-0">
          {sug && <button type="button" className="mr-1 h-8 whitespace-nowrap rounded-full bg-grad px-3.5 text-xs font-semibold" onClick={() => reassign(t, sug.id)}>Passar ao {sug.name}</button>}
          {canRetry(t) && <Tip label="Tentar de novo"><button type="button" aria-label="Tentar de novo" className={iconBtn} onClick={() => reassign(t, t.assignee)}><RotateCcw size={15} /></button></Tip>}
          <Tip label="Excluir (não seguir)"><button type="button" aria-label="Excluir tarefa" className={cn(iconBtn, 'hover:text-bad')} onClick={() => remove(t)}><Trash2 size={15} /></button></Tip>
        </span>
      )}
    </div>
  )
}

function Icon({ s }: { s: Task['status'] }) {
  if (s === 'running') return <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-ok" />
  if (s === 'queued') return <span className="size-4 shrink-0 rounded-full border-2 border-dashed border-white/20" />
  if (s === 'done') return <Check size={16} strokeWidth={2.2} className="shrink-0 text-ok" />
  if (s === 'canceled') return <X size={16} className="shrink-0 text-t3" />
  return <AlertCircle size={16} strokeWidth={2} className={cn('shrink-0', s === 'failed' ? 'text-live' : 'text-warn')} />
}

function Detail({ t, bots, tasks, now }: { t: Task; bots: Bot[]; tasks: Task[]; now: number }) {
  const bot = (id: string) => bots.find((b) => b.id === id)
  const st = TASK_STATUS[t.status]
  const live = t.status === 'running'

  // cadeia: sobe pelos parentId e monta Você → quem pediu → quem fez
  const chain: Task[] = []
  for (let c: Task | undefined = t; c && chain.length < 20; c = c.parentId != null ? tasks.find((x) => x.id === c!.parentId) : undefined) chain.unshift(c)
  const actors = ['user']
  for (const c of chain) {
    if (c.requester !== actors[actors.length - 1]) actors.push(c.requester)
    actors.push(c.assignee)
  }
  const last = actors.length - 1
  const stepSub = (i: number) => {
    if (i === 0) return `Pediu · ${hhmm(chain[0].createdAt)}`
    if (i < last) return `delegou para ${nameOf(bots, actors[i + 1])}`
    return { running: 'Executando', queued: 'Na fila', done: 'Concluiu', failed: 'Falhou', refused: 'Recusou', canceled: 'Cancelada' }[t.status]
  }
  const after = tasks.filter((x) => x.dependsOn.includes(t.id))
  const others = bots.filter((b) => b.id !== t.assignee)
  const line = (id: number) => `#${id} ${tasks.find((x) => x.id === id)?.objective ?? ''}`.trim()

  return (
    <div className="flex flex-col gap-6">
      <button type="button" className="glass-btn inline-flex h-10 items-center gap-1.5 self-start rounded-full pl-3 pr-4 text-[14px] text-t1 md:hidden" onClick={() => set({ taskSel: null })}><ArrowLeft size={16} />Tarefas</button>
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-t3">Tarefa #{t.id}</span>
        <h2 className="m-0 break-words text-[22px] font-semibold leading-snug tracking-[-0.015em] md:text-[26px]">{t.objective}</h2>
        <span className="inline-flex flex-wrap items-center gap-1.5 text-[13px] text-t1">
          <Dot color={st.color} />{live ? `${nameOf(bots, t.assignee)} trabalhando` : st.label} {taskTime(t, now) && `· ${taskTime(t, now)}`}
          {live && <> · <button type="button" className="text-[#93c5fd] underline decoration-[#93c5fd]/40 underline-offset-2" onClick={() => { openConv(t.convId); set({ selBot: t.assignee, panel: true }) }}>ver ao vivo</button></>}
        </span>
      </div>

      <div className="flex flex-col">
        <h3 className="m-0 mb-3.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-t3">Cadeia de delegação</h3>
        {actors.map((a, i) => (
          <div key={i} className="flex gap-3.5">
            <span className="flex flex-col items-center">
              {a === 'user'
                ? <span className="bg-grad inline-flex size-[30px] items-center justify-center rounded-full text-xs font-semibold">V</span>
                : <Avatar bot={bot(a)?.avatar ?? 'jarvis'} size={30} working={live && i === last} />}
              {i < last && <span className="min-h-[22px] w-px flex-1 bg-gradient-to-b from-brand/50 to-white/[0.08]" />}
            </span>
            <span className={cn('flex flex-col gap-0.5', i < last && 'pb-4')}>
              <span className="font-medium">{nameOf(bots, a)}</span>
              <span className="text-[13px] text-t2">{stepSub(i)}</span>
            </span>
          </div>
        ))}
      </div>

      <dl className="panel-card m-0 grid grid-cols-1 gap-x-4 gap-y-1 p-[18px] text-[14px] sm:grid-cols-[130px_1fr] sm:gap-y-3 md:grid-cols-[140px_1fr]">
        <Dl k="Objetivo" v={t.objective} />
        <Dl k="Entradas" v={t.inputs} />
        <Dl k="Pronto quando" v={t.doneWhen} />
        <Dl k="Requer" v={t.requires.map(toolName).join(', ')} />
        <Dl k="Depende de" v={t.dependsOn.map(line).join('\n')} />
        <Dl k="Depois" v={after.map((x) => `${line(x.id)} · ${nameOf(bots, x.assignee)}`).join('\n')} />
      </dl>

      {needs(t) && <HowTo t={t} bots={bots} />}
      {t.result && <Block title={t.status === 'failed' ? 'Erro / resposta do bot' : 'Resultado'} text={t.result} />}
      {t.refusal && <Block title={`${nameOf(bots, t.assignee)} recusou`} text={t.refusal.reason + (t.refusal.suggest ? `\nSugestão: ${nameOf(bots, suggestOf(t, bots)?.id ?? t.refusal.suggest)}` : '')} warn />}

      <div className="flex flex-wrap items-center gap-2.5">
        {needs(t) && suggestOf(t, bots) && <button type="button" className={btn} onClick={() => reassign(t, suggestOf(t, bots)!.id)}>Passar ao {suggestOf(t, bots)!.name}</button>}
        {(needs(t) || t.status === 'queued') && !!others.length && (
          <Select value="" onValueChange={(v) => reassign(t, v)}>
            <SelectTrigger className="h-9 rounded-full px-4"><SelectValue placeholder="Passar para…" /></SelectTrigger>
            <SelectContent>{others.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {canRetry(t) && <button type="button" className={suggestOf(t, bots) ? btn2 : btn} onClick={() => reassign(t, t.assignee)}><RotateCcw size={15} />Tentar de novo</button>}
        {needs(t) && t.convId && <button type="button" className={btn2} onClick={() => openConv(t.convId)}><MessageSquare size={15} />Abrir conversa</button>}
        {(t.status === 'queued' || live) && <button type="button" className={btn2} onClick={() => act(api(`/api/tasks/${t.id}/cancel`, 'POST'))}>Cancelar</button>}
        {!(t.status === 'queued' || live) && <button type="button" className={cn(btn2, 'hover:text-bad')} onClick={() => remove(t)}><Trash2 size={15} />Excluir</button>}
      </div>
    </div>
  )
}

// passo a passo do que dá para fazer com uma tarefa que falhou ou foi recusada
function HowTo({ t, bots }: { t: Task; bots: Bot[] }) {
  const who = nameOf(bots, t.assignee)
  const sug = suggestOf(t, bots)
  const why = t.refusal ? `${who} recusou: ${t.refusal.reason}.` : `${who} não conseguiu terminar${t.result ? ' (erro abaixo)' : ''}.`
  const steps = [
    canRetry(t) && <><b>Tentar de novo</b>: o {who} refaz a tarefa (bom para erro passageiro ou tempo esgotado).</>,
    <><b>Passar para outro bot</b>{sug ? ` (sugestão: ${sug.name})` : ''}: escolha quem tem o que falta.</>,
    t.convId && <><b>Abrir conversa</b>: explique ou mande o que falta (print, arquivo, login) para o {nameOf(bots, t.requester)} seguir.</>,
    <><b>Excluir</b>: se não quiser seguir adiante; a tarefa some da lista.</>,
  ].filter(Boolean)
  return (
    <div className="flex flex-col gap-2.5 rounded-[22px] border border-warn/30 bg-warn/[0.05] p-[18px]">
      <h3 className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-warn">Como resolver</h3>
      <p className="m-0 break-words text-[14.5px] leading-relaxed text-t1">{why}</p>
      <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-[14px] leading-relaxed text-t2 [&_b]:font-semibold [&_b]:text-foreground">
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    </div>
  )
}

const Dl = ({ k, v }: { k: string; v?: string }) =>
  v ? <><dt className="mt-2 text-[12.5px] text-t3 first:mt-0 sm:mt-0 sm:text-[14px]">{k}</dt><dd className="m-0 whitespace-pre-wrap break-words text-t1">{v}</dd></> : null

const Block = ({ title, text, warn }: { title: string; text: string; warn?: boolean }) => (
  <div className={cn('flex flex-col gap-2 rounded-[22px] border p-[18px]', warn ? 'border-warn/30 bg-warn/[0.05]' : 'border-white/[0.07] bg-white/[0.025]')}>
    <h3 className={cn('m-0 text-[11px] font-semibold uppercase tracking-[0.1em]', warn ? 'text-warn' : 'text-t3')}>{title}</h3>
    <p className="m-0 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-t1">{text}</p>
  </div>
)
