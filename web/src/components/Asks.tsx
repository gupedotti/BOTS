// Cartões de pedido do bot no chat: senha para o cofre (o bot nunca vê) e "assuma o navegador" (2FA, CAPTCHA…).
// Responder libera a ferramenta que o bot deixou esperando.
import { useState } from 'react'
import { Check, Globe, KeyRound, Lock, X } from 'lucide-react'
import { act, api, set, useStore } from '@/store'
import { cn, field } from '@/lib/utils'
import type { Msg } from '@/types'

type Meta = { req?: string; status?: string; name?: string; site?: string; username?: string; url?: string }
const main = 'inline-flex h-9 items-center gap-2 rounded-full bg-grad px-4 text-[14px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-40'
const chip = 'inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-4 text-[14px] font-medium text-t1 transition-colors hover:bg-white/[0.08]'
const STATUS: Record<string, string> = { saved: 'Salvo no cofre', done: 'Concluído', canceled: 'Recusado', expired: 'Expirou' }
const reply = (req: string, b: object) => act(api(`/api/asks/${req}`, 'POST', b))

function Shell({ icon, title, sub, status, children }: { icon: React.ReactNode; title: string; sub?: string; status?: string; children?: React.ReactNode }) {
  const open = status === 'open'
  return (
    <div className={cn('rise overflow-hidden rounded-[20px] border bg-surface', open ? 'border-warn/30' : 'border-white/[0.07] opacity-80')}>
      <div className="flex items-start gap-2.5 px-4 py-3 text-[14px]">
        <span className={cn('mt-0.5 shrink-0', open ? 'text-warn' : 'text-t3')}>{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="font-semibold">{title}</span>{sub && <span className="break-words text-[13px] text-t2">{sub}</span>}</span>
        {!open && status && <span className={cn('shrink-0 text-[12px] font-medium', status === 'saved' || status === 'done' ? 'text-ok' : 'text-t3')}>{STATUS[status] ?? status}</span>}
      </div>
      {open && children}
    </div>
  )
}

export function SecretAsk({ m }: { m: Msg }) {
  const meta = (m.meta ?? {}) as Meta
  const bot = useStore((s) => s.bots.find((b) => b.id === m.botId))
  const [user, setUser] = useState(meta.username ?? '')
  const [pass, setPass] = useState('')
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const go = async (b: object) => { setBusy(true); await reply(meta.req!, b); setBusy(false); setPass('') }
  return (
    <Shell icon={<KeyRound size={16} />} title={`${bot?.name ?? 'Bot'} precisa do login de ${meta.name}`} sub={m.text.replace(/^🔐[^:]*:\s*/, '')} status={meta.status}>
      <form className="flex flex-col gap-2.5 px-4 pb-4" onSubmit={(e) => { e.preventDefault(); if (pass) go({ action: 'save', username: user, password: pass, allBots: all }) }} autoComplete="off">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-t3"><Lock size={11} />{meta.site} · vai para o cofre criptografado; o bot só preenche, nunca vê</span>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={field} placeholder="Usuário ou e-mail" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" />
          <input className={field} type="password" placeholder="Senha" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-t2"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Liberar para todos os bots (senão, só {bot?.name ?? 'este bot'})</label>
        <div className="flex gap-2">
          <button type="submit" className={main} disabled={!pass || busy}><Check size={15} />Salvar no cofre</button>
          <button type="button" className={cn(chip, 'text-t2')} disabled={busy} onClick={() => go({ action: 'cancel' })}><X size={15} />Não enviar</button>
        </div>
      </form>
    </Shell>
  )
}

export function TakeoverAsk({ m }: { m: Msg }) {
  const meta = (m.meta ?? {}) as Meta
  const bot = useStore((s) => s.bots.find((b) => b.id === m.botId))
  const [busy, setBusy] = useState(false)
  const go = async (b: object) => { setBusy(true); await reply(meta.req!, b); setBusy(false) }
  let host = ''; try { host = meta.url ? new URL(meta.url).hostname : '' } catch { /* ignore */ }
  return (
    <Shell icon={<Globe size={16} />} title={`${bot?.name ?? 'Bot'} precisa de você no navegador`} sub={m.text.replace(/^🙋[^:]*:\s*/, '') + (host ? ` · ${host}` : '')} status={meta.status}>
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        <button type="button" className={chip} onClick={() => set({ selBot: m.botId ?? null, panel: true })}><Globe size={15} />Abrir navegador</button>
        <button type="button" className={main} disabled={busy} onClick={() => go({ action: 'done' })}><Check size={15} />Pronto, continue</button>
        <button type="button" className={cn(chip, 'text-t2')} disabled={busy} onClick={() => go({ action: 'cancel', note: 'não consegui' })}>Não consegui</button>
      </div>
    </Shell>
  )
}
