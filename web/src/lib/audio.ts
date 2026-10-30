// Ditado: grava com MediaRecorder e converte para WAV 16 kHz mono (o formato que o Whisper usa).
// Converter aqui deixa o envio pequeno e o servidor não depende de ffmpeg. Se o navegador não decodificar, manda o original.

// Formato que o navegador sabe gravar: webm/opus no Chrome/Android, mp4 no Safari/iOS.
export const recMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? ''

export async function toWav16k(blob: Blob): Promise<Blob> {
  const AC = window.AudioContext || (window as any).webkitAudioContext
  const ctx: AudioContext = new AC()
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const n = buf.length, mono = new Float32Array(n)
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels }
    const r = buf.sampleRate / 16000, out = new Int16Array(Math.floor(n / r))
    for (let i = 0; i < out.length; i++) { // média da janela: reamostra sem serrilhado grosseiro
      const a = Math.floor(i * r), b = Math.max(a + 1, Math.floor((i + 1) * r))
      let s = 0; for (let j = a; j < b; j++) s += mono[j] ?? 0
      out[i] = Math.max(-1, Math.min(1, s / (b - a))) * 0x7fff
    }
    const h = new DataView(new ArrayBuffer(44)), w = (o: number, s: string) => [...s].forEach((ch, i) => h.setUint8(o + i, ch.charCodeAt(0)))
    w(0, 'RIFF'); h.setUint32(4, 36 + out.byteLength, true); w(8, 'WAVE'); w(12, 'fmt ')
    h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, 16000, true); h.setUint32(28, 32000, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true)
    w(36, 'data'); h.setUint32(40, out.byteLength, true)
    return new Blob([h, out], { type: 'audio/wav' })
  } finally { ctx.close().catch(() => {}) }
}

// Ditado em tempo real (Web Speech API do navegador): texto parcial enquanto você fala; o Whisper refina no fim.
// Liga/desliga por aparelho (localStorage); sem suporte (ex.: Safari/iOS) fica só o Whisper.
const LIVE_KEY = 'gubots-live-stt'
export const speechCtor = (): any => (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
export const liveSttOn = () => localStorage.getItem(LIVE_KEY) !== '0'
export const setLiveStt = (on: boolean) => localStorage.setItem(LIVE_KEY, on ? '1' : '0')

// reconhecimento contínuo em pt-BR; onText recebe finais + parcial a cada resultado. Devolve stop() ou undefined se não deu.
export function startLiveStt(onText: (t: string) => void): (() => void) | undefined {
  const SR = speechCtor()
  if (!SR || !liveSttOn()) return
  let fin = '', on = true
  const r = new SR()
  r.lang = 'pt-BR'; r.interimResults = true; r.continuous = true
  r.onresult = (e: any) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const x = e.results[i]
      if (x.isFinal) fin += (fin && !fin.endsWith(' ') ? ' ' : '') + x[0].transcript.trim()
      else interim += x[0].transcript
    }
    onText((fin + (interim ? ' ' + interim.trim() : '')).trim())
  }
  r.onerror = (e: any) => { if (e?.error === 'not-allowed' || e?.error === 'audio-capture' || e?.error === 'service-not-allowed') on = false } // sem tempo real: segue só com o Whisper
  r.onend = () => { if (on) try { r.start() } catch { /* já rodando */ } } // o Chrome encerra após silêncio: religa
  try { r.start() } catch { return }
  return () => { on = false; try { r.abort() } catch { /* ok */ } }
}
