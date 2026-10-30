export type Engine = 'claude' | 'codex'
export type Tool = 'browser' | 'files' | 'shell' | 'web' | 'design'
export type Effort = 'low' | 'medium' | 'high'

export interface Bot {
  id: string
  name: string
  avatar: string
  job: string
  engine: Engine
  model: string
  effort: Effort
  tools: Tool[]
  composio: string[]
  mcp: { name: string; url: string }[]
  logins: string[]
  isChief: boolean
  profile: string
  status: 'idle' | 'working' | 'queued'
  busyIn?: string[] // conversas em que está trabalhando agora
  queue?: { id: number; convId: string; text: string }[] // pedidos esperando a vez (mesma conversa)
}

export interface Conv {
  id: string
  kind: 'bot' | 'mission'
  mission?: { problem: string; status: 'active' | 'paused' | 'closed'; steps: number; closing?: boolean } // missão: grupo orquestrado pelo chefe
  title: string
  botIds: string[]
  lastTs: number
  readTs?: number
  unread?: number // respostas de bot ainda não vistas
}

export interface Msg {
  id: string | number
  convId: string
  role: 'user' | 'bot' | 'system'
  botId?: string
  text: string
  taskId?: number
  ts: number
  meta?: { engine?: string; model?: string; kind?: 'delegation' | 'refusal' | 'result' | 'error'; attachments?: Att[]; reactions?: { botId: string; emoji: string }[] }
}

export interface Task {
  id: number
  parentId?: number
  convId: string
  requester: string
  assignee: string
  objective: string
  inputs: string
  doneWhen: string
  requires: string[]
  status: 'queued' | 'running' | 'done' | 'failed' | 'refused' | 'canceled'
  result?: string
  refusal?: { reason: string; suggest?: string }
  dependsOn: number[]
  depth: number
  createdAt: number
  startedAt?: number
  endedAt?: number
}

export interface Fact {
  id: string | number
  text: string
  botId: string
  source: { convId?: string; msgId?: string; taskId?: number }
  ts: number
  obsolete: boolean
  replacedBy?: string | number
  pinned?: boolean
}

export interface ActivityItem {
  ts: number
  kind: 'tool' | 'nav' | 'info' | 'error'
  text: string
  convId?: string // conversa do trabalho que gerou o passo
}

export interface ModelInfo {
  id: string
  name: string
  efforts?: string[]
  isDefault?: boolean
}
export interface Models {
  claude: ModelInfo[]
  codex: ModelInfo[]
  errors?: { claude?: string; codex?: string }
}

export interface Frame {
  botId: string
  data: string
  w: number
  h: number
  url: string
  focus?: { x: number; y: number; w: number; h: number }
}

export interface Settings {
  userName: string
  sendOnEnter: boolean
  animations: boolean
  notify: boolean
  adblock: boolean
  headed: boolean
  graphNightly: boolean
  composio: { set: boolean; last4?: string }
  elevenlabs: { set: boolean; last4?: string }
  openai: { set: boolean; last4?: string }
  groq: { set: boolean; last4?: string }
  sttEngine: 'local' | 'groq' | 'openai' | 'elevenlabs'
  sttModel: 'base' | 'small' | 'turbo'
  sttRefine: boolean
}

type EngineStatus = { ok: boolean; version?: string; models: number; error?: string }
export interface SystemInfo {
  version: string
  dataDir: string
  uptime: number
  engines: { claude: EngineStatus; codex: EngineStatus }
  graphify: { ok: boolean; version?: string }
  remote: { token: string; urls: string[] }
}

export interface Graph {
  nodes: { id: string; label: string; community?: number | string }[]
  edges: { source: string; target: string; relation: string; confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' }[]
  updatedAt?: number | string
  review: string[]
  running?: boolean
}

export type Att = { name: string; size: number; mime: string; url: string }

// tarefa agendada (cron por bot): daily = horário + dias (0 = dom; vazio = todo dia) · interval = a cada N min · once = data e hora
export type SchedRun = { ts: number; status: 'running' | 'done' | 'failed' | 'skipped'; ms?: number; error?: string; email?: string; manual?: boolean; empty?: boolean }
export interface Schedule {
  id: number
  botId: string
  title: string
  prompt: string
  kind: 'daily' | 'interval' | 'once'
  at?: number // once: instante exato
  done?: boolean // once: já rodou (ou foi pulada) e se desativou
  convId?: string
  time: string
  days: number[]
  every: number
  email: string
  paused: boolean
  nextAt: number
  lastAt?: number
  runs: SchedRun[]
  createdAt: number
}
