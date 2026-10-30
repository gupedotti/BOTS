import { useSyncExternalStore } from 'react'
import type { ActivityItem, Bot, Conv, Frame, Models, Msg, Schedule, Settings, Task } from './types'

export type View = 'chat' | 'bots' | 'tasks' | 'schedules' | 'memory' | 'settings'
export type Ask = { title: string; body?: string; ok?: string; danger?: boolean; typed?: string; resolve: (v: boolean) => void }

export interface State {
  auth: 'ok' | 'need'
  online: boolean
  loaded: boolean
  bots: Bot[]
  convs: Conv[]
  tasks: Task[]
  schedules: Schedule[]
  msgs: Record<string, Msg[]>
  deltas: Record<string, Record<string, string>>
  activity: Record<string, ActivityItem[]>
  models: Models | null
  view: View
  convId: string | null
  selBot: string | null // bot cujo computador aparece no painel
  panel: boolean // painel do computador em tela cheia (telas pequenas)
  sidebar: boolean
  botDialog: null | 'new' | string
  taskSel: number | null
  factsTick: number
  toastMsg: string
  newBuild: boolean // o servidor tem uma versão nova da UI (ex.: o bot de manutenção atualizou o app)
  toastId: number
  settings: Settings
  settingsLive: boolean // servidor já tem /api/settings
  palette: boolean
  ask: Ask | null
  preview: { url: string; name: string; size?: number; mime?: string } | null // arquivo aberto em tela cheia no chat
  gone: Record<string, true> // arquivos do chat que não existem mais (apagados)
}

export const DEFAULT_SETTINGS: Settings = {
  userName: '', sendOnEnter: true, animations: true, notify: false, adblock: true, headed: false, graphNightly: true,
  composio: { set: false }, elevenlabs: { set: false }, openai: { set: false }, groq: { set: false }, sttEngine: 'local', sttModel: 'small', sttRefine: true,
}

const isDesktop = () => matchMedia('(min-width:768px)').matches

let state: State = {
  auth: 'ok', online: false, loaded: false, bots: [], convs: [], tasks: [], schedules: [], msgs: {}, deltas: {}, activity: {},
  models: null, view: 'chat', convId: null, selBot: null, panel: false, sidebar: isDesktop(), botDialog: null, taskSel: null,
  newBuild: false, factsTick: 0, toastMsg: '', toastId: 0, settings: DEFAULT_SETTINGS, settingsLive: false, palette: false, ask: null, preview: null, gone: {},
}
const subs = new Set<() => void>()
export const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f))

export const get = () => state
export function set(p: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof p === 'function' ? p(state) : p) }
  subs.forEach((f) => f())
}
// seletores precisam devolver referências estáveis (campos do estado)
export const useStore = <T,>(sel: (s: State) => T): T => useSyncExternalStore(subscribe, () => sel(state))

let toastT: ReturnType<typeof setTimeout>
let buildSeen = ''
export function toast(m: string) {
  set((s) => ({ toastMsg: m, toastId: s.toastId + 1 }))
  clearTimeout(toastT)
  toastT = setTimeout(() => set({ toastMsg: '' }), 4500)
}

// confirmação bonita no lugar de window.confirm; `typed` exige digitar o texto para liberar
export const confirmAsk = (o: Omit<Ask, 'resolve'>) => new Promise<boolean>((resolve) => set({ ask: { ...o, resolve } }))

// ---------- REST (acesso remoto: cookie HttpOnly do login; no próprio PC não pede senha) ----------

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const h: Record<string, string> = {}
  let b: BodyInit | undefined
  if (body instanceof Blob) b = body
  else if (body !== undefined) { h['content-type'] = 'application/json'; b = JSON.stringify(body) }
  let r: Response
  try { r = await fetch(path, { method, headers: h, body: b }) } catch { throw new Error('Sem conexão com o servidor') }
  if (r.status === 401) { set({ auth: 'need' }); throw new Error('401') }
  const txt = await r.text()
  let j: any = null
  try { j = txt ? JSON.parse(txt) : null } catch { /* resposta não-JSON */ }
  if (!r.ok) throw new Error(j?.error || `Erro ${r.status}`)
  return j as T
}

// executa e mostra erro em toast; devolve undefined se falhar
export async function act<T>(p: Promise<T>): Promise<T | undefined> {
  try { return await p } catch (e) { const m = (e as Error).message; if (m !== '401') toast(m) }
}

// baixa um arquivo do bot (o cookie de login vai junto sozinho)
export function download(path: string, name: string) {
  const a = document.createElement('a')
  a.href = path
  a.download = name
  a.click()
}

export async function load() {
  try {
    const s = await api<{ bots: Bot[]; convs: Conv[]; tasks: Task[]; schedules?: Schedule[] }>('/api/state')
    const first = !state.loaded
    set({ auth: 'ok', loaded: true, bots: s.bots || [], convs: s.convs || [], tasks: s.tasks || [], schedules: s.schedules || [] })
    const st = get()
    if (st.convId && st.convs.some((c) => c.id === st.convId)) fetchMsgs(st.convId) // reconexão: ressincroniza
    else if (first) { const f = [...st.convs].sort((a, b) => b.lastTs - a.lastTs)[0]; if (f) openConv(f.id, false) }
  } catch { /* servidor fora do ar: estado vazio */ }
}

export function loadModels(refresh = false) {
  if (!refresh && state.models && !state.models.errors) return Promise.resolve()
  return api<Models>('/api/models' + (refresh ? '?refresh' : '')).then((m) => set({ models: m })).catch((e: Error) =>
    set({ models: { claude: [], codex: [], errors: { claude: e.message, codex: e.message } } }))
}

// ---------- configurações ----------
const applyMotion = (on: boolean) => document.documentElement.classList.toggle('reduce-motion', !on)
export function loadSettings() {
  api<Settings>('/api/settings').then((s) => { set({ settings: { ...DEFAULT_SETTINGS, ...s }, settingsLive: true }); applyMotion(s.animations !== false) }).catch(() => {})
}
export async function saveSettings(p: Partial<Settings> & { composioKey?: string; elevenlabsKey?: string; openaiKey?: string; groqKey?: string }) {
  const { composioKey: _c, elevenlabsKey: _e, openaiKey: _o, groqKey: _g, ...local } = p
  set((s) => ({ settings: { ...s.settings, ...local } })) // otimista
  if ('animations' in p) applyMotion(!!p.animations)
  try {
    const s = await api<Settings>('/api/settings', 'PUT', p)
    set({ settings: { ...DEFAULT_SETTINGS, ...s }, settingsLive: true })
    return true
  } catch (e) { toast((e as Error).message === 'Erro 404' || (e as Error).message === 'rota não existe' ? 'O servidor ainda não salva configurações' : (e as Error).message); return false }
}

export async function login(password: string): Promise<string | null> {
  let r: Response
  try { r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }) } catch { return 'Sem conexão com o servidor' }
  if (r.status === 401) return 'Senha incorreta'
  if (r.status === 429) return 'Muitas tentativas. Espere um pouco e tente de novo.'
  if (!r.ok) return `Erro ${r.status}`
  set({ auth: 'ok' })
  await load()
  ws?.close() // reconecta já com o cookie
  return null
}
export async function logout() {
  await api('/api/logout', 'POST').catch(() => {})
  set({ auth: 'need' })
  ws?.close()
}

// ---------- navegação / conversas ----------
export const go = (view: View) => set((s) => ({ view, panel: false, sidebar: isDesktop() ? s.sidebar : false }))
export const newChat = () => set((s) => ({ view: 'chat', convId: null, selBot: null, panel: false, sidebar: isDesktop() ? s.sidebar : false }))

const loadedConvs = new Set<string>()
export function openConv(id: string, nav = true) {
  set((s) => ({ view: nav ? 'chat' : s.view, convId: id, selBot: null, panel: false, sidebar: isDesktop() ? s.sidebar : false }))
  if (!loadedConvs.has(id)) fetchMsgs(id)
}

// ---------- não lidas: conversa aberta e visível = lida (o servidor guarda e sincroniza os aparelhos) ----------
const viewing = (id: string) => state.auth === 'ok' && state.view === 'chat' && state.convId === id && document.visibilityState === 'visible'
const reading = new Set<string>()
function markRead(id: string) {
  set((s) => ({ convs: s.convs.map((c) => (c.id === id && c.unread ? { ...c, unread: 0 } : c)) }))
  if (reading.has(id)) return
  reading.add(id)
  api<Conv>(`/api/convs/${id}/read`, 'POST').catch(() => {}).finally(() => reading.delete(id))
}
export const unreadTotal = (s: State) => s.convs.reduce((n, c) => n + (c.unread ?? 0), 0)
let lastTotal = -1
subscribe(() => { // abriu/voltou para a conversa com não lidas → marca; total vai para o título e o ícone do app
  const c = state.convId ? state.convs.find((x) => x.id === state.convId) : undefined
  if (c?.unread && viewing(c.id)) markRead(c.id)
  const n = unreadTotal(state)
  if (n === lastTotal) return
  lastTotal = n
  document.title = n ? `(${n}) Gubots` : 'Gubots'
  try { if (n) (navigator as any).setAppBadge?.(n)?.catch?.(() => {}); else (navigator as any).clearAppBadge?.()?.catch?.(() => {}) } catch { /* sem suporte */ }
})
document.addEventListener('visibilitychange', () => { if (state.convId && viewing(state.convId)) set({}) })

function fetchMsgs(id: string) {
  loadedConvs.add(id)
  api<Msg[]>(`/api/convs/${id}/messages`)
    .then((m) => set((s) => ({ msgs: { ...s.msgs, [id]: mergeMsgs(m || [], s.msgs[id] || []) } })))
    .catch(() => loadedConvs.delete(id))
}

const mergeMsgs = (a: Msg[], b: Msg[]) => {
  const m = new Map<string | number, Msg>()
  for (const x of [...a, ...b]) m.set(x.id, x)
  return [...m.values()].sort((x, y) => x.ts - y.ts)
}
const upsert = <T extends { id: string | number }>(l: T[], x: T) =>
  l.some((i) => i.id === x.id) ? l.map((i) => (i.id === x.id ? x : i)) : [...l, x]

export const putBot = (b: Bot) => set((s) => ({ bots: upsert(s.bots, b) }))
export const dropBot = (id: string) => set((s) => ({ bots: s.bots.filter((b) => b.id !== id) }))

export async function openBot(botId: string, computer = false) {
  let c: Conv | undefined = get().convs.filter((c) => c.kind === 'bot' && c.botIds.length === 1 && c.botIds[0] === botId).sort((a, b) => b.lastTs - a.lastTs)[0]
  if (!c) {
    const bot = get().bots.find((b) => b.id === botId)
    c = await act(api<Conv>('/api/convs', 'POST', { kind: 'bot', title: bot?.name || 'Conversa', botIds: [botId] }))
    if (!c) return
    const nc = c
    set((s) => ({ convs: upsert(s.convs, nc) }))
  }
  openConv(c.id)
  if (computer) set({ selBot: botId, panel: true })
}

// missão: grupo visível orquestrado pelo chefe (problema + 2 a 6 bots); o chefe já começa montando o plano
export async function newMission(title: string, problem: string, botIds: string[]) {
  const c = await act(api<Conv>('/api/missions', 'POST', { title, problem, botIds }))
  if (!c) return false
  set((s) => ({ convs: upsert(s.convs, c) }))
  openConv(c.id)
  return true
}
export const closeMission = (id: string) => act(api(`/api/convs/${id}/close`, 'POST')).then((r) => r && toast('Encerrando: o Jarvis posta a síntese e ela vai para a memória'))

export async function askDelete(c: Conv) {
  if (await confirmAsk({ title: `Apagar ${c.kind === 'mission' ? 'a missão' : 'a conversa'} “${c.title}”?`, body: 'Ela some da barra lateral. O histórico bruto continua guardado no servidor.', ok: 'Apagar', danger: true }))
    deleteConv(c.id)
}
export async function deleteConv(id: string) {
  if (!(await act(api('/api/convs/' + id, 'DELETE')))) return
  set((s) => ({ convs: s.convs.filter((c) => c.id !== id), convId: s.convId === id ? null : s.convId }))
}

// anexos: sobem um a um para a conversa e a mensagem leva só os nomes devolvidos
export function send(convId: string, text: string, files: File[] = []) {
  const atts = files.map((f) => ({ name: f.name, size: f.size, mime: f.type, url: URL.createObjectURL(f) }))
  const tmp: Msg = { id: 'tmp-' + Date.now(), convId, role: 'user', text, ts: Date.now(), meta: atts.length ? { attachments: atts } : undefined }
  set((s) => ({ msgs: { ...s.msgs, [convId]: [...(s.msgs[convId] || []), tmp] } }))
  return act((async () => {
    const up = await Promise.all(files.map((f) => api<{ file: string }>(`/api/convs/${convId}/upload?name=${encodeURIComponent(f.name)}`, 'POST', f)))
    return api(`/api/convs/${convId}/messages`, 'POST', { text, files: up.map((u) => u.file) })
  })())
}

// "Nova conversa": a conversa só nasce no primeiro envio, com título tirado da mensagem
export async function startConv(botId: string, text: string, files: File[] = []) {
  const title = text.replace(/\s+/g, ' ').slice(0, 48) || files[0]?.name || 'Conversa'
  const c = await act(api<Conv>('/api/convs', 'POST', { kind: 'bot', title, botIds: [botId] }))
  if (!c) return
  loadedConvs.add(c.id)
  set((s) => ({ convs: upsert(s.convs, c), msgs: { ...s.msgs, [c.id]: [] }, convId: c.id, view: 'chat' }))
  send(c.id, text, files)
}

export function retry(convId: string) {
  const last = [...(state.msgs[convId] || [])].reverse().find((m) => m.role === 'user')
  if (last) send(convId, last.text)
}
export const stopConv = (convId: string) => act(api(`/api/convs/${convId}/stop`, 'POST'))

// aviso ao terminar. App fechado ou em segundo plano: quem avisa é a notificação push (service worker).
// App aberto: um "tim" curto e um aviso na tela (se for outra conversa). Sem push: notificação da página.
function notifyDone(m: Msg) {
  if (!state.settings.notify || (!document.hidden && state.view === 'chat' && state.convId === m.convId)) return
  const name = state.bots.find((b) => b.id === m.botId)?.name ?? 'Bot'
  if (document.hidden) {
    const push = 'PushManager' in window && !!navigator.serviceWorker?.controller
    try { if (!push && Notification.permission === 'granted') new Notification(name, { body: m.text.slice(0, 140), icon: '/icon-chefe-192.png', tag: m.convId }) } catch { /* sem suporte */ }
    return
  }
  toast(`${name} respondeu`)
  try {
    const a = new AudioContext(), o = a.createOscillator(), g = a.createGain()
    o.frequency.value = 880; g.gain.setValueAtTime(0.06, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.35)
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.35)
  } catch { /* sem áudio */ }
}

// ---------- WebSocket ----------
let ws: WebSocket | null = null
let watching: string | null = null
const wsSend = (o: unknown) => { if (ws?.readyState === 1) ws.send(JSON.stringify(o)) }
export const wsInput = wsSend
export function watch(botId: string | null) { watching = botId; wsSend({ t: 'watch', botId }) }

const frames = new Map<string, Frame>()
const frameSubs = new Set<(f: Frame) => void>()
export const lastFrame = (botId: string) => frames.get(botId)
export function onFrame(cb: (f: Frame) => void) { frameSubs.add(cb); return () => void frameSubs.delete(cb) }

let dbuf: Record<string, string> = {}
let draf = 0
function flushDeltas() {
  draf = 0
  const b = dbuf
  dbuf = {}
  set((s) => {
    const d = { ...s.deltas }
    for (const k in b) { const [c, bt] = k.split('|'); d[c] = { ...d[c], [bt]: (d[c]?.[bt] ?? '') + b[k] } }
    return { deltas: d }
  })
}

function addMsg(m: Msg) {
  if (draf) { cancelAnimationFrame(draf); flushDeltas() }
  set((s) => {
    let l = s.msgs[m.convId] || []
    if (m.role === 'user') l = l.filter((x) => !(String(x.id).startsWith('tmp-') && x.text === m.text)) // troca a mensagem otimista
    const deltas = { ...s.deltas }
    if (m.role === 'bot' && m.botId && deltas[m.convId]?.[m.botId] != null) {
      const { [m.botId]: _, ...rest } = deltas[m.convId]
      deltas[m.convId] = rest
    }
    const fresh = m.role === 'bot' && !(s.msgs[m.convId] || []).some((x) => x.id === m.id)
    const seen = viewing(m.convId)
    const convs = s.convs.map((c) => (c.id === m.convId ? { ...c, lastTs: Math.max(c.lastTs, m.ts), ...(fresh && !seen ? { unread: (c.unread ?? 0) + 1 } : {}) } : c))
    return { msgs: { ...s.msgs, [m.convId]: mergeMsgs(l, [m]) }, deltas, convs }
  })
  if (m.role === 'bot' && viewing(m.convId)) markRead(m.convId) // chegou com você olhando: já conta como lida no servidor
}

function handle(m: any) {
  switch (m.t) {
    case 'msg': if (m.msg.role === 'bot') notifyDone(m.msg); return addMsg(m.msg)
    case 'delta': {
      dbuf[m.convId + '|' + m.botId] = (dbuf[m.convId + '|' + m.botId] ?? '') + m.text
      if (!draf) draf = requestAnimationFrame(flushDeltas)
      return
    }
    case 'activity':
      return set((s) => ({ activity: { ...s.activity, [m.botId]: [...(s.activity[m.botId] || []), m.item].slice(-300) } }))
    case 'bot':
      return set((s) => {
        const deltas = { ...s.deltas }
        for (const c in deltas) if (deltas[c][m.bot.id] != null && !(m.bot.busyIn ?? []).includes(c)) { const { [m.bot.id]: _, ...r } = deltas[c]; deltas[c] = r }
        return { bots: upsert(s.bots, m.bot), deltas }
      })
    case 'bots': return set({ bots: m.bots })
    case 'conv': return set((s) => ({ convs: upsert(s.convs, m.conv) }))
    case 'task': return set((s) => ({ tasks: upsert(s.tasks, m.task) }))
    case 'schedule': return set((s) => ({ schedules: upsert(s.schedules, m.schedule) }))
    case 'schedule-del': return set((s) => ({ schedules: s.schedules.filter((x) => x.id !== m.id) }))
    case 'task-del': return set((s) => ({ tasks: s.tasks.filter((t) => t.id !== m.id), taskSel: s.taskSel === m.id ? null : s.taskSel }))
    case 'frame': {
      frames.set(m.botId, m)
      return frameSubs.forEach((f) => f(m))
    }
    case 'facts': return set((s) => ({ factsTick: s.factsTick + 1 }))
    case 'build': return m.id && (!buildSeen ? void (buildSeen = m.id) : m.id !== buildSeen && set({ newBuild: true }))
  }
}

// o servidor manda ping a cada 25 s: 60 s sem nada = conexão morta sem aviso (túnel caiu, celular dormiu)
let lastMsg = 0
let offTimer = 0
let reconnTimer = 0
const stale = () => ws?.readyState === 1 && Date.now() - lastMsg > 60_000
// socket morto pode levar minutos para disparar onclose: larga ele e abre outro na hora
const reopen = () => { const w = ws; ws = null; w?.close(); clearTimeout(reconnTimer); connect() }
setInterval(() => { if (stale()) reopen() }, 10_000)
const wake = () => { if (stale() || (ws?.readyState === 3 && reconnTimer)) reopen() }
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake() })
addEventListener('online', wake)

export function connect() {
  reconnTimer = 0
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  const w = (ws = new WebSocket(url))
  w.onopen = () => {
    lastMsg = Date.now()
    clearTimeout(offTimer)
    set({ online: true })
    if (watching) wsSend({ t: 'watch', botId: watching })
    if (get().loaded) load() // reconectou: ressincroniza
  }
  w.onmessage = (e) => { lastMsg = Date.now(); try { handle(JSON.parse(e.data)) } catch { /* ignora */ } }
  w.onclose = (e) => {
    if (ws !== w) return
    if (e.code === 4401) set({ online: false, auth: 'need' })
    else { clearTimeout(offTimer); offTimer = setTimeout(() => ws?.readyState !== 1 && set({ online: false }), 4000) } // queda curta não pisca o aviso
    reconnTimer = setTimeout(connect, e.code === 4401 ? 5000 : 2000)
  }
}

export function start() {
  load()
  loadSettings()
  loadModels() // para mostrar os nomes dos modelos nas mensagens
  connect()
}
