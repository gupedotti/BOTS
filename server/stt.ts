// Ditado por voz: o navegador grava, converte para WAV 16 kHz mono e manda para cá.
// Padrão: Whisper local (transformers.js + onnxruntime, sem chave e sem Python; o modelo baixa na 1ª vez para data/models).
// Alternativas: API da OpenAI ou ElevenLabs, se houver chave. O áudio só existe em memória.
import { bots, messages } from './db.ts';
import { runClaude } from './engines.ts';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DATA } from './db.ts';
import * as cfg from './settings.ts';

export const MAX_BYTES = 12 * 1024 * 1024; // ~6 min de WAV 16 kHz 16-bit
export const MAX_SECONDS = 300;
const MODELS: Record<string, string> = { base: 'onnx-community/whisper-base', small: 'onnx-community/whisper-small', turbo: 'onnx-community/whisper-large-v3-turbo' };

// Modelo fica na memória só enquanto há uso: carrega quando você começa a gravar e solta após 10 min parado.
let pipe: { model: string; p: Promise<any> } | undefined, idle: ReturnType<typeof setTimeout> | undefined;
function asr() {
  const model = MODELS[cfg.settings.sttModel] ?? MODELS.small;
  if (pipe?.model !== model) {
    pipe?.p.then((x) => x.dispose?.()).catch(() => {});
    pipe = {
      model,
      p: import('@huggingface/transformers').then(async (t) => {
        t.env.cacheDir = join(DATA, 'models');
        return t.pipeline('automatic-speech-recognition', model, { dtype: 'q8', device: 'cpu' });
      }),
    };
    const cur = pipe;
    cur.p.catch(() => { if (pipe === cur) pipe = undefined; }); // falhou (ex.: sem internet no 1º uso): tenta de novo na próxima
  }
  clearTimeout(idle);
  idle = setTimeout(() => { const cur = pipe; pipe = undefined; cur?.p.then((x) => x.dispose?.()).catch(() => {}); }, 10 * 60_000);
  idle.unref?.();
  return pipe.p;
}
// frases que o Whisper costuma inventar em trechos sem fala
const HALLUCINATION = /^(\W*|e\W*|legendas? (pela|por) .*|obrigad[oa] por assistir\W*|\[.*\]|\(.*\))$/i;
let line: Promise<unknown> = Promise.resolve(); // uma transcrição local por vez (CPU)

// WAV PCM 16-bit (ou float 32) mono → Float32Array. Devolve null se não for WAV.
export function wavToFloat(b: Buffer): { pcm: Float32Array; rate: number } | null {
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null;
  let fmt = 1, ch = 1, rate = 16000, bits = 16, o = 12;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4), at = o + 8;
    if (id === 'fmt ') { fmt = b.readUInt16LE(at); ch = b.readUInt16LE(at + 2); rate = b.readUInt32LE(at + 4); bits = b.readUInt16LE(at + 14); }
    if (id === 'data') {
      const end = Math.min(b.length, at + size), step = (bits / 8) * ch, n = Math.floor((end - at) / step), pcm = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) { const p = at + i * step + c * (bits / 8); s += fmt === 3 ? b.readFloatLE(p) : b.readInt16LE(p) / 32768; }
        pcm[i] = s / ch;
      }
      return { pcm, rate };
    }
    o = at + size + (size & 1);
  }
  return null;
}

// Reserva: navegador não conseguiu decodificar → ffmpeg (se existir no PC) converte webm/mp4 em PCM, tudo por pipe.
function ffmpegPcm(b: Buffer): Promise<Float32Array> {
  return new Promise((ok, bad) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-t', String(MAX_SECONDS), '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], { windowsHide: true });
    const out: Buffer[] = [];
    p.stdout.on('data', (d) => out.push(d));
    p.on('error', () => bad(new Error('formato de áudio não suportado (instale o ffmpeg ou use o Chrome/Safari)')));
    p.on('close', (code) => {
      if (code) return bad(new Error('não consegui ler o áudio'));
      const all = Buffer.concat(out);
      ok(new Float32Array(all.buffer, all.byteOffset, Math.floor(all.length / 4)).slice());
    });
    p.stdin.on('error', () => {});
    p.stdin.end(b);
  });
}

function resample(pcm: Float32Array, from: number) {
  if (from === 16000) return pcm;
  const r = from / 16000, out = new Float32Array(Math.floor(pcm.length / r));
  for (let i = 0; i < out.length; i++) { const x = i * r, j = Math.floor(x), f = x - j; out[i] = pcm[j] * (1 - f) + (pcm[j + 1] ?? pcm[j]) * f; }
  return out;
}

async function local(b: Buffer) {
  const w = wavToFloat(b);
  let pcm = w ? resample(w.pcm, w.rate) : await ffmpegPcm(b);
  if (pcm.length > MAX_SECONDS * 16000) pcm = pcm.subarray(0, MAX_SECONDS * 16000);
  if (pcm.length < 16000 * 0.3) return '';
  let peak = 0; for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 0.02) return ''; // silêncio: o Whisper inventa texto
  const job = line.then(async () => (await asr())(pcm, { language: 'portuguese', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 }));
  line = job.catch(() => {});
  const text = String(((await job) as any)?.text ?? '').trim();
  return HALLUCINATION.test(text) ? '' : text;
}

async function remote(b: Buffer, type: string) {
  const name = type.includes('wav') ? 'audio.wav' : type.includes('mp4') ? 'audio.mp4' : 'audio.webm';
  const fd = new FormData();
  // Groq: Whisper large-v3 em ~0,5 s (plano grátis com limite por minuto) — rápido o bastante para o texto ao vivo
  if (cfg.settings.sttEngine === 'groq') {
    const key = cfg.groqKey(); if (!key) throw Object.assign(new Error('chave do Groq não configurada'), { status: 501 });
    fd.append('model', 'whisper-large-v3'); fd.append('language', 'pt'); fd.append('response_format', 'json'); fd.append('temperature', '0');
    fd.append('prompt', `Português do Brasil. Termos: ${glossary().join(', ')}.`); fd.append('file', new Blob([new Uint8Array(b)], { type }), name);
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(30_000) });
    if (r.status === 429) throw Object.assign(new Error('Groq: limite por minuto do plano grátis'), { status: 429 });
    if (!r.ok) throw new Error(`Groq ${r.status}`);
    const t = String(((await r.json()) as any).text ?? '').trim();
    return HALLUCINATION.test(t) ? '' : t;
  }
  if (cfg.settings.sttEngine === 'openai') {
    const key = cfg.openaiKey(); if (!key) throw Object.assign(new Error('chave da OpenAI não configurada'), { status: 501 });
    fd.append('model', 'gpt-4o-transcribe'); fd.append('language', 'pt'); fd.append('prompt', `Termos: ${glossary().join(', ')}.`); fd.append('file', new Blob([new Uint8Array(b)], { type }), name);
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    return String(((await r.json()) as any).text ?? '').trim();
  }
  const key = cfg.elevenlabsKey(); if (!key) throw Object.assign(new Error('chave do ElevenLabs não configurada'), { status: 501 });
  fd.append('model_id', 'scribe_v1'); fd.append('language_code', 'por'); fd.append('file', new Blob([new Uint8Array(b)], { type }), name);
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}`);
  return String(((await r.json()) as any).text ?? '').trim();
}

// ---------- refino: corrige o que o Whisper errou (pontuação, typos, nomes) sem mudar o sentido ----------
// Glossário = nomes dos bots e do usuário + termos do dia a dia dele; contexto = últimas mensagens da conversa.
const TERMS = ['Gubots', 'Composio', 'Codex', 'Claude', 'Opus', 'Agenda', 'cron', 'deploy', 'commit', 'PWA', 'mobile', 'prompt'];
export function glossary() {
  const bs = bots.all();
  return [...new Set([cfg.settings.userName, ...bs.map(b => b.name), ...TERMS].filter(Boolean))];
}
export const REFINE_SYS = 'Você corrige transcrições de áudio em português do Brasil. Devolva SÓ o texto corrigido, sem aspas nem comentários. ' +
  'Corrija pontuação, maiúsculas, erros de digitação e palavras que o reconhecimento de voz trocou por outras de som parecido, usando o glossário e o contexto. ' +
  'Nomes de bots costumam vir deformados pelo som (ex.: "rárvei" = Harvey, "ronter" = Hunter, "forja" = Forja): troque pelo nome do glossário de som mais parecido. Cada pedido é independente. NÃO responda ao conteúdo, não resuma, não acrescente nem tire informação, não traduza, mantenha o tom e as gírias. Muletas (é, tipo, né, hã) e repetições acidentais podem sair. Se não houver o que corrigir, devolva igual.';
// processo do Haiku fica vivo (aquecido ao começar a gravar): refino em ~1-2 s em vez de ~4 s abrindo um novo
async function haiku(prompt: string) {
  let out = '';
  for await (const ev of runClaude({ key: 'gubots:stt-refine', model: 'haiku', effort: 'low', cwd: DATA, system: REFINE_SYS, prompt, tools: [], mcp: [], signal: AbortSignal.timeout(20_000) }))
    if (ev.k === 'final') out = ev.text;
  return out;
}
export async function refine(text: string, convId?: string): Promise<string> {
  if (!text.trim() || !cfg.settings.sttRefine) return text;
  const ctx = convId ? messages(convId, 6).filter(m => m.role === 'user' || m.role === 'bot').map(m => `${m.role === 'user' ? 'Usuário' : 'Bot'}: ${m.text.slice(0, 300)}`).join('\n') : '';
  const prompt = `Glossário: ${glossary().join(', ')}\n${ctx ? `Contexto (últimas mensagens):\n${ctx}\n` : ''}\nTranscrição:\n${text}`;
  const out = await Promise.race([haiku(prompt), new Promise<string>(r => setTimeout(() => r(''), 15_000))]).catch(() => '');
  const t = out.trim().replace(/^["“]|["”]$/g, '');
  // trava: resposta vazia, muito diferente no tamanho ou com cara de resposta ao conteúdo → fica o original
  return t && t.length > text.length * 0.5 && t.length < text.length * 1.6 + 40 ? t : text;
}

export async function transcribe(b: Buffer, type = 'audio/wav') {
  if (b.length > MAX_BYTES) throw Object.assign(new Error('áudio grande demais (máx. ~5 min)'), { status: 413 });
  return cfg.settings.sttEngine === 'local' ? local(b) : remote(b, type);
}
export const warm = () => {
  if (cfg.settings.sttEngine === 'local') asr().catch(() => {});
  if (cfg.settings.sttRefine) haiku('Transcrição: ok').catch(() => {}); // aquece o refino enquanto você fala
};
