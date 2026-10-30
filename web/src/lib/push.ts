// Inscrição deste aparelho nas notificações push (o servidor avisa quando um pedido seu termina)
import { api } from '@/store'

export type PushState = 'on' | 'off' | 'denied' | 'unsupported' | 'insecure'

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const toBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0))
const reg = () => navigator.serviceWorker.ready

export async function pushStatus(): Promise<PushState> {
  if (!window.isSecureContext) return 'insecure'
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'off'
  const sub = await (await reg()).pushManager.getSubscription().catch(() => null)
  return sub ? 'on' : 'off'
}

// pede permissão (precisa de um toque do usuário) e inscreve; reaproveita a inscrição se a chave do servidor for a mesma
export async function enablePush(ask = true): Promise<PushState> {
  if (!window.isSecureContext) return 'insecure'
  if (!supported()) return 'unsupported'
  const perm = Notification.permission === 'default' && ask ? await Notification.requestPermission() : Notification.permission
  if (perm === 'denied') return 'denied'
  if (perm !== 'granted') return 'off'
  const r = await reg()
  const { key } = await api<{ key: string }>('/api/push/key')
  let sub = await r.pushManager.getSubscription()
  const cur = sub?.options.applicationServerKey
  if (sub && cur && btoa(String.fromCharCode(...new Uint8Array(cur))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== key) { await sub.unsubscribe(); sub = null }
  sub ??= await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) })
  await api('/api/push/subscribe', 'POST', sub.toJSON())
  return 'on'
}

export async function testPush() {
  const sub = await (await reg()).pushManager.getSubscription()
  if (!sub) throw new Error('Este aparelho não está inscrito')
  await api('/api/push/test', 'POST', { endpoint: sub.endpoint })
}
