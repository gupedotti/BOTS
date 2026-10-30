import type { ReactNode } from 'react'
import { useStore } from '@/store'

export const AVATARS = ['jarvis', 'atlas', 'lira', 'nova', 'orion', 'vega', 'terra', 'sol', 'flor', 'hexa', 'cubo', 'estrela', 'fantasma', 'capsula', 'coracao'] as const

// corpo e olhos copiados do Avatar.dc.html; `body` recebe a animação de balançar e `eyes` a de olhar
const eye = (x: number, y: number, fill = '#FFFFFF', w = 4.5, h = 9) => <rect x={x} y={y} width={w} height={h} rx={w / 2} fill={fill} />
// color = brilho em volta quando o bot está pensando
const SHAPES: Record<string, { body: ReactNode; eyes: ReactNode; color?: string }> = {
  jarvis: {
    body: (
      <g fill="#F2B33D">
        <circle cx="24" cy="28" r="17" /><circle cx="13" cy="13" r="5" /><circle cx="24" cy="9" r="5" /><circle cx="35" cy="13" r="5" />
      </g>
    ),
    eyes: (<><rect x="16.5" y="23" width="4.5" height="9" rx="2.25" fill="#FFFFFF" /><rect x="26" y="23" width="4.5" height="9" rx="2.25" fill="#FFFFFF" /></>),
  },
  atlas: {
    body: <path d="M24 4c2.6 0 4.2 1.6 5.6 4.1l13.6 24.4c2.6 4.7 0 9.5-5.3 9.5H10.1c-5.3 0-7.9-4.8-5.3-9.5L18.4 8.1C19.8 5.6 21.4 4 24 4z" fill="#3B82F6" />,
    eyes: (<><rect x="18.5" y="25" width="4" height="8" rx="2" fill="#FFFFFF" /><rect x="25.5" y="25" width="4" height="8" rx="2" fill="#FFFFFF" /></>),
  },
  lira: {
    body: <path d="M24 3c4 4.6 17 18.2 17 27.6C41 39.6 33.4 46 24 46S7 39.6 7 30.6C7 21.2 20 7.6 24 3z" fill="#60a5fa" />,
    eyes: (<><rect x="16" y="26" width="4.5" height="9" rx="2.25" fill="#FFFFFF" /><rect x="24" y="26" width="4.5" height="9" rx="2.25" fill="#FFFFFF" /></>),
  },
  nova: {
    body: <path d="M14 41C7.4 41 3 36.4 3 30.8c0-5.1 3.9-9.3 8.9-9.8C13.1 14.1 18.5 9 25 9c6.2 0 11.4 4.5 12.6 10.5 4.4 1 7.4 5 7.4 9.9C45 35.9 40.3 41 34 41z" fill="#FF6A1A" />,
    eyes: (<><rect x="15" y="22.5" width="9" height="4" rx="2" fill="#FFFFFF" transform="rotate(-18 19.5 24.5)" /><rect x="27" y="20.5" width="9" height="4" rx="2" fill="#FFFFFF" transform="rotate(-18 31.5 22.5)" /></>),
  },
  orion: {
    body: <circle cx="24" cy="25" r="20" fill="#ECEAE4" />,
    eyes: (<><rect x="15.5" y="15" width="4.5" height="9" rx="2.25" fill="#131211" transform="rotate(25 17.75 19.5)" /><rect x="24" y="13" width="4.5" height="9" rx="2.25" fill="#131211" transform="rotate(25 26.25 17.5)" /></>),
  },
  vega: {
    body: <rect x="4" y="7" width="40" height="36" rx="15" fill="#22C55E" />,
    eyes: (<><rect x="15" y="19" width="5" height="10" rx="2.5" fill="#FFFFFF" /><rect x="27" y="19" width="5" height="10" rx="2.5" fill="#FFFFFF" /></>),
  },
  terra: {
    body: (
      <g fill="#A0703F">
        <circle cx="16" cy="16" r="11" /><circle cx="32" cy="16" r="11" /><circle cx="16" cy="32" r="11" /><circle cx="32" cy="32" r="11" /><rect x="14" y="14" width="20" height="20" />
      </g>
    ),
    eyes: (<><rect x="17" y="18" width="4.5" height="9" rx="2.25" fill="#FFFFFF" /><rect x="25" y="18" width="4.5" height="9" rx="2.25" fill="#FFFFFF" /></>),
  },
  sol: {
    color: '#FACC15',
    body: (
      <g fill="#FACC15">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <rect key={a} x="22" y="1.5" width="4" height="8" rx="2" transform={`rotate(${a} 24 24)`} />)}
        <circle cx="24" cy="24" r="13.5" />
      </g>
    ),
    eyes: (<>{eye(18.5, 19.5, '#1F1A05', 4, 8)}{eye(25.5, 19.5, '#1F1A05', 4, 8)}</>),
  },
  flor: {
    color: '#F472B6',
    body: (
      <g fill="#F472B6">
        <circle cx="24" cy="14" r="9" /><circle cx="34.5" cy="21.6" r="9" /><circle cx="30.5" cy="33.9" r="9" /><circle cx="17.5" cy="33.9" r="9" /><circle cx="13.5" cy="21.6" r="9" /><circle cx="24" cy="25" r="11" />
      </g>
    ),
    eyes: (<>{eye(18.5, 21, '#FFFFFF', 4, 8)}{eye(25.5, 21, '#FFFFFF', 4, 8)}</>),
  },
  hexa: {
    color: '#14B8A6',
    body: <path d="M24 6 40 15.5V34.5L24 44 8 34.5V15.5Z" fill="#14B8A6" stroke="#14B8A6" strokeWidth="5" strokeLinejoin="round" />,
    eyes: (<>{eye(17.5, 20.5, '#FFFFFF', 5, 10)}{eye(25.5, 20.5, '#FFFFFF', 5, 10)}</>),
  },
  cubo: {
    color: '#A855F7',
    body: <rect x="9.5" y="10.5" width="29" height="29" rx="8" transform="rotate(45 24 25)" fill="#A855F7" />,
    eyes: (<>{eye(18, 20.5)}{eye(25.5, 20.5)}</>),
  },
  estrela: {
    color: '#EF4444',
    body: <path d="M24 5 29.9 17.9 44 19.5 33.5 29.1 36.3 43 24 36 11.7 43 14.5 29.1 4 19.5 18.1 17.9Z" fill="#EF4444" stroke="#EF4444" strokeWidth="3.5" strokeLinejoin="round" />,
    eyes: (<>{eye(19.5, 22, '#FFFFFF', 4, 7.5)}{eye(24.5, 22, '#FFFFFF', 4, 7.5)}</>),
  },
  fantasma: {
    color: '#C4B5FD',
    body: <path d="M8 22C8 12.6 15.2 5 24 5s16 7.6 16 17v19l-5.3-4-5.4 4-5.3-4-5.3 4-5.4-4L8 41Z" fill="#C4B5FD" />,
    eyes: (<>{eye(17, 18, '#1E1B4B')}{eye(26.5, 18, '#1E1B4B')}</>),
  },
  capsula: {
    color: '#22D3EE',
    body: <rect x="3" y="13" width="42" height="24" rx="12" fill="#22D3EE" />,
    eyes: (<>{eye(16, 20.5, '#083344')}{eye(27.5, 20.5, '#083344')}</>),
  },
  coracao: {
    color: '#FB7185',
    body: <path d="M24 43S5 31 5 18.5C5 11.6 10.4 7 16 7c3.7 0 6.6 2 8 4.8C25.4 9 28.3 7 32 7c5.6 0 11 4.6 11 11.5C43 31 24 43 24 43Z" fill="#FB7185" />,
    eyes: (<>{eye(17.5, 18)}{eye(26, 18)}</>),
  },
}
// cor do brilho dos avatares antigos
const GLOW: Record<string, string> = { jarvis: '#F2B33D', atlas: '#3B82F6', lira: '#60a5fa', nova: '#FF6A1A', orion: '#ECEAE4', vega: '#22C55E', terra: '#A0703F' }

const still = matchMedia('(prefers-reduced-motion: reduce)')

// cor escolhida vai junto do avatar: "atlas#a855f7" (sem "#cor" = cor original do desenho)
export const AVATAR_COLORS = ['#F2B33D', '#FF6A1A', '#EF4444', '#FB7185', '#F472B6', '#A855F7', '#6366F1', '#3B82F6', '#22D3EE', '#14B8A6', '#22C55E', '#A3E635', '#ECEAE4', '#A0703F', '#64748B']
export const splitAvatar = (a: string) => {
  const [id, c] = (a ?? '').split('#')
  return { id, color: c && /^[0-9a-f]{6}$/i.test(c) ? '#' + c.toLowerCase() : undefined }
}
export const withColor = (a: string, color?: string) => splitAvatar(a).id + (color ? '#' + color.replace('#', '').toLowerCase() : '')
// olhos claros em cor escura e escuros em cor clara
const eyesOn = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#18181b' : '#ffffff'
}

// pensando: corpo pula e estica (squash & stretch) e balança, olhos olham e piscam, brilho pulsa na cor do bot
// e, a partir de 24 px, um balãozinho de "…" aparece no canto
export function Avatar({ bot, size = 32, working: w = false, className }: { bot: string; size?: number; working?: boolean; className?: string }) {
  const { id, color } = splitAvatar(bot)
  const s = SHAPES[id] ?? SHAPES.jarvis
  const working = useStore((st) => st.settings.animations) && w && !still.matches
  const glow = color ?? s.color ?? GLOW[id] ?? '#3B82F6'
  const dot = Math.max(2.5, Math.round(size * 0.1))
  return (
    <span className={`relative inline-flex shrink-0 ${className ?? ''} ${working ? 'av-on' : ''} ${color ? 'av-tint' : ''}`}
      style={{ width: size, height: size, ['--av' as string]: glow, ...(color && { ['--tint' as string]: color, ['--eyes' as string]: eyesOn(color) }) }}>
      <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true" className="overflow-visible">
        <g className="av-body">
          {s.body}
          <g className="av-look"><g className="av-blink">{s.eyes}</g></g>
        </g>
      </svg>
      {working && size >= 24 && (
        <span aria-hidden="true" className="av-bubble absolute flex items-center rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.6)]"
          style={{ gap: dot * 0.6, padding: `${dot * 0.7}px ${dot}px`, top: -dot * 1.6, right: -dot * 2.2 }}>
          {[0, 1, 2].map((i) => <span key={i} className="rounded-full bg-[#18181b]" style={{ width: dot, height: dot, animation: `typing 1s ${i * 0.15}s infinite ease-in-out` }} />)}
        </span>
      )}
    </span>
  )
}

// orb iridescente da tela inicial (CSS puro em index.css); `active` acelera quando o bot trabalha
export const Orb = ({ size = 180, active, className }: { size?: number; active?: boolean; className?: string }) => (
  <span aria-hidden="true" className={className ? `orb ${className}` : 'orb'} style={{ width: size }} data-active={active || undefined}>
    <span className="o-glow" /><span className="o-body" /><span className="o-lines" /><span className="o-core" /><span className="o-shine" />
  </span>
)

// marca do Gubots: silhueta do Jarvis em monocromático
export const Logo = ({ size = 24 }: { size?: number }) => (
  <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
    <g fill="#FCFCFC"><circle cx="24" cy="28" r="17" /><circle cx="13" cy="13" r="5" /><circle cx="24" cy="9" r="5" /><circle cx="35" cy="13" r="5" /></g>
    <rect x="16.5" y="23" width="4.5" height="9" rx="2.25" fill="#131211" /><rect x="26" y="23" width="4.5" height="9" rx="2.25" fill="#131211" />
  </svg>
)
