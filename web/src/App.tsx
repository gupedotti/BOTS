import { useEffect, useState } from 'react'
import { Tooltip } from 'radix-ui'
import { AlertTriangle } from 'lucide-react'
import { Orb } from '@/components/Avatar'
import { CommandPalette } from '@/components/CommandPalette'
import { Sidebar } from '@/components/Sidebar'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { BotDialog, Bots } from '@/views/Bots'
import { Chat } from '@/views/Chat'
import { Memory } from '@/views/Memory'
import { Settings } from '@/views/Settings'
import { Tasks } from '@/views/Tasks'
import { Schedules } from '@/views/Schedules'
import { btn, btn2, cn, field } from '@/lib/utils'
import { go, login, newChat, set, useStore } from '@/store'

function Login() {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="relative flex h-dvh items-center justify-center overflow-hidden px-6 pb-[var(--sab)] pt-[var(--sat)]">
      <form className="view-in flex w-full max-w-[360px] flex-col items-center gap-8 text-center"
        onSubmit={async (e) => { e.preventDefault(); if (!pw || busy) return; setBusy(true); const r = await login(pw); setBusy(false); if (r) { setErr(r); setPw('') } }}>
        <Orb size={150} />
        <div className="flex flex-col gap-2">
          <h1 className="m-0 text-[30px] font-semibold leading-tight tracking-[-0.03em]">Entrar no Gubots</h1>
          <p className="m-0 text-[15px] text-t2">Digite a senha para falar com seus bots.</p>
        </div>
        <div className="flex w-full flex-col gap-2 text-left">
          <input hidden readOnly autoComplete="username" value="gubots" />
          <input type="password" autoFocus autoComplete="current-password" aria-label="Senha" aria-invalid={!!err} aria-describedby={err ? 'login-err' : undefined}
            placeholder="Senha" value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }}
            className={cn(field, 'h-[52px] rounded-full px-5 text-[15px]', err && 'border-live/50 hover:border-live/50 focus:border-live/60')} />
          {err && <span id="login-err" role="alert" className="fade px-5 text-[13px] text-bad">{err}</span>}
        </div>
        <button type="submit" className={cn(btn, 'h-[52px] w-full text-[15px]')} disabled={!pw || busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  )
}

function Confirm() {
  const ask = useStore((s) => s.ask)
  const [typed, setTyped] = useState('')
  useEffect(() => setTyped(''), [ask])
  const done = (v: boolean) => { ask?.resolve(v); set({ ask: null }) }
  const ok = !ask?.typed || typed.trim().toLowerCase() === ask.typed.toLowerCase()
  return (
    <Dialog open={!!ask} onOpenChange={(o) => !o && done(false)}>
      <DialogContent showCloseButton={false} className="gap-6 sm:max-w-[420px]">
        <div className="flex gap-3.5">
          {ask?.danger && <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-live/20 bg-live/10 text-bad"><AlertTriangle size={19} /></span>}
          <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
            <DialogTitle className="text-[17px] leading-snug">{ask?.title}</DialogTitle>
            <DialogDescription className="text-[13.5px] leading-relaxed text-t2">{ask?.body ?? ''}</DialogDescription>
          </div>
        </div>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (ok) done(true) }}>
          {ask?.typed && (
            <label className="flex flex-col gap-2 text-[13px] text-t2">
              <span>Para confirmar, digite <b className="font-semibold text-foreground">{ask.typed}</b></span>
              <input autoFocus className={cn(field, 'h-10 !py-2')} value={typed} onChange={(e) => setTyped(e.target.value)} />
            </label>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={cn(btn2, 'h-11 sm:h-9')} onClick={() => done(false)}>Cancelar</button>
            <button type="submit" autoFocus={!ask?.typed} disabled={!ok}
              className={cn(btn, 'h-11 sm:h-9', ask?.danger && 'bg-live text-white shadow-[0_10px_28px_-10px_rgba(244,63,94,0.8)] hover:brightness-110')}>{ask?.ok ?? 'Confirmar'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function App() {
  const auth = useStore((s) => s.auth)
  const view = useStore((s) => s.view)
  const online = useStore((s) => s.online)
  const loaded = useStore((s) => s.loaded)
  const toastMsg = useStore((s) => s.toastMsg)
  const newBuild = useStore((s) => s.newBuild)
  const toastId = useStore((s) => s.toastId)
  const botDialog = useStore((s) => s.botDialog)

  useEffect(() => { // atalhos globais
    const f = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'k') { e.preventDefault(); set((s) => ({ palette: !s.palette })) }
      else if (k === 'b' && !e.shiftKey) { e.preventDefault(); set((s) => ({ sidebar: !s.sidebar })) }
      else if (k === ',') { e.preventDefault(); go('settings') }
      else if (k === 'o' && e.shiftKey) { e.preventDefault(); newChat() }
    }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [])

  const updated = newBuild && (
    <div role="status" className="pop glass fixed left-1/2 top-[calc(0.75rem+var(--sat))] z-[80] flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full py-1.5 pl-4 pr-1.5 text-[13px]">
      <span className="size-2 rounded-full bg-ok shadow-[0_0_10px_rgba(74,222,128,0.8)]" />O Gubots foi atualizado
      <button type="button" onClick={() => location.reload()} className="bg-grad h-8 rounded-full px-3.5 text-[13px] font-semibold">Recarregar</button>
    </div>
  )
  const toast = toastMsg && (
    <div key={toastId} role="status" aria-live="polite"
      className="glass fixed bottom-[calc(6rem+var(--sab))] left-1/2 z-[90] w-max max-w-[min(90vw,440px)] -translate-x-1/2 rounded-full px-5 py-2.5 text-center text-[13.5px] text-foreground duration-300 animate-in fade-in-0 slide-in-from-bottom-4 md:bottom-8">
      {toastMsg}
    </div>
  )
  if (auth === 'need') return <><Login />{toast}</>
  return (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={200}>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col pt-[var(--sat)]">
          {!online && loaded && <div className="fade flex items-center justify-center gap-2 bg-warn/10 px-4 py-1.5 text-center text-xs text-warn"><span className="size-1.5 animate-pulse rounded-full bg-warn" />Sem conexão com o servidor. Tentando reconectar…</div>}
          <div key={view} className="view-in flex min-h-0 flex-1 flex-col">
            {view === 'chat' && <Chat />}
            {view === 'bots' && <Bots />}
            {view === 'tasks' && <Tasks />}
            {view === 'schedules' && <Schedules />}
            {view === 'memory' && <Memory />}
            {view === 'settings' && <Settings />}
          </div>
        </main>
        <CommandPalette />
        {botDialog && <BotDialog key={botDialog} id={botDialog === 'new' ? null : botDialog} />}
        <Confirm />
        {toast}{updated}
      </div>
    </Tooltip.Provider>
  )
}
