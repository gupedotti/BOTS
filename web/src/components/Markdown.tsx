import { Children, createContext, isValidElement, memo, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowDown, ArrowUp, Calendar, Check, CircleCheck, Download, Search, CircleDollarSign, CircleDot, CircleX, Clock, Copy, Cpu, FileText, Flag, GitBranch, Hash, Link2,
  Mail, MapPin, Minus, Percent, Phone, Star, StickyNote, Table2, Tag, TriangleAlert, User, type LucideIcon,
} from 'lucide-react'
import { cn, copy } from '@/lib/utils'
import { CALLOUT, CALLOUT_ALIAS, Callout, LinkCard, RICH, RichBlock, TaskBox, TaskProgress } from '@/components/RichBlocks'

export function CopyBtn({ text, label = 'Copiar', className, showLabel }: { text: string; label?: string; className?: string; showLabel?: boolean }) {
  const [ok, setOk] = useState(false)
  return (
    <button type="button" aria-label={ok ? 'Copiado' : label} title={ok ? 'Copiado' : label}
      className={cn('inline-flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-xs text-t3 transition-colors hover:bg-white/[0.06] hover:text-foreground', className)}
      onClick={async () => { if (await copy(text)) { setOk(true); setTimeout(() => setOk(false), 1400) } }}>
      {ok ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
      {showLabel && (ok ? 'Copiado' : label)}
    </button>
  )
}

function Code({ lang, text }: { lang?: string; text: string }) {
  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-white/[0.07] bg-surface">
      <div className="flex h-9 items-center justify-between border-b border-white/[0.05] pl-4 pr-1.5 text-xs text-t3">
        <span className="font-mono">{lang || 'código'}</span>
        <CopyBtn text={text} showLabel />
      </div>
      <pre><code>{text}</code></pre>
    </div>
  )
}

// arquivo de bot: caminho local (C:\…\data\bots\<id>\…) vira link de download do próprio app (funciona no celular)
const BOT_FILE = /^(?:file:\/+)?(?:[a-z]:)?[\\/].*?[\\/]data[\\/]bots[\\/]([\w-]+)[\\/](.+)$/i
const isBotFile = (h?: string) => !!h && /^\/api\/bots\/[\w-]+\/files\//.test(h)
// arquivos de bot citados em links da resposta (não imagens ![]()) → cartões de preview abaixo do texto
export function botFiles(md: string) {
  const out = new Map<string, { url: string; name: string }>()
  for (const [, bang, a, b] of md.matchAll(/(!?)\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+))[^)]*\)/g)) {
    if (bang) continue
    const u = urlTransform(a ?? b)
    if (!isBotFile(u)) continue
    let name = u.split('/').pop()!; try { name = decodeURIComponent(name) } catch { /* mantém */ }
    out.set(u, { url: u, name })
  }
  return [...out.values()]
}
function urlTransform(u: string) {
  let s = u; try { s = decodeURI(u) } catch { /* mantém */ }
  const m = BOT_FILE.exec(s)
  return m ? `/api/bots/${m[1]}/files/${m[2].split(/[\\/]/).map(encodeURIComponent).join('/')}` : defaultUrlTransform(u)
}

const components: Components = {
  a: ({ href, children }) => isBotFile(href)
    ? <a href={href} download={decodeURIComponent(href!.split('/').pop()!)}>{children}</a>
    : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  pre: ({ children }) => {
    const c = (children as ReactElement<{ className?: string; children?: unknown }>)?.props
    const lang = /language-([\p{L}\w+#-]+)/u.exec(c?.className ?? '')?.[1]
    const t = String(c?.children ?? '').replace(/\n$/, '')
    return lang && RICH.has(lang.toLowerCase()) ? <RichBlock lang={lang.toLowerCase()} text={t} /> : <Code lang={lang} text={t} />
  },
  table: ({ node, children }) => <SortTable node={node as unknown as H}>{children}</SortTable>,
  th: ({ node, children, style }) => {
    const Icon = HEAD_ICONS[String(node?.properties?.dataIcon ?? '')]
    const col = Number(node?.properties?.dataCol ?? -1)
    const t = useContext(TableCtx)
    const on = t.sort?.col === col
    return <th style={style} className={cn(node?.properties?.dataNum ? 'num' : undefined, t.can && 'cursor-pointer select-none hover:text-foreground')} aria-sort={on ? (t.sort!.asc ? 'ascending' : 'descending') : undefined}
      onClick={t.can ? () => t.setSort(on ? (t.sort!.asc ? { col, asc: false } : null) : { col, asc: true }) : undefined}>
      <span className="inline-flex items-center gap-1.5">{Icon && <Icon size={13} className="shrink-0 text-t3" />}{children}{on && (t.sort!.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
    </th>
  },
  blockquote: ({ node, children }) => {
    const k = String(node?.properties?.dataCallout ?? '')
    return k ? <Callout kind={k}>{children}</Callout> : <blockquote>{children}</blockquote>
  },
  p: ({ node, children }) => {
    const href = node?.properties?.dataLinkCard
    return href ? <LinkCard href={String(href)}>{children}</LinkCard> : <p>{children}</p>
  },
  input: ({ node, checked, type }) => type === 'checkbox' ? <TaskBox k={String(node?.properties?.dataKey ?? '')} checked={!!checked} /> : null,
  ul: ({ node, children, className }) => {
    const keys = node?.properties?.dataKeys ? String(node.properties.dataKeys).split(',') : null
    if (!keys) return <ul className={className}>{children}</ul>
    const init = String(node!.properties!.dataInit ?? '').split(',').map((x) => x === '1')
    return <div className="my-2"><TaskProgress keys={keys} initial={init} /><ul className={cn(className, 'task-list')}>{children}</ul></div>
  },
  td: ({ node, children, style }) => {
    const st = String(node?.properties?.dataStatus ?? '')
    const S = STATUS[st]
    return <td style={style} className={cn(node?.properties?.dataNum ? 'num' : undefined)}>
      {S ? <span className={cn('inline-flex items-center gap-1.5', S.cls)}><S.Icon size={15} className="shrink-0" />{children}</span> : children}
    </td>
  },
}

// ---------- tabela: ordenar pelo cabeçalho, filtrar (6+ linhas), copiar e baixar CSV ----------
type Sort = { col: number; asc: boolean } | null
const TableCtx = createContext<{ can?: boolean; sort?: Sort; setSort: (s: Sort) => void }>({ setSort: () => {} })
const numOf = (s: string) => { const m = /[+\-−]?\d[\d.]*(,\d+)?/.exec(s.replace(/\s/g, '')); return m ? Number(m[0].replace('−', '-').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) : NaN }
function SortTable({ node, children }: { node?: H; children: ReactNode }) {
  const [sort, setSort] = useState<Sort>(null)
  const [q, setQ] = useState('')
  const rows = useMemo(() => (node ? all(node, 'tr') : []).map((r) => (r.children ?? []).filter(isCell).map((c) => text(c).trim().replace(/\s+/g, ' '))), [node])
  const body = rows.slice(1)
  const tsv = rows.map((r) => r.join('\t')).join('\n')
  const csv = rows.map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n')
  const els = Children.toArray(children).filter(isValidElement) as ReactElement<{ children?: ReactNode }>[]
  const head = els[0], tb = els[1]
  const trs = tb ? (Children.toArray(tb.props.children).filter(isValidElement) as ReactElement[]) : []
  const ok = trs.length === body.length && body.length > 0
  let order = body.map((_, i) => i)
  const t = q.trim().toLowerCase()
  if (ok && t) order = order.filter((i) => body[i].join(' ').toLowerCase().includes(t))
  if (ok && sort) {
    const v = order.map((i) => body[i][sort.col] ?? '')
    const num = v.filter(Boolean).every((x) => !Number.isNaN(numOf(x)))
    order = order.map((i, j) => [i, v[j]] as const).sort(([, a], [, b]) => (num ? (numOf(a) || 0) - (numOf(b) || 0) : a.localeCompare(b, 'pt-BR', { numeric: true }))).map(([i]) => i)
    if (!sort.asc) order.reverse()
  }
  const n = body.length
  const dl = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })); a.download = 'tabela.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000) }
  return (
    <TableCtx.Provider value={{ can: ok && n > 1, sort, setSort }}>
      <div className="md-table my-3 overflow-hidden rounded-2xl border border-white/[0.07] bg-surface">
        <div className="flex h-10 items-center gap-1 border-b border-white/[0.05] pl-4 pr-1.5 text-xs text-t3">
          <span className="inline-flex shrink-0 items-center gap-1.5"><Table2 size={13} />{t ? `${order.length} de ${n}` : `${n} ${n === 1 ? 'linha' : 'linhas'}`}</span>
          {ok && n > 5 && (
            <label className="mx-2 flex h-7 min-w-0 max-w-[220px] flex-1 items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#0a0a0b] px-2.5">
              <Search size={12} className="shrink-0" /><input aria-label="Filtrar tabela" placeholder="Filtrar…" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none" />
            </label>
          )}
          <span className="flex-1" />
          <button type="button" title="Baixar CSV" aria-label="Baixar CSV" onClick={dl} className="inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-xs text-t3 transition-colors hover:bg-white/[0.06] hover:text-foreground"><Download size={14} />CSV</button>
          <CopyBtn text={tsv} label="Copiar p/ planilha" />
        </div>
        <div className="max-h-[520px] overflow-auto"><table>{head}{ok ? <tbody>{order.map((i) => trs[i])}</tbody> : tb}</table></div>
      </div>
    </TableCtx.Provider>
  )
}

// ---------- tabelas: ícones de status/cabeçalho e colunas numéricas (rehype, sem dependência) ----------
type H = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: H[] }
const isCell = (n: H) => n.tagName === 'td' || n.tagName === 'th'
const text = (n: H): string => n.type === 'text' ? n.value ?? '' : (n.children ?? []).map(text).join('')
const all = (n: H, tag: string, out: H[] = []): H[] => { if (n.tagName === tag) out.push(n); for (const c of n.children ?? []) all(c, tag, out); return out }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const STATUS: Record<string, { Icon: LucideIcon; cls: string }> = {
  ok: { Icon: CircleCheck, cls: 'text-ok' },
  no: { Icon: CircleX, cls: 'text-live' },
  warn: { Icon: TriangleAlert, cls: 'text-warn' },
  wait: { Icon: Clock, cls: 'text-warn' },
  skip: { Icon: Minus, cls: 'text-t3' },
}
const EMOJI: [RegExp, string][] = [
  [/^(✅|✔️?|✓|☑️?|🟢)\s*/u, 'ok'], [/^(❌|✖️?|✗|✘|🔴|⛔|🚫)\s*/u, 'no'],
  [/^(⚠️?|🟡|🟠)\s*/u, 'warn'], [/^(⏳|⌛|🕐|🔄)\s*/u, 'wait'],
]
const WORDS: Record<string, string> = Object.fromEntries([
  ...'sim yes ok true pronto feito concluido concluida ativo ativa online disponivel sucesso aprovado aprovada funciona passou'.split(' ').map((w) => [w, 'ok']),
  ...'nao no false erro falhou falha inativo inativa offline indisponivel reprovado reprovada bloqueado quebrado'.split(' ').map((w) => [w, 'no']),
  ...'parcial atencao talvez depende instavel'.split(' ').map((w) => [w, 'warn']),
  ...'pendente aguardando andamento rodando'.split(' ').concat(['em andamento', 'em progresso', 'a fazer']).map((w) => [w, 'wait']),
  ...['-', '—', '–', 'n/a', 'na'].map((w) => [w, 'skip']),
])
const HEADS: [RegExp, string][] = [
  [/\b(status|estado|situacao|ok)\b/, 'status'], [/\b(preco|valor|custo|total|receita|faturamento|orcamento|price|cost)\b|r\$|us\$/, 'money'],
  [/\b(data|prazo|quando|dia|vencimento|date|deadline)\b/, 'date'], [/\b(hora|horario|tempo|duracao|time|latencia)\b/, 'time'],
  [/\b(e-?mail)\b/, 'mail'], [/\b(telefone|celular|whatsapp|fone)\b/, 'phone'], [/\b(link|url|site|fonte|source)\b/, 'link'],
  [/\b(nome|usuario|cliente|pessoa|contato|responsavel|autor|dono|bot|name|owner)\b/, 'user'],
  [/\b(local|cidade|endereco|pais|estado\/uf|regiao|location)\b/, 'place'], [/^(#|n[ºo°]?|qtd|qtde|quantidade|id)$|\b(quantidade|count)\b/, 'hash'],
  [/\b(arquivo|pasta|caminho|file|path)\b/, 'file'], [/\b(nota|avaliacao|score|rating|estrelas)\b/, 'star'],
  [/\b(prioridade|priority)\b/, 'flag'], [/\b(tipo|categoria|tag|type)\b/, 'tag'], [/\b(descricao|obs|observacao|notas|detalhes|description)\b/, 'note'],
  [/\b(%|percentual|taxa|porcentagem)\b|%/, 'pct'], [/\b(versao|version)\b/, 'version'], [/\b(modelo|motor|engine|model)\b/, 'cpu'],
]
const HEAD_ICONS: Record<string, LucideIcon> = {
  status: CircleDot, money: CircleDollarSign, date: Calendar, time: Clock, mail: Mail, phone: Phone, link: Link2, user: User, place: MapPin,
  hash: Hash, file: FileText, star: Star, flag: Flag, tag: Tag, note: StickyNote, pct: Percent, version: GitBranch, cpu: Cpu,
}
const NUM = /^[+\-−~≈]?\s*(r\$|us\$|\$|€|£)?\s*[+\-−]?\d[\d.,]*\s*(%|x|k|mil|mi|bi|ms|s|min|h|d|kb|mb|gb|tb|px)?$/i

function rehypeTables() {
  return (tree: H) => {
    for (const table of all(tree, 'table')) {
      const rows = all(table, 'tr').map((r) => (r.children ?? []).filter(isCell))
      const cols = Math.max(0, ...rows.map((r) => r.length))
      for (let i = 0; i < cols; i++) {
        const body = rows.slice(1).map((r) => r[i]).filter(Boolean)
        const vals = body.map((c) => text(c).trim()).filter((v) => v && !(v in { '-': 1, '—': 1, '–': 1 }))
        const num = vals.length > 0 && vals.every((v) => NUM.test(v))
        const head = rows[0]?.[i]
        if (head) {
          const h = norm(text(head))
          const icon = HEADS.find(([re]) => re.test(h))?.[1]
          head.properties = { ...head.properties, dataCol: i, ...(icon && { dataIcon: icon }), ...(num && { dataNum: 1 }) }
        }
        for (const c of body) {
          const p: Record<string, unknown> = { ...c.properties, ...(num && { dataNum: 1 }) }
          const first = c.children?.[0]
          const raw = text(c).trim()
          const em = first?.type === 'text' ? EMOJI.find(([re]) => re.test(first.value!.trimStart())) : undefined
          if (em && first) { first.value = first.value!.trimStart().replace(em[0], ''); p.dataStatus = em[1] }
          else if (WORDS[norm(raw)] && !num) p.dataStatus = WORDS[norm(raw)]
          c.properties = p
        }
      }
    }
  }
}

// avisos (> [!aviso]), checklist (- [ ] com chave pela posição no texto) e link sozinho na linha (prévia)
type HP = H & { position?: { start?: { offset?: number } } }
const kids = (n: H) => (n.children ?? []).filter((c) => !(c.type === 'text' && !c.value?.trim()))
function rehypeRich() {
  return (tree: H) => {
    for (const bq of all(tree, 'blockquote')) {
      const p = kids(bq)[0], t = p?.tagName === 'p' ? p.children?.[0] : undefined
      const m = t?.type === 'text' ? /^\s*\[!([\p{L}]+)\][^\S\n]*\n?/u.exec(t.value ?? '') : null
      if (!m) continue
      const k = norm(m[1]), kind = CALLOUT[k] ? k : CALLOUT_ALIAS[k]
      if (!kind) continue
      t!.value = t!.value!.slice(m[0].length)
      bq.properties = { ...bq.properties, dataCallout: kind }
    }
    for (const ul of all(tree, 'ul')) {
      const items = kids(ul).filter((li) => li.tagName === 'li')
      const keys: string[] = [], init: string[] = []
      for (const li of items) {
        const box = all(li, 'input').find((x) => x.properties?.type === 'checkbox')
        if (!box) continue
        const k = String((li as HP).position?.start?.offset ?? keys.length)
        box.properties = { ...box.properties, dataKey: k }
        keys.push(k); init.push(box.properties?.checked ? '1' : '0')
      }
      if (keys.length) ul.properties = { ...ul.properties, dataKeys: keys.join(','), dataInit: init.join(',') }
    }
    for (const p of all(tree, 'p')) {
      const k = kids(p)
      const a = k[0]
      const href = String(a?.properties?.href ?? '')
      if (k.length === 1 && a.tagName === 'a' && /^https?:\/\//.test(href) && text(a).trim().replace(/\/$/, '') === href.replace(/\/$/, '')) p.properties = { ...p.properties, dataLinkCard: href }
    }
  }
}

// sem HTML cru: react-markdown escapa tudo e limpa URLs perigosas (javascript: etc.)
export const Markdown = memo(function Markdown({ text, streaming, className }: { text: string; streaming?: boolean; className?: string }) {
  return (
    <div className={cn('md', streaming && 'streaming', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeTables, rehypeRich]} components={components} urlTransform={urlTransform}>{text}</ReactMarkdown>
    </div>
  )
})
