import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Download, FileText, Globe, Lock, Maximize2, Minimize2, Minus, MousePointer2, RefreshCw, X } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Dot, Skel, Tip } from '@/components/bits'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { act, api, download, lastFrame, onFrame, set, useStore, watch, wsInput } from '@/store'
import { cn, field, hhmmss, iconBtn, roundBtn, size } from '@/lib/utils'
import type { Bot, Frame } from '@/types'

const trig = 'h-8 flex-none rounded-full border-0 px-4 text-[13px] font-medium text-t2 transition-colors hover:text-foreground focus-visible:ring-0 data-[state=active]:glass-btn data-[state=active]:text-foreground data-[state=active]:shadow-none'
const WK = 'gubots-panel-w'
const clampW = (w: number) => Math.round(Math.min(Math.max(w, 380), innerWidth * 0.7))

export function Computer({ botId, bots, overlay }: { botId: string; bots: Bot[]; overlay: boolean }) {
  const all = useStore((s) => s.bots)
  const bot = bots.find((b) => b.id === botId) ?? all.find((b) => b.id === botId)
  const [tab, setTab] = useState('activity')
  const [control, setControl] = useState(false)
  const [live, setLive] = useState(false)
  const [url, setUrl] = useState('')
  const [w, setW] = useState(() => { try { return clampW(Number(localStorage.getItem(WK)) || 560) } catch { return 560 } })
  const close = () => set({ panel: false })

  useEffect(() => { setControl(false) }, [botId])
  useEffect(() => { // assina o screencast enquanto o painel está aberto
    watch(botId)
    return () => watch(null)
  }, [botId])

  // arrastar a borda esquerda redimensiona; largura fica salva neste navegador
  function resize(e: React.PointerEvent) {
    e.preventDefault()
    const x0 = e.clientX, w0 = w
    let last = w0
    const move = (ev: PointerEvent) => setW((last = clampW(w0 + x0 - ev.clientX)))
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up)
      document.body.style.cursor = ''; document.body.style.userSelect = ''
      try { localStorage.setItem(WK, String(last)) } catch { /* ignore */ }
    }
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }
  const nudge = (d: number) => setW((v) => { const n = clampW(v + d); try { localStorage.setItem(WK, String(n)) } catch { /* ignore */ } return n })

  return (
    <>
      {overlay && <div className="fade fixed inset-0 z-30 hidden bg-black/60 backdrop-blur-[3px] md:block" onClick={close} />}
      <section aria-label={`Computador de ${bot?.name ?? ''}`} style={overlay ? undefined : { width: w }}
        className={cn('flex min-h-0 flex-col bg-panel',
          overlay ? 'fixed inset-0 z-40 pb-[var(--sab)] pt-[var(--sat)] duration-[420ms] ease-[var(--ease)] animate-in slide-in-from-right md:left-auto md:w-[min(640px,92vw)] md:border-l md:border-white/[0.06] md:shadow-2xl md:shadow-black/80'
            : 'relative shrink-0 border-l border-white/[0.06] duration-300 animate-in fade-in-0 slide-in-from-right-10')}>
        {!overlay && (
          <div role="separator" aria-orientation="vertical" aria-label="Redimensionar painel" tabIndex={0} onPointerDown={resize}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft') nudge(24); if (e.key === 'ArrowRight') nudge(-24) }}
            className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize outline-none">
            <span className="absolute inset-y-0 left-1.5 w-px transition-colors group-hover:bg-white/25 group-focus-visible:bg-white/40 group-active:bg-white/40" />
          </div>
        )}

        <header className="flex h-16 shrink-0 items-center gap-2.5 pl-3 pr-3">
          {overlay && <button type="button" aria-label="Fechar painel" className={cn(roundBtn, 'size-10 md:hidden')} onClick={close}><X size={18} /></button>}
          {bots.length > 1 ? (
            <span className="flex -space-x-1">
              {bots.map((b) => (
                <Tip key={b.id} label={b.name} side="bottom">
                  <button type="button" aria-label={`Computador de ${b.name}`} aria-pressed={b.id === botId} onClick={() => set({ selBot: b.id })}
                    className={cn('rounded-full bg-panel p-0.5 transition-opacity', b.id === botId ? 'ring-1 ring-brand/60' : 'opacity-60 hover:opacity-100')}>
                    <Avatar bot={b.avatar} size={24} working={b.status === 'working'} />
                  </button>
                </Tip>
              ))}
            </span>
          ) : bot && <Avatar bot={bot.avatar} size={26} working={bot.status === 'working'} />}
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[13.5px] font-semibold"><span className="hidden sm:inline">Computador do </span>{bot?.name}</span>
            <span className="truncate text-xs text-t3">{bot?.status === 'working' ? 'trabalhando agora' : 'em espera'}</span>
          </span>
          <span className={cn('ml-1 hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors min-[400px]:inline-flex', live ? 'bg-live/[0.12] text-bad' : 'bg-white/[0.05] text-t3')}>
            <Dot color={live ? '#F05252' : '#6b6b74'} pulse={live} />{live ? 'Ao vivo' : 'Sem imagem'}
          </span>
          <div className="flex-1" />
          <button type="button" aria-pressed={control} onClick={() => setControl(!control)}
            className={cn('h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-[background-color,filter]', control ? 'border border-white/20 text-foreground hover:bg-white/[0.06]' : 'bg-grad hover:brightness-110')}>
            {control ? 'Devolver' : 'Assumir'}<span className="hidden sm:inline"> controle</span>
          </button>
          <Tip label="Minimizar" side="bottom">
            <button type="button" aria-label="Minimizar navegador" className={cn(iconBtn, overlay && 'hidden md:inline-flex')} onClick={close}><Minus size={18} /></button>
          </Tip>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
          <Browser botId={botId} name={bot?.name ?? 'bot'} control={control} onControl={setControl} onLive={setLive} url={url} onUrl={setUrl} />
          <Tabs value={tab} onValueChange={setTab} className="min-h-[160px] flex-1 gap-2">
            <TabsList className="h-auto gap-1 rounded-full border border-white/[0.07] bg-white/[0.03] p-1">
              <TabsTrigger value="activity" className={trig}>Atividade</TabsTrigger>
              <TabsTrigger value="files" className={trig}>Arquivos</TabsTrigger>
            </TabsList>
            <TabsContent value="activity" className="fade min-h-0"><Activity botId={botId} /></TabsContent>
            <TabsContent value="files" className="fade min-h-0"><Files botId={botId} /></TabsContent>
          </Tabs>
        </div>
      </section>
    </>
  )
}

function Browser({ botId, name, control, onControl, onLive, url, onUrl }: { botId: string; name: string; control: boolean; onControl: (v: boolean) => void; onLive: (v: boolean) => void; url: string; onUrl: (u: string) => void }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const lastAt = useRef(0)
  const [draft, setDraft] = useState<string | null>(null)
  const [has, setHas] = useState(false)
  const [typed, setTyped] = useState('')
  const kb = useRef<HTMLInputElement>(null) // teclado do celular: o que entra aqui vai direto, letra por letra, para o site
  const touchDev = matchMedia('(pointer: coarse)').matches
  const [full, setFull] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = (ev: object) => wsInput({ t: 'input', botId, ev })

  useEffect(() => {
    let n = 0
    const draw = (f: Frame) => {
      const my = ++n
      lastAt.current = Date.now()
      onUrl(f.url)
      setHas(true)
      onLive(true)
      const img = new Image()
      img.onload = () => {
        const c = cv.current
        if (!c || my !== n) return // descarta quadro velho
        if (c.width !== f.w || c.height !== f.h) { c.width = f.w; c.height = f.h }
        const g = c.getContext('2d')!
        g.drawImage(img, 0, 0, f.w, f.h)
        if (f.focus) { // retângulo do elemento em foco
          const { x, y, w, h } = f.focus
          g.lineWidth = 5; g.strokeStyle = '#000000'; g.strokeRect(x - 2, y - 2, w + 4, h + 4)
          g.lineWidth = 2.5; g.strokeStyle = '#60a5fa'; g.strokeRect(x - 2, y - 2, w + 4, h + 4)
        }
      }
      img.src = 'data:image/jpeg;base64,' + f.data
    }
    setHas(false); onUrl('')
    if (cv.current) { cv.current.width = 1280; cv.current.height = 800 } // limpa o quadro do bot anterior
    const last = lastFrame(botId)
    if (last) draw(last)
    const off = onFrame((f) => f.botId === botId && draw(f))
    const iv = setInterval(() => onLive(Date.now() - lastAt.current < 4000), 1000)
    return () => { off(); clearInterval(iv); onLive(false) }
  }, [botId, onLive, onUrl])

  // converte posição do mouse (canvas com object-fit: contain) em pixels da página
  // zoom com pinça (celular): dois dedos ampliam no ponto, um dedo arrasta quando ampliado, toque duplo alterna 1x/2,5x
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 })
  const area = useRef<HTMLDivElement>(null)
  const ptrs = useRef(new Map<number, { x: number; y: number }>())
  const gest = useRef<{ d: number; s: number; px: number; py: number; x: number; y: number; ox: number; oy: number } | null>(null)
  const moved = useRef(false)
  const lastTap = useRef(0)
  useEffect(() => { setZ({ s: 1, x: 0, y: 0 }) }, [botId, full])
  const fit = (n: { s: number; x: number; y: number }) => {
    const el = area.current; if (!el) return n
    const w = el.clientWidth, h = el.clientHeight, sc = Math.min(Math.max(n.s, 1), 5)
    if (sc < 1.04) return { s: 1, x: 0, y: 0 }
    return { s: sc, x: Math.min(0, Math.max(w - w * sc, n.x)), y: Math.min(0, Math.max(h - h * sc, n.y)) }
  }
  const local = (e: { clientX: number; clientY: number }) => { const r = area.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const zoomAt = (px: number, py: number, ns: number) => setZ((o) => fit({ s: ns, x: px - ((px - o.x) / o.s) * ns, y: py - ((py - o.y) / o.s) * ns }))
  const touch = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return
      ptrs.current.set(e.pointerId, local(e)); moved.current = false
      const ps = [...ptrs.current.values()]
      if (ps.length === 2) { const [a, b] = ps; gest.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: z.s, px: (a.x + b.x) / 2, py: (a.y + b.y) / 2, x: z.x, y: z.y, ox: 0, oy: 0 } }
      else if (ps.length === 1) gest.current = { d: 0, s: z.s, px: ps[0].x, py: ps[0].y, x: z.x, y: z.y, ox: ps[0].x, oy: ps[0].y }
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch' || !ptrs.current.has(e.pointerId) || !gest.current) return
      ptrs.current.set(e.pointerId, local(e))
      const ps = [...ptrs.current.values()], g = gest.current
      if (ps.length >= 2 && g.d) {
        const [a, b] = ps, ns = g.s * (Math.hypot(a.x - b.x, a.y - b.y) / g.d), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        moved.current = true
        setZ(fit({ s: ns, x: mx - ((g.px - g.x) / g.s) * ns, y: my - ((g.py - g.y) / g.s) * ns }))
      } else if (ps.length === 1 && g.s > 1 && !control) {
        const dx = ps[0].x - g.ox, dy = ps[0].y - g.oy
        if (Math.abs(dx) + Math.abs(dy) > 6) moved.current = true
        setZ(fit({ s: g.s, x: g.x + dx, y: g.y + dy }))
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return
      ptrs.current.delete(e.pointerId)
      if (ptrs.current.size === 1) { const p0 = [...ptrs.current.values()][0]; gest.current = { d: 0, s: z.s, px: p0.x, py: p0.y, x: z.x, y: z.y, ox: p0.x, oy: p0.y } }
      if (ptrs.current.size) return
      gest.current = null
      if (!moved.current && !control) { // toque duplo: amplia ali / volta ao normal
        const now = Date.now(), p0 = local(e)
        if (now - lastTap.current < 320) { lastTap.current = 0; if (z.s > 1) setZ({ s: 1, x: 0, y: 0 }); else zoomAt(p0.x, p0.y, 2.5) }
        else lastTap.current = now
      }
    },
    onPointerCancel: (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); if (!ptrs.current.size) gest.current = null },
    onClickCapture: (e: React.MouseEvent) => { if (moved.current) { e.stopPropagation(); moved.current = false } }, // arrastar/pinçar não vira clique no site
  }

  const pt = (e: { clientX: number; clientY: number }) => {
    const c = cv.current!
    const r = c.getBoundingClientRect()
    const k = Math.min(r.width / c.width, r.height / c.height)
    return { x: Math.round((e.clientX - r.left - (r.width - c.width * k) / 2) / k), y: Math.round((e.clientY - r.top - (r.height - c.height * k) / 2) / k) }
  }

  useEffect(() => {
    const c = cv.current
    if (!c || !control) return
    const wheel = (e: WheelEvent) => { e.preventDefault(); wsInput({ t: 'input', botId, ev: { type: 'wheel', ...pt(e), dy: e.deltaY } }) }
    c.addEventListener('wheel', wheel, { passive: false })
    return () => c.removeEventListener('wheel', wheel)
  }, [control, botId])

  // tela cheia: API nativa quando existe (PC/Android); no iPhone fica só o modo fixo por CSS
  const toggleFull = () => {
    if (full) { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); setFull(false); return }
    setFull(true)
    box.current?.requestFullscreen?.().catch(() => {})
  }
  useEffect(() => {
    if (!full) return
    const fs = () => { if (!document.fullscreenElement) setFull(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !control) setFull(false) }
    document.addEventListener('fullscreenchange', fs); addEventListener('keydown', esc)
    return () => { document.removeEventListener('fullscreenchange', fs); removeEventListener('keydown', esc) }
  }, [full, control])
  useEffect(() => () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) }, [])

  const scroll = (dy: number) => { const c = cv.current!; input({ type: 'wheel', x: c.width / 2, y: c.height / 2, dy }) }
  const go = (e: React.FormEvent) => {
    e.preventDefault()
    const u = (draft ?? '').trim()
    if (u) wsInput({ t: 'nav', botId, url: /^[a-z]+:\/\//i.test(u) ? u : 'https://' + u })
    setDraft(null)
    ;(document.activeElement as HTMLElement)?.blur()
  }

  return (
    <div ref={box} className={cn('flex flex-col gap-2', full ? 'fixed inset-0 z-[70] bg-black px-2 pb-[max(0.5rem,var(--sab))] pt-[max(0.5rem,var(--sat))]' : 'shrink-0')}>
      <div className={cn('flex flex-col overflow-hidden rounded-[22px] border bg-surface', full && 'min-h-0 flex-1', 'transition-[border-color,box-shadow] duration-300', control ? 'border-brand/60 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]' : 'border-white/[0.08]')}>
        <form onSubmit={go} className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3">
          <span className="flex gap-1.5" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-white/[0.12]" />)}</span>
          <label className="ml-1.5 flex h-[26px] min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-background px-2.5 text-xs text-t1 transition-colors focus-within:bg-[#050506]">
            <Lock size={11} className="shrink-0 text-t3" />
            <input aria-label="Endereço" spellCheck={false} placeholder="Digite um endereço" className="min-w-0 flex-1 bg-transparent"
              value={draft ?? url} onFocus={(e) => { setDraft(url); e.target.select() }} onBlur={() => setDraft(null)} onChange={(e) => setDraft(e.target.value)} />
          </label>
          {full && (
            <button type="button" aria-pressed={control} onClick={() => onControl(!control)}
              className={cn('h-[26px] shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-semibold', control ? 'border border-white/20 hover:bg-white/[0.06]' : 'bg-grad hover:brightness-110')}>
              {control ? 'Devolver' : 'Assumir'}
            </button>
          )}
          <Tip label={full ? 'Sair da tela cheia' : 'Tela cheia'} side="bottom">
            <button type="button" aria-label={full ? 'Sair da tela cheia' : 'Ver navegador em tela cheia'} onClick={toggleFull}
              className={cn(iconBtn, 'size-8 shrink-0', !has && !full && 'hidden')}>
              {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </Tip>
        </form>
        <div ref={area} {...touch} style={{ touchAction: 'none' }} className={cn('relative w-full overflow-hidden bg-[#050506]', full ? 'min-h-0 flex-1' : 'aspect-[16/10] max-h-[52dvh]')}>
          <canvas ref={cv} width={1280} height={800} tabIndex={control ? 0 : -1} aria-label="Tela do navegador do bot"
            style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})`, transformOrigin: '0 0' }}
            className={cn('size-full object-contain outline-none transition-opacity duration-300', control && 'cursor-pointer', has ? 'opacity-100' : 'opacity-0')}
            onClick={(e) => { if (!control) return; input({ type: 'click', ...pt(e) }); if (touchDev) kb.current?.focus(); else e.currentTarget.focus() }} // celular: tocar no site já abre o teclado
            onPaste={(e) => { if (control) { e.preventDefault(); input({ type: 'text', text: e.clipboardData.getData('text') }) } }}
            onKeyDown={(e) => {
              if (!control || e.ctrlKey || e.metaKey) return
              e.preventDefault()
              input(e.key.length === 1 ? { type: 'text', text: e.key } : { type: 'key', key: e.key })
            }} />
          {!has && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <span className="glass-btn inline-flex size-12 items-center justify-center rounded-full text-t2"><Globe size={20} strokeWidth={1.5} /></span>
              <span className="max-w-[260px] text-[13px] text-t3">O navegador aparece aqui quando o {name} abrir uma página.</span>
            </div>
          )}
          {z.s > 1 && (
            <button type="button" onClick={() => setZ({ s: 1, x: 0, y: 0 })} aria-label="Voltar ao tamanho normal"
              className="fade absolute bottom-2 right-2 z-10 inline-flex h-8 items-center rounded-full bg-black/75 px-3 text-[12px] font-semibold tabular-nums text-foreground">{z.s.toFixed(1).replace('.', ',')}x · 1x</button>
          )}
          {control && <span className="fade pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-foreground"><MousePointer2 size={11} />Você está no controle</span>}
        </div>
      </div>
      {control && (
        <form className="fade flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); input({ type: 'key', key: 'Enter' }); setTyped('') }}>
          {/* digita ao vivo: letra nova vai na hora, apagar manda Backspace; Enter confirma no site */}
          <input ref={kb} className={cn(field, '!rounded-full !py-1.5 text-[16px] md:text-[13px]')} placeholder="Toque no campo do site e digite" value={typed}
            autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
            onChange={(e) => {
              const v = e.target.value
              if (v.startsWith(typed)) { const add = v.slice(typed.length); if (add) input({ type: 'text', text: add }) }
              else { let i = 0; while (i < v.length && v[i] === typed[i]) i++; for (let k = 0; k < typed.length - i; k++) input({ type: 'key', key: 'Backspace' }); if (v.slice(i)) input({ type: 'text', text: v.slice(i) }) }
              setTyped(v)
            }}
            onKeyDown={(e) => { if (e.key === 'Backspace' && !typed) input({ type: 'key', key: 'Backspace' }); if (e.key === 'Tab') { e.preventDefault(); input({ type: 'key', key: 'Tab' }); setTyped('') } }} />
          <button type="button" aria-label="Rolar para cima" className={iconBtn} onClick={() => scroll(-400)}><ChevronUp size={18} /></button>
          <button type="button" aria-label="Rolar para baixo" className={iconBtn} onClick={() => scroll(400)}><ChevronDown size={18} /></button>
        </form>
      )}
    </div>
  )
}

const KIND: Record<string, string> = { nav: 'text-foreground', tool: 'text-t1', info: 'text-t3', error: 'text-bad' }

function Activity({ botId }: { botId: string }) {
  const items = useStore((s) => s.activity[botId])
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => { const e = box.current; if (e && stick.current) e.scrollTop = e.scrollHeight }, [items?.length, botId])
  return (
    <div ref={box} onScroll={(e) => { const t = e.currentTarget; stick.current = t.scrollHeight - t.scrollTop - t.clientHeight < 40 }}
      className="flex h-full flex-col gap-1 overflow-y-auto rounded-[18px] border border-white/[0.06] bg-surface px-3.5 py-3 font-mono text-xs leading-relaxed text-t2">
      {!items?.length && <span className="m-auto font-sans text-[13px] text-t3">Sem atividade ainda.</span>}
      {items?.map((a, i) => (
        <span key={i} className={cn('rise break-words', KIND[a.kind])}><span className="mr-2.5 text-t3">{hhmmss(a.ts)}</span>{a.text}</span>
      ))}
    </div>
  )
}

function Files({ botId }: { botId: string }) {
  const [files, setFiles] = useState<{ name: string; size: number; mtime: number | string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => { setBusy(true); act(api<typeof files>(`/api/bots/${botId}/files`)).then((f) => { setFiles(f ?? []); setBusy(false) }) }
  useEffect(() => { setFiles(null); load() }, [botId])
  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto rounded-[18px] border border-white/[0.06] bg-surface p-1.5">
      <div className="flex items-center justify-between py-0.5 pl-2.5 text-xs text-t3">
        {files ? `${files.length} arquivo${files.length === 1 ? '' : 's'}` : 'Arquivos do bot'}
        <Tip label="Atualizar"><button type="button" aria-label="Atualizar arquivos" className={cn(iconBtn, 'size-8')} onClick={load}><RefreshCw size={14} className={cn(busy && 'animate-spin')} /></button></Tip>
      </div>
      {!files && [0, 1, 2].map((i) => <Skel key={i} className="mx-1 h-9" />)}
      {files && !files.length && <p className="m-auto py-6 text-[13px] text-t3">Nenhum arquivo ainda.</p>}
      {files?.map((f) => (
        <button key={f.name} type="button" onClick={() => download(`/api/bots/${botId}/files/${encodeURIComponent(f.name)}`, f.name)}
          className="group flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05]">
          <FileText size={16} strokeWidth={1.6} className="shrink-0 text-t3" />
          <span className="min-w-0 flex-1 truncate text-[13px]">{f.name}</span>
          <span className="shrink-0 text-xs text-t3">{size(f.size)} · {new Date(f.mtime).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}</span>
          <Download size={14} className="shrink-0 text-t3 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ))}
    </div>
  )
}
