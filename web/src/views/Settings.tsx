import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import qrcode from 'qrcode-generator'
import {
  ArrowUpRight, Bell, Brain, Check, Cpu, Eye, EyeOff, FolderOpen, Globe, KeyRound, LogOut, Mic, Plug, Power, RefreshCw, Server, SlidersHorizontal, Smartphone, Upload,
} from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { CopyBtn } from '@/components/Markdown'
import { Dot, PageHeader, Seg, Skel, engineName } from '@/components/bits'
import { Switch } from '@/components/ui/switch'
import { act, api, confirmAsk, loadModels, loadSettings, logout, saveSettings, toast, useStore } from '@/store'
import { btn, btn2, btnDanger, cn, field } from '@/lib/utils'
import type { Settings as S, SystemInfo } from '@/types'
import { enablePush, pushStatus, testPush, type PushState } from '@/lib/push'
import { liveSttOn, setLiveStt, speechCtor } from '@/lib/audio'

const SECTIONS = [
  ['geral', 'Geral', SlidersHorizontal], ['motores', 'Motores', Cpu], ['navegador', 'Navegador', Globe], ['integracoes', 'Integrações', Plug], ['senhas', 'Senhas', KeyRound],
  ['memoria', 'Memória', Brain], ['acesso', 'Celular e acesso', Smartphone], ['sistema', 'Sistema', Server],
] as const
type Sec = (typeof SECTIONS)[number][0]
const SK = 'gubots-settings-sec'
const isLocalHost = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname)

export function Settings() {
  const [sec, setSecS] = useState<Sec>(() => { try { return (localStorage.getItem(SK) as Sec) || 'geral' } catch { return 'geral' } })
  const setSec = (s: Sec) => { setSecS(s); try { localStorage.setItem(SK, s) } catch { /* ignore */ } }
  const [sys, setSys] = useState<SystemInfo | null | false>(null) // false = servidor ainda sem /api/system
  const loadSys = () => api<SystemInfo>('/api/system').then(setSys).catch(() => setSys(false))
  useEffect(() => { loadSys(); loadSettings() }, [])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6 px-4 pb-[calc(2rem+var(--sab))] pt-3 md:px-10 md:py-8">
        <PageHeader title="Configurações" sub="Preferências, motores, navegador e acesso pelo celular." />
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
          <nav aria-label="Seções" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:sticky md:top-0 md:mx-0 md:w-52 md:shrink-0 md:flex-col md:gap-1 md:overflow-visible md:px-0">
            {SECTIONS.map(([id, label, Icon]) => (
              <button key={id} type="button" aria-current={sec === id ? 'page' : undefined} onClick={(e) => { setSec(id); e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }) }}
                className={cn('flex h-10 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full border border-transparent px-4 text-[13.5px] text-t2 transition-colors duration-200 hover:bg-white/[0.05] hover:text-foreground max-md:border-white/[0.07] max-md:bg-white/[0.025]',
                  sec === id && 'glass-btn text-foreground hover:bg-transparent [&_svg]:text-[#93c5fd]')}>
                <Icon size={16} strokeWidth={1.7} />{label}
              </button>
            ))}
          </nav>
          <div key={sec} className="fade flex min-w-0 flex-1 flex-col gap-7 pb-10">
            {sec === 'geral' && <General />}
            {sec === 'motores' && <Engines sys={sys} reload={loadSys} />}
            {sec === 'navegador' && <BrowserSec />}
            {sec === 'integracoes' && <Integrations />}
            {sec === 'senhas' && <Vault />}
            {sec === 'memoria' && <MemorySec sys={sys} />}
            {sec === 'acesso' && <Access sys={sys} />}
            {sec === 'sistema' && <System sys={sys} />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- primitivas ----------
function Group({ title, desc, children, bare }: { title: string; desc?: ReactNode; children: ReactNode; bare?: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
        {desc && <p className="m-0 text-[13.5px] leading-relaxed text-t2">{desc}</p>}
      </div>
      {bare ? children : <div className="panel-card divide-y divide-white/[0.06] overflow-hidden">{children}</div>}
    </section>
  )
}

function Row({ title, desc, children, stack }: { title: ReactNode; desc?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={cn('flex gap-3 px-4 py-4 md:px-5', stack ? 'flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6' : 'items-center justify-between gap-4 sm:gap-6')}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[14.5px] font-medium">{title}</span>
        {desc && <span className="text-[13px] leading-snug text-t3">{desc}</span>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

type Flag = 'sendOnEnter' | 'animations' | 'notify' | 'adblock' | 'headed' | 'graphNightly' | 'sttRefine'
function Toggle({ k, title, desc, before }: { k: Flag; title: string; desc?: string; before?: (v: boolean) => Promise<boolean | void> }) {
  const v = useStore((s) => s.settings[k])
  return (
    <Row title={title} desc={desc}>
      <Switch aria-label={title} checked={v} onCheckedChange={async (c) => { if ((await before?.(c)) === false) return; saveSettings({ [k]: c } as Partial<S>) }} />
    </Row>
  )
}

const Missing = ({ what = 'estas opções' }: { what?: string }) => (
  <div className="flex items-center gap-2.5 rounded-[20px] border border-warn/20 bg-warn/[0.06] px-4 py-3 text-[13px] text-warn">
    <Dot color="#E6B34A" />O servidor ainda não oferece {what}. Atualize o Gubots e recarregue.
  </div>
)

async function run(p: Promise<unknown>, ok: string) { if ((await act(p)) !== undefined) toast(ok) }

// ---------- cofre de senhas: o valor nunca volta do servidor; os bots só preenchem ----------
type Sec2 = { id: string; name: string; site: string; username?: string; botIds: string[]; ts: number }
function Vault() {
  const bots = useStore((s) => s.bots)
  const [list, setList] = useState<Sec2[] | null>(null)
  const [f, setF] = useState({ name: '', site: '', username: '', password: '', bot: '' })
  const [show, setShow] = useState(false)
  const load = () => api<Sec2[]>('/api/vault').then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])
  const ok = f.name.trim() && f.site.trim() && f.password
  const save = async () => { if ((await act(api('/api/vault', 'POST', { ...f, botIds: f.bot ? [f.bot] : [] }))) !== undefined) { toast('Senha salva no cofre'); setF({ name: '', site: '', username: '', password: '', bot: '' }); load() } }
  const del = async (s: Sec2) => { if (await confirmAsk({ title: `Apagar “${s.name}” do cofre?`, body: 'Os bots não vão mais conseguir entrar sozinhos nesse site.', ok: 'Apagar', danger: true })) { await act(api('/api/vault/' + s.id, 'DELETE')); load() } }
  return (
    <>
      <Group title="Senhas" desc="Cofre criptografado neste PC. Os bots usam para entrar nos sites (preenchem sem ver) e pedem aqui pelo chat quando falta uma. Senha nunca vai para a memória.">
        {list === null && <div className="p-4"><Skel className="h-10" /></div>}
        {list?.length === 0 && <Row title="Nenhuma senha salva" desc="Quando um bot precisar de login, ele pede num cartão seguro no chat." />}
        {list?.map((s) => (
          <Row key={s.id} title={<span className="flex items-center gap-2"><KeyRound size={14} className="text-t3" />{s.name}</span>}
            desc={`${s.site}${s.username ? ` · ${s.username}` : ''} · ${s.botIds.length ? s.botIds.map((b) => bots.find((x) => x.id === b)?.name ?? b).join(', ') : 'todos os bots'}`}>
            <button type="button" className={btn2} onClick={() => setF({ name: s.name, site: s.site, username: s.username ?? '', password: '', bot: s.botIds[0] ?? '' })}>Trocar</button>
            <button type="button" className={btnDanger} onClick={() => del(s)}>Apagar</button>
          </Row>
        ))}
      </Group>
      <Group title={list?.some((s) => s.name.toLowerCase() === f.name.trim().toLowerCase()) ? `Trocar senha de ${f.name}` : 'Nova senha'} bare>
        <form className="panel-card grid gap-3 p-4 sm:grid-cols-2 md:p-5" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (ok) save() }}>
          <input className={field} placeholder="Nome, ex.: Workana" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className={field} placeholder="Site, ex.: workana.com" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} />
          <input className={field} placeholder="Usuário ou e-mail" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" />
          <label className="relative flex items-center">
            <input className={cn(field, 'pr-11')} type={show ? 'text' : 'password'} placeholder="Senha" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
            <button type="button" aria-label={show ? 'Esconder' : 'Mostrar'} className="absolute right-3 text-t3 hover:text-foreground" onClick={() => setShow(!show)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </label>
          <select className={field} value={f.bot} onChange={(e) => setF({ ...f, bot: e.target.value })}>
            <option value="">Todos os bots</option>
            {bots.map((b) => <option key={b.id} value={b.id}>Só {b.name}</option>)}
          </select>
          <button type="submit" className={cn(btn, 'h-11')} disabled={!ok}>Salvar no cofre</button>
        </form>
      </Group>
    </>
  )
}

// ---------- seções ----------
function General() {
  const s = useStore((st) => st.settings)
  const live = useStore((st) => st.settingsLive)
  const [name, setName] = useState(s.userName)
  const [saved, setSaved] = useState(false)
  useEffect(() => setName(s.userName), [s.userName])
  const saveName = async () => {
    const n = name.trim()
    if (!n || n === s.userName) return
    if (await saveSettings({ userName: n })) { setSaved(true); setTimeout(() => setSaved(false), 1500) }
  }
  return (
    <>
      {!live && <Missing what="salvar configurações" />}
      <Group title="Você">
        <Row stack title="Seu nome" desc="Usado na saudação e pelos bots.">
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); saveName() }}>
            <input aria-label="Seu nome" className={cn(field, 'h-9 w-full !py-1.5 sm:w-56')} value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
            <span className={cn('inline-flex size-5 items-center justify-center text-ok transition-opacity', saved ? 'opacity-100' : 'opacity-0')} aria-hidden={!saved}><Check size={16} /></span>
          </form>
        </Row>
      </Group>
      <Group title="Chat">
        <Toggle k="sendOnEnter" title="Enviar com Enter" desc="Desligado: Ctrl+Enter envia e Enter quebra a linha." />
        <Toggle k="animations" title="Animações" desc="Movimentos suaves na interface. O sistema pode pedir menos movimento." />
      </Group>
      <Notifications />
      <Group title="Atalhos">
        {([['Ctrl K', 'Buscar e comandos'], ['Ctrl B', 'Mostrar ou recolher a barra lateral'], ['Ctrl Shift O', 'Nova conversa'], ['Ctrl ,', 'Configurações'], ['Esc', 'Parar o bot que está respondendo']] as const).map(([k, l]) => (
          <Row key={k} title={<span className="font-normal text-t1">{l}</span>}><kbd>{k}</kbd></Row>
        ))}
      </Group>
    </>
  )
}

// notificações push: liga/desliga (vale para todos os aparelhos) e inscreve/testa este aparelho
const PUSH_DESC: Record<PushState, string> = {
  on: 'Este aparelho recebe as notificações, mesmo com o app fechado.',
  off: 'Este aparelho ainda não recebe. Toque em Ativar aqui.',
  denied: 'Bloqueadas neste aparelho. No Android: Configurações › Apps › Gubots (ou Chrome) › Notificações › Permitir.',
  unsupported: 'Este navegador não recebe notificações push. No iPhone, adicione o Gubots à tela inicial e abra por lá.',
  insecure: 'Notificações precisam do endereço com HTTPS (o do celular).',
}
function Notifications() {
  const on = useStore((s) => s.settings.notify)
  const [st, setSt] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { pushStatus().then(setSt) }, [on])
  const activate = async () => {
    setBusy(true)
    try {
      const r = await enablePush()
      setSt(r)
      if (r === 'on') toast('Notificações ativas neste aparelho')
      else if (r === 'denied') toast('Notificações bloqueadas: libere nas configurações do aparelho')
      return r
    } catch (e) { toast('Não consegui ativar: ' + (e as Error).message) } finally { setBusy(false) }
  }
  const toggle = async (c: boolean) => { if (c) await activate(); saveSettings({ notify: c }) }
  const test = async () => { setBusy(true); try { await testPush(); toast('Enviei uma notificação de teste') } catch (e) { toast((e as Error).message) } finally { setBusy(false) } }
  return (
    <Group title="Notificações" desc="Como mensagem de WhatsApp: quando um pedido seu termina, chega a notificação com a foto do bot e o começo da resposta. Tocar abre a conversa.">
      <Row title="Avisar quando um bot terminar" desc="Com o app aberto, toca um aviso curto; fechado, chega a notificação.">
        <Switch aria-label="Avisar quando um bot terminar" checked={on} onCheckedChange={toggle} />
      </Row>
      {on && st && (
        <Row stack title={<span className="flex items-center gap-2"><Dot color={st === 'on' ? '#4ADE80' : st === 'off' ? '#fbbf24' : '#f43f5e'} />Este aparelho</span>} desc={PUSH_DESC[st]}>
          {st === 'on' && <button type="button" className={btn2} disabled={busy} onClick={test}><Bell size={14} />Testar</button>}
          {st === 'off' && <button type="button" className={cn(btn, 'h-9')} disabled={busy} onClick={activate}><Bell size={14} />Ativar aqui</button>}
        </Row>
      )}
    </Group>
  )
}

function Engines({ sys, reload }: { sys: SystemInfo | null | false; reload: () => void }) {
  const models = useStore((s) => s.models)
  const [busy, setBusy] = useState(false)
  useEffect(() => { loadModels() }, [])
  const refresh = async () => { setBusy(true); await loadModels(true); reload(); setBusy(false); toast('Lista de modelos atualizada') }
  return (
    <Group title="Motores" desc="Os bots rodam pela sua assinatura do Claude Code e do Codex neste PC.">
      {(['claude', 'codex'] as const).map((e) => {
        const st = sys ? sys.engines[e] : undefined
        const list = models?.[e] ?? []
        const err = st?.error ?? models?.errors?.[e]
        const ok = st ? st.ok : !!list.length && !err
        const loading = sys === null && !models
        return (
          <div key={e} className="flex flex-col gap-3 px-4 py-4">
            <div className="flex items-center gap-3">
              <span className="glass-btn inline-flex size-10 shrink-0 items-center justify-center rounded-full"><Cpu size={18} strokeWidth={1.6} /></span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{engineName(e)}</span>
                <span className="text-[13px] text-t3">{loading ? 'verificando…' : [st?.version && `v${st.version}`, `${st?.models ?? list.length} modelos`].filter(Boolean).join(' · ')}</span>
              </div>
              {loading ? <Skel className="h-6 w-20 rounded-full" /> : (
                <span className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium', ok ? 'bg-ok/10 text-ok' : 'bg-live/10 text-bad')}>
                  <Dot color={ok ? '#4ADE80' : '#F05252'} />{ok ? 'Logado' : 'Com erro'}
                </span>
              )}
            </div>
            {err && <p className="m-0 break-words rounded-xl bg-live/[0.06] px-3 py-2 font-mono text-xs text-bad">{err}</p>}
            {!!list.length && (
              <div className="flex flex-wrap gap-1.5">
                {list.map((m) => <span key={m.id} className="rounded-full border border-white/[0.07] px-2.5 py-1 text-xs text-t2">{m.name}</span>)}
              </div>
            )}
          </div>
        )
      })}
      <Row title="Atualizar modelos" desc="Lê de novo a lista de modelos das duas contas.">
        <button type="button" className={btn2} disabled={busy} onClick={refresh}><RefreshCw size={14} className={cn(busy && 'animate-spin')} />{busy ? 'Atualizando…' : 'Atualizar'}</button>
      </Row>
    </Group>
  )
}

function BrowserSec() {
  const bots = useStore((s) => s.bots)
  const live = useStore((s) => s.settingsLive)
  async function wipe(id: string, name: string) {
    const ok = await confirmAsk({
      title: `Apagar os logins salvos do ${name}?`, danger: true, ok: 'Apagar logins', typed: name,
      body: 'Cookies, sessões e dados do navegador deste bot serão apagados. Ele vai precisar entrar de novo em todos os sites. Não dá para desfazer.',
    })
    if (ok) run(api(`/api/bots/${id}/profile`, 'DELETE'), `Logins do ${name} apagados`)
  }
  return (
    <>
      {!live && <Missing />}
      <Group title="Navegador dos bots" desc="Cada bot tem um Chrome próprio, com os próprios logins.">
        <Toggle k="adblock" title="Bloquear anúncios" desc="Páginas mais leves e menos distrações para o bot." />
        <Toggle k="headed" title="Mostrar o Chrome na tela do PC" desc="Útil para depurar. Os navegadores ociosos reabrem já com a mudança." />
        <Row title="Reiniciar navegadores" desc="Fecha os navegadores parados; eles reabrem quando o bot precisar.">
          <button type="button" className={btn2} onClick={() => run(api('/api/browser/restart', 'POST'), 'Navegadores reiniciados')}><RefreshCw size={14} />Reiniciar</button>
        </Row>
      </Group>
      <Group title="Logins salvos" desc="Apagar remove cookies e sessões do navegador daquele bot.">
        {bots.filter((b) => b.tools.includes('browser')).map((b) => (
          <Row key={b.id} stack title={<span className="flex items-center gap-2.5"><Avatar bot={b.avatar} size={24} />{b.name}</span>}
            desc={b.logins.length ? b.logins.join(', ') : 'Nenhum site com login marcado'}>
            <button type="button" className={btnDanger} onClick={() => wipe(b.id, b.name)}>Apagar logins salvos</button>
          </Row>
        ))}
        {!bots.some((b) => b.tools.includes('browser')) && <Row title={<span className="font-normal text-t3">Nenhum bot com navegador.</span>} />}
      </Group>
    </>
  )
}

function KeyField({ k, name, desc, link, icon }: { k: 'composio' | 'elevenlabs' | 'openai' | 'groq'; name: string; desc: string; link: string; icon: ReactNode }) {
  const st = useStore((s) => s.settings[k])
  const [v, setV] = useState('')
  const [show, setShow] = useState(false)
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  async function save(val: string) {
    setBusy(true)
    if (await saveSettings({ [k + 'Key']: val } as Partial<S>)) { setV(''); setEdit(false); toast(val ? `Chave do ${name} salva` : `Chave do ${name} removida`) }
    setBusy(false)
  }
  return (
    <div className="flex flex-col gap-3.5 px-4 py-4">
      <div className="flex items-center gap-3">
        <span className="glass-btn inline-flex size-10 shrink-0 items-center justify-center rounded-full text-t1">{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col"><span className="font-medium">{name}</span><span className="text-[13px] leading-snug text-t3">{desc}</span></div>
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium', st.set ? 'bg-ok/10 text-ok' : 'bg-white/[0.05] text-t3')}>
          <Dot color={st.set ? '#4ADE80' : '#6b6b74'} />{st.set ? 'Conectado' : 'Sem chave'}
        </span>
      </div>
      {st.set && !edit ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 basis-40 truncate rounded-full border border-white/[0.07] bg-white/[0.03] px-4 py-2 font-mono text-[13px] tracking-wider text-t2">••••••••••••{st.last4}</code>
          <button type="button" className={btn2} onClick={() => setEdit(true)}>Trocar</button>
          <button type="button" className={btnDanger} disabled={busy}
            onClick={async () => { if (await confirmAsk({ title: `Remover a chave do ${name}?`, body: 'Os recursos que dependem dela param de funcionar.', ok: 'Remover', danger: true })) save('') }}>Remover</button>
        </div>
      ) : (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) save(v.trim()) }}>
          <div className="relative min-w-[200px] flex-1">
            <input type={show ? 'text' : 'password'} aria-label={`Chave do ${name}`} autoComplete="off" spellCheck={false} placeholder="Cole a chave aqui"
              className={cn(field, 'h-9 !py-1.5 pr-10 font-mono text-[13px]')} value={v} onChange={(e) => setV(e.target.value)} />
            <button type="button" aria-label={show ? 'Ocultar chave' : 'Mostrar chave'} onClick={() => setShow(!show)}
              className="absolute right-1 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-t3 hover:text-foreground">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          </div>
          <button type="submit" className={cn(btn, 'h-9')} disabled={!v.trim() || busy}>Salvar</button>
          {edit && <button type="button" className={btn2} onClick={() => { setEdit(false); setV('') }}>Cancelar</button>}
        </form>
      )}
      <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-start text-[13px] text-t2 underline decoration-white/20 underline-offset-4 transition-colors hover:text-foreground hover:decoration-white/60">
        Pegar a chave<ArrowUpRight size={13} />
      </a>
    </div>
  )
}

function Integrations() {
  const live = useStore((s) => s.settingsLive)
  return (
    <>
      {!live && <Missing what="salvar chaves" />}
      <Group title="Integrações" desc="As chaves ficam só no servidor deste PC; aqui aparece apenas o final.">
        <KeyField k="composio" name="Composio" icon={<Plug size={18} strokeWidth={1.6} />} link="https://platform.composio.dev"
          desc="Conecta os bots a Gmail, Slack, HubSpot, Planilhas e centenas de apps." />
        <KeyField k="groq" name="Groq" icon={<Mic size={18} strokeWidth={1.6} />} link="https://console.groq.com/keys"
          desc="Ditado ao vivo com Whisper large-v3 (plano grátis com limite por minuto). Escolha Groq em Ditado por voz." />
        <KeyField k="openai" name="OpenAI" icon={<KeyRound size={18} strokeWidth={1.6} />} link="https://platform.openai.com/api-keys"
          desc="Opcional: ditado por voz pela API (gpt-4o-transcribe)." />
        <KeyField k="elevenlabs" name="ElevenLabs" icon={<Mic size={18} strokeWidth={1.6} />} link="https://elevenlabs.io/app/settings/api-keys"
          desc="Opcional: ditado por voz pela API (Scribe)." />
      </Group>
      <Voice />
    </>
  )
}

function Voice() {
  const st = useStore((s) => s.settings)
  const need = st.sttEngine === 'groq' ? !st.groq.set : st.sttEngine === 'openai' ? !st.openai.set : st.sttEngine === 'elevenlabs' ? !st.elevenlabs.set : false
  return (
    <Group title="Ditado por voz" desc="O microfone do chat grava e o Whisper transcreve quando você para. Português por padrão.">
      <LiveStt />
      <Toggle k="sttRefine" title="Corrigir a transcrição com IA" desc="O Claude Haiku arruma pontuação, erros de digitação e nomes (bots, sites, termos seus) antes de o texto entrar no campo. Não muda o sentido. ~2 s a mais." />
      <Row stack title="Motor de transcrição" desc={need ? 'Falta a chave acima para este motor funcionar.' : st.sttEngine === 'local'
        ? 'Roda neste PC, sem chave e sem mandar o áudio para fora. O modelo baixa na 1ª vez.' : 'O áudio vai para a API escolhida.'}>
        <Seg value={st.sttEngine} onChange={(v) => saveSettings({ sttEngine: v })}
          opts={[['local', 'Whisper local'], ['groq', 'Groq (ao vivo)'], ['openai', 'OpenAI'], ['elevenlabs', 'ElevenLabs']]} />
      </Row>
      {st.sttEngine === 'local' && (
        <Row stack title="Modelo local" desc="Base é rápido; Small acerta mais (padrão); Turbo é o mais preciso, porém mais lento e pesado (~1 GB).">
          <Seg value={st.sttModel} onChange={(v) => saveSettings({ sttModel: v })} opts={[['base', 'Base'], ['small', 'Small'], ['turbo', 'Turbo']]} />
        </Row>
      )}
    </Group>
  )
}

function MemorySec({ sys }: { sys: SystemInfo | null | false }) {
  const [path, setPath] = useState('')
  return (
    <>
      <Group title="Grafo de conhecimento" desc="O graphify organiza conversas e notas da inbox em conceitos e relações.">
        <Toggle k="graphNightly" title="Atualizar todo dia às 03:00" desc="Roda em lote enquanto você dorme." />
        <Row title="Atualizar agora" desc={sys ? (sys.graphify.ok ? `graphify ${sys.graphify.version ?? ''} instalado` : 'graphify não encontrado neste PC') : undefined}>
          <button type="button" className={btn2} onClick={() => run(api('/api/memory/graph/update', 'POST'), 'Atualização do grafo iniciada')}><RefreshCw size={14} />Atualizar grafo</button>
        </Row>
      </Group>
      <Group title="Dados">
        <Row stack title="Exportar para Obsidian" desc={path ? <span className="break-all">Exportado para {path}</span> : 'Gera um .md com todos os fatos da equipe.'}>
          <button type="button" className={btn2} onClick={async () => { const r = await act(api<{ path: string }>('/api/memory/obsidian', 'POST')); if (r) { setPath(r.path); toast('Exportado para o Obsidian') } }}><Upload size={14} />Exportar</button>
        </Row>
        <Row stack title="Abrir pasta de dados" desc={sys ? <span className="break-all font-mono text-xs">{sys.dataDir}</span> : 'Banco, perfis dos navegadores e arquivos dos bots.'}>
          <button type="button" className={btn2} onClick={() => run(api('/api/system/open-data', 'POST'), 'Pasta aberta no Explorer')}><FolderOpen size={14} />Abrir pasta</button>
        </Row>
      </Group>
    </>
  )
}

function QR({ text, size = 168 }: { text: string; size?: number }) {
  const { d, n } = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(text)
    q.make()
    const n = q.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    return { d, n }
  }, [text])
  return (
    <svg viewBox={`-3 -3 ${n + 6} ${n + 6}`} width={size} height={size} role="img" aria-label={`QR code de ${text}`} className="shrink-0 rounded-2xl" shapeRendering="crispEdges">
      <rect x={-3} y={-3} width={n + 6} height={n + 6} fill="#FCFCFC" /><path d={d} fill="#131211" />
    </svg>
  )
}

function Access({ sys }: { sys: SystemInfo | null | false }) {
  const urls = sys ? sys.remote.urls.filter((u) => !/\/\/(127\.0\.0\.1|localhost)/.test(u)) : []
  const [pick, setPick] = useState(0)
  const url = urls[Math.min(pick, urls.length - 1)]
  const [f, setF] = useState({ current: '', next: '', again: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function change(e: React.FormEvent) {
    e.preventDefault()
    if (f.next !== f.again) return setErr('As senhas novas não são iguais')
    if (f.next.length < 6) return setErr('Use pelo menos 6 caracteres')
    setBusy(true)
    try { await api('/api/password', 'POST', { current: f.current, next: f.next }); setF({ current: '', next: '', again: '' }); setErr(''); toast('Senha alterada') }
    catch (x) { setErr((x as Error).message === '401' ? 'Senha atual incorreta' : (x as Error).message) }
    setBusy(false)
  }
  const cmd = 'tailscale serve --bg 8787'
  return (
    <>
      <Group title="Endereço público" desc="Abra no celular e entre com a sua senha. No próprio PC não pede senha." bare>
        {sys === null ? <Skel className="h-[200px] rounded-2xl" /> : url ? (
          <div className="panel-card flex flex-col items-center gap-5 p-5 sm:flex-row sm:items-center">
            <QR text={url} />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {urls.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {urls.map((u, i) => (
                    <button key={u} type="button" aria-pressed={u === url} onClick={() => setPick(i)}
                      className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors', u === url ? 'border-white/25 bg-white/[0.08] text-foreground' : 'border-white/[0.08] text-t2 hover:text-foreground')}>{new URL(u).hostname}</button>
                  ))}
                </div>
              )}
              <span className="text-[13px] text-t2">Aponte a câmera do celular para o código ou abra:</span>
              <div className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] py-1 pl-4 pr-1">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{url}</span>
                <CopyBtn text={url} />
                <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Abrir endereço" className="inline-flex size-7 items-center justify-center rounded-lg text-t3 hover:bg-white/[0.06] hover:text-foreground"><ArrowUpRight size={14} /></a>
              </div>
              <span className="text-xs text-t3">Dica: no celular, use “Adicionar à tela inicial” para abrir como app.</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1 rounded-[24px] border border-dashed border-white/[0.1] px-5 py-6 text-center">
            <span className="font-medium">Nenhum endereço público ainda</span>
            <span className="text-[13px] text-t3">{sys === false ? 'O servidor ainda não informa o endereço.' : 'Siga o passo a passo abaixo para liberar o acesso pelo celular.'}</span>
          </div>
        )}
      </Group>
      <Group title="Acesso pelo Tailscale" desc="Rede privada entre seus aparelhos, sem abrir portas no roteador." bare>
        <ol className="panel-card m-0 flex list-none flex-col gap-0 p-0">
          {[
            <>Instale o <a className="underline decoration-white/30 underline-offset-4 hover:decoration-white" href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer">Tailscale</a> no PC e no celular e entre com a mesma conta.</>,
            <span className="flex flex-col gap-2">No PC, rode no terminal:
              <span className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] py-1 pl-4 pr-1"><code className="min-w-0 flex-1 truncate font-mono text-[13px]">{cmd}</code><CopyBtn text={cmd} /></span>
            </span>,
            <>No celular, abra <span className="font-mono text-[13px]">https://seu-pc.sua-rede.ts.net</span> e entre com a senha.</>,
            <>Toque em “Adicionar à tela inicial” para usar como app.</>,
          ].map((s, i) => (
            <li key={i} className="flex gap-3.5 border-b border-white/[0.06] px-4 py-3.5 text-[13.5px] leading-relaxed text-t1 last:border-0">
              <span className="bg-grad inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{i + 1}</span>
              <span className="min-w-0 flex-1 pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
      </Group>
      <Group title="Trocar senha" desc="Vale para todos os aparelhos que acessam de fora do PC." bare>
        <form onSubmit={change} className="panel-card flex flex-col gap-3 p-4 md:p-5">
          <input hidden readOnly autoComplete="username" value="gubots" />
          {([['current', 'Senha atual', 'current-password'], ['next', 'Nova senha', 'new-password'], ['again', 'Repita a nova senha', 'new-password']] as const).map(([k, l, ac]) => (
            <label key={k} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
              <span className="text-[13px] text-t2 sm:w-40 sm:shrink-0">{l}</span>
              <input type="password" autoComplete={ac} className={cn(field, 'h-9 !py-1.5')} value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value }); setErr('') }} />
            </label>
          ))}
          <div className="flex flex-wrap items-center gap-3 sm:pl-44">
            <button type="submit" className={cn(btn, 'h-9')} disabled={busy || !f.current || !f.next || !f.again}><KeyRound size={14} />{busy ? 'Salvando…' : 'Trocar senha'}</button>
            {err && <span role="alert" className="fade text-[13px] text-bad">{err}</span>}
          </div>
        </form>
      </Group>
      <Group title="Este aparelho">
        <Row title="Sair" desc={isLocalHost ? 'Você está no próprio PC: aqui o acesso é liberado sem senha.' : 'Este navegador vai pedir a senha de novo.'}>
          <button type="button" className={btn2} onClick={logout} disabled={isLocalHost}><LogOut size={14} />Sair</button>
        </Row>
      </Group>
    </>
  )
}

const uptime = (ms: number) => {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24)
  return d ? `${d} dia${d > 1 ? 's' : ''} e ${h % 24} h` : h ? `${h} h ${m % 60} min` : `${m} min`
}

function System({ sys }: { sys: SystemInfo | null | false }) {
  const [lines, setLines] = useState<string[] | null>(null)
  const box = useRef<HTMLPreElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const f = () => api<{ lines: string[] }>('/api/logs').then((r) => setLines(r?.lines ?? [])).catch(() => setLines((l) => l ?? []))
    f()
    const t = setInterval(f, 3000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { const e = box.current; if (e && stick.current) e.scrollTop = e.scrollHeight }, [lines])
  const quit = async () => { if (await confirmAsk({ title: 'Encerrar o Gubots?', body: 'O servidor e os navegadores dos bots serão fechados. Bots trabalhando serão interrompidos.', ok: 'Encerrar', danger: true })) api('/api/quit', 'POST').catch(() => {}) }
  return (
    <>
      {sys === false && <Missing />}
      <Group title="Sobre">
        <Row title="Versão">{sys ? <span className="font-mono text-[13px] text-t2">{sys.version}</span> : <Skel className="h-4 w-16" />}</Row>
        <Row stack title="Pasta de dados">{sys ? <span className="flex min-w-0 items-center gap-1"><span className="truncate font-mono text-[13px] text-t2 sm:max-w-[340px]">{sys.dataDir}</span><CopyBtn text={sys.dataDir} /></span> : <Skel className="h-4 w-48" />}</Row>
        <Row title="No ar há">{sys ? <span className="text-[13px] text-t2">{uptime(sys.uptime)}</span> : <Skel className="h-4 w-20" />}</Row>
      </Group>
      <Group title="Log recente" desc="Atualiza sozinho a cada 3 segundos." bare>
        <div className="relative overflow-hidden rounded-[22px] border border-white/[0.07] bg-[#050506]">
          <div className="absolute right-2 top-2 z-10">{lines && !!lines.length && <CopyBtn text={lines.join('\n')} className="bg-[#050506]/80" />}</div>
          <pre ref={box} onScroll={(e) => { const t = e.currentTarget; stick.current = t.scrollHeight - t.scrollTop - t.clientHeight < 30 }}
            className="m-0 h-80 overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs leading-relaxed text-t2">
            {lines === null ? 'carregando…' : lines.length ? lines.join('\n') : 'Sem linhas de log.'}
          </pre>
        </div>
      </Group>
      <Group title="Zona de perigo">
        <Row title="Encerrar o Gubots" desc="Fecha o servidor e todos os navegadores. Para voltar, abra o Gubots de novo no PC.">
          <button type="button" className={btnDanger} onClick={quit}><Power size={14} />Encerrar</button>
        </Row>
      </Group>
    </>
  )
}

// tempo real: vale para este aparelho (Web Speech API do navegador); o Whisper continua fazendo o texto final
function LiveStt() {
  const [on, setOn] = useState(liveSttOn)
  const ok = !!speechCtor()
  return (
    <Row title="Texto em tempo real" desc={ok ? 'O texto aparece enquanto você fala; ao parar, o motor abaixo refina e substitui. Vale para este aparelho.' : 'Este navegador não tem reconhecimento em tempo real (ex.: Safari/iOS): fica só a transcrição ao parar.'}>
      <Switch aria-label="Texto em tempo real" checked={on && ok} disabled={!ok} onCheckedChange={(c) => { setLiveStt(c); setOn(c) }} />
    </Row>
  )
}
