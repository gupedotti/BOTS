// Botão/gesto "voltar" (Android e navegador) navega dentro do app em vez de sair:
// cada mudança de tela ou painel vira uma entrada no histórico; voltar restaura a anterior.
// Na tela inicial, o primeiro voltar só avisa; o segundo sai do app.
import { get, set, subscribe, toast, type State } from '@/store'

type Snap = Pick<State, 'view' | 'convId' | 'taskSel' | 'panel' | 'selBot' | 'botDialog' | 'palette' | 'sidebar' | 'preview'>

const mobile = () => !matchMedia('(min-width:768px)').matches
// a barra lateral só conta no celular (lá ela é gaveta; no desktop é parte da tela)
const snap = (s: State): Snap => ({
  view: s.view, convId: s.convId, taskSel: s.view === 'tasks' ? s.taskSel : null, panel: s.panel, selBot: s.panel ? s.selBot : null,
  botDialog: s.botDialog, palette: s.palette, sidebar: mobile() && s.sidebar, preview: s.preview,
})
const key = (x: Snap) => JSON.stringify(x)

let stack: Snap[] = []
let idx = 0
let restoring = false
let ignore = 0 // popstates causados por nós mesmos (history.back ao fechar algo)
let atGuard = false // estamos na entrada-guarda: o próximo voltar sai do app
let timer: ReturnType<typeof setTimeout> | undefined

function apply(x: Snap) {
  restoring = true
  set({
    view: x.view, convId: x.convId, taskSel: x.taskSel, panel: x.panel, selBot: x.selBot ?? get().selBot, botDialog: x.botDialog, palette: x.palette, preview: x.preview,
    ...(mobile() ? { sidebar: x.sidebar } : {}),
  })
  restoring = false
}

let ready = false // só começa a registrar depois que os dados carregaram (o carregamento não vira entrada)

function sync() {
  if (!get().loaded) return
  if (!ready) { ready = true; stack = [snap(get())]; idx = 0; return }
  const cur = snap(get())
  const k = key(cur)
  if (k === key(stack[idx])) return
  if (atGuard) { atGuard = false; history.pushState({ gb: 0 }, '') } // saiu da guarda navegando: recria a entrada da tela inicial
  // fechou algo pelo próprio app (tocou fora da gaveta, Esc, X): equivale a voltar
  if (idx > 0 && k === key(stack[idx - 1])) {
    idx--
    stack.length = idx + 1
    ignore++
    history.back()
    return
  }
  stack = stack.slice(0, idx + 1)
  // escolheu algo na gaveta ou na busca: o destino substitui a gaveta (voltar não a reabre)
  const top = stack[idx]
  if (idx > 0 && (top.sidebar || top.palette) && !cur.sidebar && !cur.palette) {
    stack[idx] = cur
    history.replaceState({ gb: idx }, '')
    return
  }
  stack.push(cur)
  idx++
  history.pushState({ gb: idx }, '')
}

function onPop(e: PopStateEvent) {
  if (ignore) { ignore--; return }
  const s = get()
  if (s.ask) { // confirmação aberta: voltar = cancelar, sem mudar de tela
    s.ask.resolve(false)
    set({ ask: null })
    history.pushState({ gb: idx }, '')
    return
  }
  const j = typeof e.state?.gb === 'number' ? e.state.gb : -1
  if (j >= 0 && j < stack.length) { idx = j; atGuard = false; apply(stack[j]); return }
  // chegou na guarda: se não está na tela inicial limpa, vai para ela; senão avisa e deixa o próximo voltar sair
  idx = 0
  const home = s.view === 'chat' && !s.panel && !s.botDialog && !s.palette && !s.preview && !(mobile() && s.sidebar)
  if (!home) {
    apply({ ...snap(s), view: 'chat', taskSel: null, panel: false, botDialog: null, palette: false, sidebar: false, preview: null })
    stack = [snap(get())]
    history.pushState({ gb: 0 }, '')
    return
  }
  stack = [snap(s)]
  atGuard = true
  toast('Toque em voltar de novo para sair')
}

export function initHistory() {
  stack = [snap(get())]
  history.replaceState({ gb: -1 }, '') // guarda
  history.pushState({ gb: 0 }, '')
  subscribe(() => { if (!restoring) { clearTimeout(timer); timer = setTimeout(sync, 0) } })
  addEventListener('popstate', onPop)
}
