import { createRoot } from 'react-dom/client'
import App from './App'
import { get, openConv, start, subscribe } from './store'
import { initHistory } from './lib/history'
import { enablePush } from './lib/push'
import './index.css'

createRoot(document.getElementById('root')!).render(<App />)
// aberto por uma notificação: /?conv=<id> abre a conversa assim que os dados carregarem
const fromPush = new URLSearchParams(location.search).get('conv')
if (fromPush) history.replaceState(null, '', '/')
const offConv = subscribe(() => {
  const s = get()
  if (!s.loaded) return
  offConv()
  if (fromPush && s.convs.some((c) => c.id === fromPush)) openConv(fromPush)
})
const offPush = subscribe(() => { // mantém este aparelho inscrito (sem pedir permissão de novo)
  const s = get()
  if (!s.settingsLive) return
  offPush()
  if (s.settings.notify) enablePush(false).catch(() => {})
})
start()
initHistory()
// arquivo solto fora das áreas que aceitam (barra lateral, painel): o navegador não abre o arquivo nem sai do app
for (const t of ['dragover', 'drop'] as const) addEventListener(t, (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() })
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.t === 'open-conv') openConv(e.data.convId) })

declare const __BUILD__: string
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register(`/sw.js?v=${__BUILD__}`).catch(() => {}))
}
