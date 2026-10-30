import { useEffect, useState } from 'react'
import { MessageSquare, Monitor, Pencil, Plus, Sparkles, X } from 'lucide-react'
import { AVATARS, AVATAR_COLORS, Avatar, splitAvatar, withColor } from '@/components/Avatar'
import { Dot, EFFORTS, Empty, PageHeader, Seg, Skel, TOOLS, botState, engineName, modelName, toolName } from '@/components/bits'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { act, api, confirmAsk, dropBot, loadModels, openBot, putBot, set, useStore } from '@/store'
import { btn, btn2, btnDanger, cn, field } from '@/lib/utils'
import type { Bot, Effort, Engine } from '@/types'


export function Bots() {
  const bots = useStore((s) => s.bots)
  const tasks = useStore((s) => s.tasks)
  const models = useStore((s) => s.models)
  const loaded = useStore((s) => s.loaded)
  useEffect(() => { loadModels() }, [])
  const add = () => set({ botDialog: 'new' })
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-7 px-4 pb-[calc(2rem+var(--sab))] pt-3 md:px-10 md:py-8">
        <PageHeader title="Bots" sub="Sua equipe. O chefe vê esta lista para decidir quem faz o quê.">
          <button type="button" className={cn(btn, 'px-4 sm:px-5')} onClick={add}><Plus size={16} strokeWidth={2.2} />Novo bot</button>
        </PageHeader>

        {loaded && bots.length === 1 && (
          <div className="rise relative flex flex-col gap-4 overflow-hidden rounded-[28px] border border-brand/20 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(59,130,246,0.16),transparent_60%),rgba(255,255,255,0.02)] p-5 sm:flex-row sm:items-center sm:gap-5 md:p-6">
            <span className="float flex shrink-0 -space-x-3">
              <span className="rounded-full bg-black p-1"><Avatar bot={bots[0].avatar} size={44} /></span>
              {['atlas', 'lira', 'vega'].map((a, i) => <span key={a} className="rounded-full bg-black p-1" style={{ opacity: 0.55 - i * 0.15 }}><Avatar bot={a} size={44} /></span>)}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[15px] font-semibold">Hoje a equipe é só o {bots[0].name}</span>
              <span className="text-[13.5px] leading-relaxed text-t2">Crie especialistas (pesquisa, e-mail, planilhas, redes sociais) e o {bots[0].name} passa a delegar o trabalho para eles.</span>
            </div>
            <button type="button" className={cn(btn, 'self-start sm:self-center')} onClick={add}><Sparkles size={15} />Criar especialista</button>
          </div>
        )}

        {!loaded && <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{[0, 1].map((i) => <Skel key={i} className="h-[260px] rounded-3xl" />)}</div>}
        {loaded && !bots.length && <Empty title="Nenhum bot ainda" text="Crie o primeiro bot e descreva o trabalho dele como faria com uma pessoa da equipe."><button type="button" className={btn} onClick={add}><Plus size={16} />Novo bot</button></Empty>}

        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {bots.map((b, i) => {
            const st = botState(b, tasks, bots)
            return (
              <article key={b.id} style={{ animationDelay: i * 40 + 'ms' }}
                className="rise panel-card group @container flex min-w-0 flex-col gap-4 p-5 transition-[border-color,background-color] duration-300 hover:border-white/[0.14]">
                <div className="flex items-center gap-3.5">
                  <span className={cn('glass-btn relative inline-flex rounded-full p-2 transition-shadow duration-300', st.working && 'shadow-[0_0_0_2px_rgba(74,222,128,0.45),0_0_24px_rgba(74,222,128,0.25)]')}><Avatar bot={b.avatar} size={40} working={st.working} /></span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[17px] font-semibold tracking-[-0.01em]">{b.name}</span>
                      {b.isChief && <span className="shrink-0 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-[#93c5fd]">Chefe</span>}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-t2"><Dot color={st.color} pulse={st.working} />{st.label}</span>
                  </div>
                </div>
                <p className="m-0 line-clamp-3 min-h-[2.7rem] break-words text-[14px] leading-[1.4rem] text-t1">{b.job || <span className="text-t3">Sem descrição de trabalho.</span>}</p>
                <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-4">
                  <Row k="Motor" v={`${engineName(b.engine)} · ${modelName(models, b.engine, b.model)} · ${EFFORTS.find((e) => e[0] === b.effort)?.[1] ?? b.effort}`} />
                  <Row k="Ferramentas" v={b.tools.map(toolName).join(', ')} />
                  {!!b.composio.length && <Row k="Apps" v={b.composio.join(', ')} />}
                  {!!b.logins.length && <Row k="Logins" v={b.logins.join(', ')} />}
                </div>
                {/* ações numa linha só: Conversar ocupa o espaço; Computador e Editar viram ícones quando o cartão é estreito */}
                <div className="mt-auto flex items-center gap-2 pt-1">
                  <button type="button" className={cn(btn, 'h-11 min-w-0 flex-1 px-4')} onClick={() => openBot(b.id)}><MessageSquare size={16} />Conversar</button>
                  {b.tools.includes('browser') && (
                    <button type="button" aria-label={`Computador de ${b.name}`} title="Computador" className={cn(btn2, 'h-11 w-11 px-0 @sm:w-auto @sm:px-4')} onClick={() => openBot(b.id, true)}>
                      <Monitor size={17} /><span className="hidden @sm:inline">Computador</span>
                    </button>
                  )}
                  <button type="button" aria-label={`Editar ${b.name}`} title="Editar" className={cn(btn2, 'h-11 w-11 px-0 @sm:w-auto @sm:px-4')} onClick={() => set({ botDialog: b.id })}>
                    <Pencil size={16} /><span className="hidden @sm:inline">Editar</span>
                  </button>
                </div>
              </article>
            )
          })}
          {loaded && !!bots.length && (
            <button type="button" onClick={add}
              className="rise group flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-[24px] border border-dashed border-white/[0.12] p-5 text-t2 transition-colors duration-300 hover:border-brand/40 hover:bg-brand/[0.03] hover:text-foreground">
              <span className="bg-grad inline-flex size-12 items-center justify-center rounded-full transition-transform duration-300 ease-[var(--spring)] group-hover:scale-110"><Plus size={20} /></span>
              <span className="font-medium">Novo bot</span>
              <span className="max-w-[240px] text-center text-xs text-t3">Descreva em uma frase e o Gubots preenche o resto.</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <span className="flex gap-3 text-[13.5px] leading-snug"><span className="w-[92px] shrink-0 text-t3">{k}</span><span className={cn('min-w-0 flex-1 break-words', v ? 'text-t1' : 'text-t3')}>{v || '—'}</span></span>
)

type Form = Omit<Bot, 'id' | 'status' | 'logins'>
const EMPTY: Form = { name: '', avatar: 'orion', job: '', engine: 'claude', model: '', effort: 'medium', tools: ['files', 'web'], composio: [], mcp: [], isChief: false, profile: '' }

const Label = ({ children }: { children: React.ReactNode }) => <span className="text-[13px] text-t1">{children}</span>

// janela de criar/editar bot: aberta de qualquer tela (App renderiza quando botDialog está definido)
export function BotDialog({ id }: { id: string | null }) {
  const bot = useStore((s) => s.bots.find((b) => b.id === id))
  const models = useStore((s) => s.models)
  const [f, setF] = useState<Form>(() => {
    if (!bot) return EMPTY
    const { id: _i, status: _s, logins: _l, ...rest } = bot
    return rest
  })
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState('')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<{ slug: string; name: string; logo?: string }[] | null>(null)
  const [hitErr, setHitErr] = useState('')
  const [login, setLogin] = useState('')
  const up = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }))
  const close = () => set({ botDialog: null })

  useEffect(() => { loadModels() }, [])

  // modelo e raciocínio precisam existir para o motor escolhido
  const list = models?.[f.engine] ?? []
  const info = list.find((m) => m.id === f.model)
  const noEffort = !!info && Array.isArray(info.efforts) && info.efforts.length === 0 // modelo sem raciocínio configurável
  const allowed = (info?.efforts ?? []).filter((e): e is Effort => EFFORTS.some((x) => x[0] === e))
  useEffect(() => {
    if (!models || !list.length || info || f.model) return // só escolhe sozinho quando não há modelo (bot novo ou motor trocado)
    up({ model: (list.find((m) => m.isDefault) ?? list[0]).id })
  }, [models, f.engine, f.model])
  useEffect(() => {
    if (allowed.length && !allowed.includes(f.effort)) up({ effort: allowed.includes('medium') ? 'medium' : allowed[0] })
  }, [f.model])

  const [cmpMode, setCmpMode] = useState('')
  useEffect(() => { api<any>('/api/composio/apps').then((r) => setCmpMode(r?.mode ?? 'none'), () => setCmpMode('none')) }, [])
  // busca de apps Composio (com atraso para não bombardear)
  useEffect(() => {
    if (hits === null && !q) return
    const t = setTimeout(async () => {
      const r = await api<any>('/api/composio/toolkits?q=' + encodeURIComponent(q)).catch((e: Error) => ({ error: e.message }))
      if (Array.isArray(r)) { setHits(r); setHitErr('') } else { setHits([]); setHitErr(r?.error || 'Composio indisponível') }
    }, 300)
    return () => clearTimeout(t)
  }, [q, hits === null])

  async function draft() {
    setBusy('draft')
    const d = await act(api<any>('/api/bots/draft', 'POST', { description: desc }))
    setBusy('')
    if (!d) return
    const p: Partial<Form> = {}
    if (typeof d.name === 'string') p.name = d.name
    if (AVATARS.includes(splitAvatar(String(d.avatar ?? '')).id as (typeof AVATARS)[number])) p.avatar = d.avatar
    if (typeof d.job === 'string') p.job = d.job
    if (d.engine === 'claude' || d.engine === 'codex') p.engine = d.engine
    if (typeof d.model === 'string') p.model = d.model
    if (['low', 'medium', 'high'].includes(d.effort)) p.effort = d.effort
    if (Array.isArray(d.tools)) p.tools = d.tools.filter((t: string) => TOOLS.some((x) => x[0] === t))
    if (Array.isArray(d.composio)) p.composio = d.composio.filter((x: unknown) => typeof x === 'string')
    if (Array.isArray(d.mcp)) p.mcp = d.mcp.filter((m: any) => m?.name && m?.url)
    if (typeof d.isChief === 'boolean') p.isChief = d.isChief
    if (typeof d.profile === 'string') p.profile = d.profile
    up(p)
  }

  async function save() {
    setBusy('save')
    const body = { ...f, name: f.name.trim(), mcp: f.mcp.filter((m) => m.name.trim() && m.url.trim()) }
    const b = await act(bot ? api<Bot>('/api/bots/' + bot.id, 'PUT', body) : api<Bot>('/api/bots', 'POST', { ...body, logins: [] }))
    setBusy('')
    if (b) { putBot(b); close() }
  }

  async function remove() {
    if (!bot || !(await confirmAsk({ title: `Apagar o bot ${bot.name}?`, body: 'Ele sai da equipe e das conversas. O histórico continua guardado no servidor.', ok: 'Apagar bot', danger: true }))) return
    if (await act(api('/api/bots/' + bot.id, 'DELETE')) !== undefined) { dropBot(bot.id); close() }
  }

  async function addLogin() {
    if (!bot) return
    let domain = login.trim()
    try { domain = new URL(/^[a-z]+:\/\//i.test(domain) ? domain : 'https://' + domain).hostname } catch { return }
    if (!domain.includes('.')) return
    if (await act(api('/api/bots/' + bot.id + '/login', 'POST', { domain })) === undefined) return
    close()
    openBot(bot.id, true) // abre o painel ao vivo para o usuário fazer o login
  }

  const err = models?.errors?.[f.engine]
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl" onOpenAutoFocus={(e) => { if (!matchMedia("(min-width:768px)").matches) e.preventDefault() }}>
        <DialogHeader>
          <DialogTitle className="text-lg">{bot ? `Editar ${bot.name}` : 'Novo bot'}</DialogTitle>
          <DialogDescription className="sr-only">Configuração do bot</DialogDescription>
          <p className="m-0 text-t2">{bot ? 'Mude o que quiser e toque em Salvar.' : 'Descreva o trabalho como para uma pessoa da equipe.'}</p>
        </DialogHeader>

        {/* gerar a partir de descrição só em bot novo: ao editar, nada é trocado sem você mexer */}
        {!bot && <div className="flex flex-col gap-3 rounded-[22px] border border-brand/20 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(59,130,246,0.12),transparent_60%)] p-3.5">
          <textarea className={cn(field, 'resize-y !bg-black/40')} rows={2} placeholder="Opcional: descreva o bot em uma frase e deixe o servidor preencher o formulário" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <button type="button" className={cn(btn2, 'self-start')} disabled={!desc.trim() || busy === 'draft'} onClick={draft}>
            <Sparkles size={15} />{busy === 'draft' ? <span className="shimmer-text">Preenchendo…</span> : 'Criar a partir de descrição'}
          </button>
        </div>}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <fieldset className="flex flex-col gap-2.5">
              <legend className="mb-2.5"><Label>Avatar</Label></legend>
              <div className="flex flex-wrap gap-2.5">
                {AVATARS.map((a) => {
                  const av = splitAvatar(f.avatar), on = av.id === a
                  return (
                    <button key={a} type="button" aria-label={a} aria-pressed={on} onClick={() => up({ avatar: withColor(a, av.color) })}
                      className={cn('glass-btn flex size-14 items-center justify-center rounded-full transition-[outline-color,transform] duration-200', on ? 'outline outline-2 outline-offset-2 outline-brand' : 'outline-transparent')}>
                      <Avatar bot={on ? f.avatar : a} size={40} working={on} />
                    </button>
                  )
                })}
              </div>
              {/* cor do avatar: original do desenho, paleta ou qualquer cor */}
              <div role="radiogroup" aria-label="Cor do avatar" className="flex flex-wrap items-center gap-2 pt-1">
                {[undefined, ...AVATAR_COLORS].map((c) => {
                  const cur = splitAvatar(f.avatar).color, on = (cur ?? '') === (c?.toLowerCase() ?? '')
                  return (
                    <button key={c ?? 'orig'} type="button" role="radio" aria-checked={on} aria-label={c ? `Cor ${c}` : 'Cor original'} title={c ?? 'Cor original'}
                      onClick={() => up({ avatar: withColor(f.avatar, c) })}
                      className={cn('size-7 rounded-full border border-white/15 transition-transform hover:scale-110', on && 'outline outline-2 outline-offset-2 outline-brand',
                        !c && 'bg-[conic-gradient(#F2B33D,#3B82F6,#22C55E,#FF6A1A,#F2B33D)]')}
                      style={c ? { background: c } : undefined} />
                  )
                })}
                <label title="Outra cor" className="relative inline-flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-white/30 text-[15px] leading-none text-t2 hover:text-foreground">
                  +<input type="color" aria-label="Outra cor" className="absolute inset-0 cursor-pointer opacity-0" value={splitAvatar(f.avatar).color ?? '#3b82f6'} onChange={(e) => up({ avatar: withColor(f.avatar, e.target.value) })} />
                </label>
              </div>
            </fieldset>
            <label className="flex flex-col gap-2"><Label>Nome</Label><input className={field} value={f.name} onChange={(e) => up({ name: e.target.value })} /></label>
            <label className="flex flex-col gap-2"><Label>Trabalho</Label>
              <textarea className={cn(field, 'resize-y leading-relaxed')} rows={4} value={f.job} onChange={(e) => up({ job: e.target.value })} placeholder="Ex.: toda manhã, ler os e-mails de clientes e me mandar um resumo de 5 linhas." />
            </label>
            <fieldset className="flex flex-col gap-2.5">
              <legend className="mb-2.5"><Label>Ferramentas</Label></legend>
              {TOOLS.map(([t, l]) => (
                <label key={t} className="flex cursor-pointer items-center gap-2.5 text-t1">
                  <Checkbox checked={t === 'web' || f.tools.includes(t)} disabled={t === 'web'} onCheckedChange={(c) => up({ tools: c ? [...f.tools, t] : f.tools.filter((x) => x !== t) })} />{l}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center justify-between gap-3 rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-4 py-3">
              <span className="flex flex-col"><span className="font-medium">Chefe</span><span className="text-xs text-t3">Recebe o roster da equipe, divide pedidos e delega aos outros bots.</span></span>
              <Switch checked={f.isChief} onCheckedChange={(c) => up({ isChief: c })} />
            </label>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <fieldset className="flex flex-col"><legend className="mb-2.5"><Label>Motor</Label></legend>
              <Seg strong value={f.engine} onChange={(e: Engine) => up({ engine: e, model: '' })} opts={[['claude', 'Claude Code'], ['codex', 'Codex']]} />
            </fieldset>
            <div className="flex flex-col gap-2"><Label>Modelo</Label>
              <Select value={info ? f.model : ''} onValueChange={(v) => up({ model: v })} disabled={!list.length}>
                <SelectTrigger className="h-11 w-full rounded-2xl px-4 text-sm"><SelectValue placeholder={models ? 'Sem modelos' : 'Carregando…'} /></SelectTrigger>
                <SelectContent>{list.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
              <span className={cn('text-xs', err ? 'text-warn' : 'text-t3')}>
                {!models ? 'carregando modelos da conta…' : err ? `Não consegui ler os modelos: ${err}` : 'Lista lida da sua conta.'}
              </span>
            </div>
            <fieldset className="flex flex-col"><legend className="mb-2.5"><Label>Raciocínio</Label></legend>
              <Seg disabled={noEffort} value={f.effort} onChange={(e: Effort) => up({ effort: e })} opts={EFFORTS.filter(([e]) => !allowed.length || allowed.includes(e))} />
              {noEffort && <span className="mt-1.5 text-xs text-t3">Este modelo não tem nível de raciocínio.</span>}
            </fieldset>

            <ComposioApps value={f.composio} onChange={(composio) => up({ composio })} />
            {cmpMode === 'project' && <div className="flex flex-col gap-2"><Label>Apps (Composio)</Label>
              <div className="flex flex-wrap gap-2">
                {f.composio.map((c) => (
                  <span key={c} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface2 pl-3 pr-2 text-[13px]">{c}
                    <button type="button" aria-label={`Remover ${c}`} onClick={() => up({ composio: f.composio.filter((x) => x !== c) })}><X size={13} /></button>
                  </span>
                ))}
              </div>
              <input className={cn(field, '!rounded-full !py-2 text-[13px]')} placeholder="Buscar app (Gmail, Slack, HubSpot…)" value={q}
                onFocus={() => hits === null && setHits([])} onChange={(e) => setQ(e.target.value)} />
              {hitErr && <span className="text-xs text-warn">{hitErr}</span>}
              {!!hits?.length && (
                <div className="flex max-h-44 flex-col overflow-y-auto rounded-[18px] border border-white/[0.08] bg-surface p-1">
                  {hits.filter((h) => !f.composio.includes(h.slug)).map((h) => (
                    <button key={h.slug} type="button" className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-white/5"
                      onClick={() => up({ composio: [...f.composio, h.slug] })}>
                      {h.logo ? <img src={h.logo} alt="" className="size-5 rounded" /> : <span className="size-5" />}{h.name}<Plus size={13} className="ml-auto text-t3" />
                    </button>
                  ))}
                </div>
              )}
            </div>}

            <div className="flex flex-col gap-2"><Label>MCP extra</Label>
              {f.mcp.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={cn(field, '!w-28 !py-2 text-[13px]')} placeholder="nome" value={m.name} onChange={(e) => up({ mcp: f.mcp.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <input className={cn(field, 'min-w-0 !py-2 text-[13px]')} placeholder="https://…/mcp" value={m.url} onChange={(e) => up({ mcp: f.mcp.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                  <button type="button" aria-label="Remover MCP" className="text-t2 hover:text-foreground" onClick={() => up({ mcp: f.mcp.filter((_, j) => j !== i) })}><X size={16} /></button>
                </div>
              ))}
              <button type="button" className="self-start rounded-full border border-dashed border-white/20 px-3.5 py-1.5 text-[13px] text-t1 transition-colors hover:border-brand/50 hover:text-foreground" onClick={() => up({ mcp: [...f.mcp, { name: '', url: '' }] })}>+ Adicionar MCP</button>
            </div>

            <label className="flex flex-col gap-2"><Label>Perfil</Label>
              <textarea className={cn(field, 'resize-y leading-relaxed')} rows={3} placeholder="Tom, regras e preferências deste bot." value={f.profile} onChange={(e) => up({ profile: e.target.value })} />
            </label>
          </div>
        </div>

        {bot && (
          <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-4"><Label>Logins no navegador</Label>
            <div className="flex flex-wrap gap-2">
              {bot.logins.map((d) => (
                <span key={d} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface2 pl-3 pr-2 text-[13px]">{d}
                  <button type="button" aria-label={`Remover login ${d}`} onClick={() => act(api(`/api/bots/${bot.id}/login/${encodeURIComponent(d)}`, 'DELETE')).then((r) => r !== undefined && putBot({ ...bot, logins: bot.logins.filter((x) => x !== d) }))}><X size={13} /></button>
                </span>
              ))}
              {!bot.logins.length && <span className="text-xs text-t3">Nenhum site com login.</span>}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addLogin() }}>
              <input className={cn(field, '!rounded-full !py-2 text-[13px]')} placeholder="dominio.com" value={login} onChange={(e) => setLogin(e.target.value)} />
              <button type="submit" className={btn2} disabled={!login.trim()}>Adicionar login</button>
            </form>
            <span className="text-xs text-t3">Abre o navegador do bot nesse site para você entrar pelo painel ao vivo.</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5 border-t border-white/[0.06] pt-4">
          <button type="button" className={cn(btn, 'h-11 flex-1 sm:h-10 sm:flex-none')} disabled={!f.name.trim() || !f.model || busy === 'save'} onClick={save}>{bot ? 'Salvar' : 'Criar bot'}</button>
          <button type="button" className={cn(btn2, 'h-11 sm:h-9')} onClick={close}>Cancelar</button>
          {bot && <button type="button" className={cn(btnDanger, 'h-11 w-full sm:ml-auto sm:h-9 sm:w-auto')} onClick={remove}>Apagar bot</button>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Composio Connect: os apps conectados na sua conta viram caixas de seleção; o bot só usa os marcados
function ComposioApps({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [d, setD] = useState<{ mode: string; apps: { slug: string; name: string }[]; dashboard: string } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api<any>('/api/composio/apps').then(setD, (e: Error) => setErr(e.message)) }, [])
  if (d?.mode === 'project') return null // chave de projeto (ak_): usa a busca de toolkits abaixo
  const all = d?.apps ?? []
  const toggle = (slug: string, on: boolean) => onChange(on ? [...new Set([...value, slug])] : value.filter((x) => x !== slug))
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 flex w-full items-center justify-between">
        <Label>Apps (Composio)</Label>
        {all.length > 1 && <button type="button" className="text-xs text-t3 hover:text-foreground" onClick={() => onChange(value.length === all.length ? [] : all.map((a) => a.slug))}>{value.length === all.length ? 'Desmarcar todos' : 'Marcar todos'}</button>}
      </legend>
      {!d && !err && <span className="text-xs text-t3 shimmer-text">lendo apps conectados…</span>}
      {err && <span className="text-xs text-warn">Composio indisponível: {err}</span>}
      {d?.mode === 'none' && <span className="text-xs leading-relaxed text-t3">Cole a chave do Composio em Configurações → Integrações para liberar Gmail, Calendar, GitHub e outros apps para os bots.</span>}
      {d?.mode === 'connect' && (
        <div className="grid grid-cols-2 gap-1.5">
          {all.map((a) => (
            <label key={a.slug} className={cn('flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px] transition-colors', value.includes(a.slug) ? 'border-white/20 bg-white/[0.06] text-foreground' : 'border-white/[0.07] text-t2 hover:bg-white/[0.03]')}>
              <Checkbox checked={value.includes(a.slug)} onCheckedChange={(c) => toggle(a.slug, !!c)} />{a.name}
            </label>
          ))}
          {!all.length && <span className="col-span-2 text-xs text-t3">Nenhum app conectado na sua conta Composio ainda.</span>}
        </div>
      )}
      {d?.mode === 'connect' && (
        <span className="text-xs text-t3">Só os marcados ficam disponíveis para este bot. <a className="underline underline-offset-2 hover:text-foreground" href={d.dashboard + '/'} target="_blank" rel="noreferrer">Conectar mais apps</a></span>
      )}
    </fieldset>
  )
}
