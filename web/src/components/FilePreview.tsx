// Arquivos no corpo da conversa: cartão com miniatura (imagem, PDF, DOCX, texto), Expandir e Baixar.
// PDF (pdf.js) e DOCX (docx-preview) só carregam quando aparece um arquivo desses.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileText, Loader2, Maximize2, Trash2, X } from 'lucide-react'
import { act, api, confirmAsk, download, set, toast, useStore } from '@/store'
import { cn, size } from '@/lib/utils'

export type FileRef = { url: string; name: string; size?: number; mime?: string }
type Kind = 'image' | 'pdf' | 'docx' | 'office' | 'html' | 'text' | 'other'

const TEXT = ['txt', 'md', 'csv', 'json', 'log', 'xml', 'html', 'htm', 'yml', 'yaml', 'ts', 'tsx', 'js', 'py', 'sql', 'css']
const ext = (n: string) => (n.split('.').pop() ?? '').toLowerCase()
export function kindOf(f: FileRef): Kind {
  const e = ext(f.name), m = f.mime ?? ''
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(e)) return 'image'
  if (m === 'application/pdf' || e === 'pdf') return 'pdf'
  if (e === 'docx') return 'docx'
  if (['pptx', 'ppt', 'xlsx', 'xls'].includes(e)) return 'office' // vira PDF pelo Office do PC
  if (e === 'html' || e === 'htm' || m === 'text/html') return 'html' // mockup/protótipo/animação: roda isolado
  if (m.startsWith('text/') || TEXT.includes(e)) return 'text'
  return 'other'
}

// bytes baixados uma vez por arquivo (miniatura e tela cheia usam o mesmo)
const cache = new Map<string, Promise<ArrayBuffer>>()
const bytes = (url: string) => {
  let p = cache.get(url)
  if (!p) { p = fetch(url, { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer() }); p.catch(() => cache.delete(url)); cache.set(url, p) }
  return p
}

async function pdfDoc(url: string) {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  return pdfjs.getDocument({ data: new Uint8Array((await bytes(url)).slice(0)) }).promise
}
async function pdfPages(url: string, box: HTMLElement, width: number, max = Infinity) {
  const doc = await pdfDoc(url)
  const dpr = Math.min(devicePixelRatio || 1, 2)
  for (let i = 1; i <= Math.min(doc.numPages, max); i++) {
    const page = await doc.getPage(i)
    const v = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * dpr })
    const c = document.createElement('canvas')
    c.width = v.width; c.height = v.height
    c.style.width = width + 'px'; c.className = 'block bg-white'
    box.appendChild(c)
    await page.render({ canvas: c, viewport: v }).promise
  }
  return doc.numPages
}
async function docx(url: string, box: HTMLElement) {
  const { renderAsync } = await import('docx-preview')
  await renderAsync(await bytes(url), box, undefined, { inWrapper: false, ignoreLastRenderedPageBreak: true, breakPages: true })
}
// pptx/xlsx: o servidor converte pelo Office do PC e devolve PDF
const officePdf = (url: string) => '/api/office-pdf?url=' + encodeURIComponent(url)
// HTML do bot roda num iframe isolado (sem acesso ao app, cookies ou login)
const Html = ({ html, title, thumb }: { html: string; title: string; thumb?: boolean }) => (
  <iframe title={title} srcDoc={html} sandbox="allow-scripts allow-forms allow-modals allow-popups" loading="lazy"
    className={cn('border-0 bg-white', thumb ? 'pointer-events-none absolute left-0 top-0 h-[704px] w-[1280px] origin-top-left scale-[0.1875]' : 'size-full')} />
)
async function textOf(url: string, max?: number) {
  const t = new TextDecoder().decode(await bytes(url))
  return max && t.length > max ? t.slice(0, max) + '…' : t
}

// miniatura: só monta quando o cartão aparece na tela
function Thumb({ f, k }: { f: FileRef; k: Kind }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'wait' | 'ok' | 'err'>(k === 'image' ? 'ok' : 'wait')
  const [txt, setTxt] = useState('')
  useEffect(() => {
    const el = box.current
    if (!el || k === 'image' || k === 'other') return
    let dead = false
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const done = () => !dead && setState('ok'), fail = () => !dead && setState('err')
      if (k === 'pdf' || k === 'office') pdfPages(k === 'office' ? officePdf(f.url) : f.url, el, 240, 1).then(done, fail)
      else if (k === 'docx') docx(f.url, el).then(done, fail)
      else textOf(f.url, k === 'html' ? undefined : 1200).then((t) => { if (!dead) { setTxt(t); done() } }, fail)
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => { dead = true; io.disconnect() }
  }, [f.url, k])

  if (k === 'image') return <img src={f.url} alt={f.name} loading="lazy" className="size-full object-cover" />
  if (k === 'other' || state === 'err')
    return <span className="flex size-full flex-col items-center justify-center gap-1.5 text-t3"><FileText size={28} strokeWidth={1.4} /><span className="text-[11px] font-semibold uppercase tracking-wider">{ext(f.name) || 'arquivo'}</span></span>
  return (
    <>
      {k === 'html' && txt && <Html html={txt} title={f.name} thumb />}
      {k === 'html' ? <div ref={box} />
        : k === 'text'
        ? <pre className="m-0 size-full overflow-hidden whitespace-pre-wrap break-words bg-[#0b0b0d] p-2.5 font-mono text-[9.5px] leading-snug text-t2">{txt}</pre>
        // docx: página em tamanho real reduzida para caber no cartão
        : <div ref={box} aria-hidden="true" className={cn('pointer-events-none origin-top-left bg-white', k === 'docx' && 'w-[800px] scale-[0.3] [&_section.docx]:!m-0 [&_section.docx]:!shadow-none')} />}
      {k === 'text' && <div ref={box} />}
      {state === 'wait' && <span className="absolute inset-0 flex items-center justify-center bg-surface text-t3"><Loader2 size={18} className="animate-spin" /></span>}
    </>
  )
}

// apagar de vez (painel de arquivos da conversa): o cartão na mensagem fica marcado como apagado
export async function deleteFile(f: FileRef) {
  if (!(await confirmAsk({ title: `Apagar “${f.name}”?`, body: 'O arquivo some do disco. A mensagem continua, marcada como arquivo apagado.', ok: 'Apagar', danger: true }))) return
  if ((await act(api('/api/files/delete', 'POST', { url: f.url }))) === undefined) return
  cache.delete(f.url)
  set((s) => ({ gone: { ...s.gone, [f.url]: true } }))
  toast('Arquivo apagado')
}
// confere no servidor quais arquivos ainda existem (ex.: apagados em outro aparelho)
export function checkFiles(urls: string[]) {
  const todo = urls.filter((u) => u.startsWith('/api/'))
  if (todo.length) api<Record<string, boolean>>('/api/files/exists', 'POST', { urls: todo }).then((r) => {
    const g = Object.fromEntries(Object.entries(r).filter(([, ok]) => !ok).map(([u]) => [u, true as const]))
    if (Object.keys(g).length) set((s) => ({ gone: { ...s.gone, ...g } }))
  }).catch(() => {})
}

export function FileCard({ f, onDelete }: { f: FileRef; onDelete?: boolean }) {
  const k = kindOf(f)
  const gone = useStore((s) => !!s.gone[f.url])
  const open = () => set({ preview: f })
  if (gone) return (
    <div className="flex w-[240px] max-w-full items-center gap-2.5 rounded-[18px] border border-dashed border-white/[0.1] px-3 py-2.5 text-[12.5px] text-t3">
      <Trash2 size={14} className="shrink-0" /><span className="min-w-0 truncate line-through">{f.name}</span><span className="ml-auto shrink-0">apagado</span>
    </div>
  )
  return (
    <div className="group/file flex w-[240px] max-w-full flex-col overflow-hidden rounded-[18px] border border-white/[0.08] bg-white/[0.04]">
      <button type="button" aria-label={`Expandir ${f.name}`} onClick={open}
        className="relative h-[132px] w-full overflow-hidden bg-surface text-left">
        <Thumb f={f} k={k} />
        <span className="absolute inset-0 bg-black/0 transition-colors group-hover/file:bg-black/20" />
      </button>
      <div className="flex items-center gap-1 py-1 pl-3 pr-1">
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          {/* extensão sempre visível: "contrato….pdf" e "contrato….docx" não ficam iguais */}
          <span className="flex min-w-0 text-[12.5px] font-medium" title={f.name}><span className="truncate">{f.name.replace(/\.[^.]+$/, '')}</span><span className="shrink-0">{/\.[^.]+$/.exec(f.name)?.[0]}</span></span>
          {f.size != null && <span className="text-[11px] text-t3">{size(f.size)}</span>}
        </span>
        <button type="button" aria-label={`Expandir ${f.name}`} title="Expandir" onClick={open}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-t2 hover:bg-white/[0.07] hover:text-foreground"><Maximize2 size={14} /></button>
        <button type="button" aria-label={`Baixar ${f.name}`} title="Baixar" onClick={() => download(f.url, f.name)}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-t2 hover:bg-white/[0.07] hover:text-foreground"><Download size={14} /></button>
        {onDelete && <button type="button" aria-label={`Apagar ${f.name}`} title="Apagar" onClick={() => deleteFile(f)}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-t2 hover:bg-live/15 hover:text-bad"><Trash2 size={14} /></button>}
      </div>
    </div>
  )
}

export function FileGrid({ files, end, onDelete }: { files: FileRef[]; end?: boolean; onDelete?: boolean }) {
  if (!files.length) return null
  return <div className={cn('flex flex-wrap gap-2', end && 'justify-end')}>{files.map((f) => <FileCard key={f.url} f={f} onDelete={onDelete} />)}</div>
}

// tela cheia: rola o documento inteiro; Esc, X ou voltar fecham
export function FileViewer() {
  const f = useStore((s) => s.preview)
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'wait' | 'ok' | 'err'>('wait')
  const [txt, setTxt] = useState('')
  const k = f ? kindOf(f) : 'other'
  const close = () => set({ preview: null })
  useEffect(() => {
    if (!f) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    addEventListener('keydown', esc, true)
    return () => removeEventListener('keydown', esc, true)
  }, [f])
  useEffect(() => {
    const el = box.current
    if (!f || !el) return
    let dead = false
    el.replaceChildren(); setTxt('')
    setState(k === 'image' || k === 'other' ? 'ok' : 'wait')
    const done = () => !dead && setState('ok'), fail = () => !dead && setState('err')
    if (k === 'pdf' || k === 'office') pdfPages(k === 'office' ? officePdf(f.url) : f.url, el, Math.min(el.clientWidth || 900, 900)).then(done, fail)
    else if (k === 'docx') docx(f.url, el).then(done, fail)
    else if (k === 'text' || k === 'html') textOf(f.url).then((t) => { if (!dead) { setTxt(t); done() } }, fail)
    return () => { dead = true }
  }, [f?.url, k])
  if (!f) return null
  // portal no body: fica acima de tudo (sidebar, cabeçalho, painéis com transform)
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={f.name} className="fade fixed inset-0 z-[80] flex flex-col bg-black/95 pb-[var(--sab)] pt-[var(--sat)] backdrop-blur-sm">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3 md:px-5">
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{f.name}</span>
        <button type="button" onClick={() => download(f.url, f.name)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-grad px-4 text-[13px] font-semibold hover:brightness-110"><Download size={15} />Baixar</button>
        <button type="button" aria-label="Fechar" onClick={close} className="inline-flex size-10 items-center justify-center rounded-full text-t2 hover:bg-white/[0.08] hover:text-foreground"><X size={19} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4 md:px-6" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
        {k === 'image' && <img src={f.url} alt={f.name} className="mx-auto max-h-full max-w-full object-contain" />}
        {k === 'html' && txt && <div className="mx-auto h-full max-w-[1280px] overflow-hidden rounded-2xl"><Html html={txt} title={f.name} /></div>}
        {k === 'text' && <pre className="mx-auto m-0 max-w-[900px] whitespace-pre-wrap break-words rounded-2xl bg-[#0b0b0d] p-4 font-mono text-[13px] leading-relaxed text-t1">{txt}</pre>}
        <div ref={box} className={cn('mx-auto flex max-w-[900px] flex-col items-center gap-3', k === 'docx' && 'overflow-x-auto bg-white text-black [&_section.docx]:!mx-auto', (k === 'image' || k === 'text' || k === 'html' || k === 'other') && 'hidden')} />
        {state === 'wait' && <div className="flex justify-center py-16 text-t3"><Loader2 size={22} className="animate-spin" /></div>}
        {(k === 'other' || state === 'err') && (
          <div className="flex flex-col items-center gap-3 py-20 text-center text-t2">
            <FileText size={40} strokeWidth={1.3} className="text-t3" />
            <span className="text-[14px]">{state === 'err' ? 'Não deu para mostrar este arquivo aqui.' : 'Sem pré-visualização para este tipo de arquivo.'}</span>
            <button type="button" onClick={() => download(f.url, f.name)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-grad px-5 text-[13.5px] font-semibold"><Download size={15} />Baixar</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
