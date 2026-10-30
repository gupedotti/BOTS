// PPTX/PPT/XLSX/XLS/DOCX/DOC → PDF pelo Office instalado neste PC (COM via PowerShell, oculto).
// Usado na prévia do chat e pela ferramenta office_to_pdf dos bots de design. Cache por arquivo+data em data/cache/office.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { DATA } from './db.ts';

const CACHE = join(DATA, 'cache', 'office');
export const OFFICE = /\.(pptx?|xlsx?|docx?)$/i;
const running = new Map<string, Promise<string>>();

const ps = (s: string) => s.replace(/'/g, "''");
function script(src: string, out: string) {
  const e = extname(src).toLowerCase();
  if (e.startsWith('.ppt')) return `$a = New-Object -ComObject PowerPoint.Application; try { $p = $a.Presentations.Open('${ps(src)}', $true, $false, $false); $p.SaveAs('${ps(out)}', 32); $p.Close() } finally { $a.Quit() }`;
  if (e.startsWith('.xls')) return `$a = New-Object -ComObject Excel.Application; $a.Visible = $false; $a.DisplayAlerts = $false; try { $w = $a.Workbooks.Open('${ps(src)}', 0, $true); $w.ExportAsFixedFormat(0, '${ps(out)}'); $w.Close($false) } finally { $a.Quit() }`;
  return `$a = New-Object -ComObject Word.Application; $a.Visible = $false; try { $d = $a.Documents.Open('${ps(src)}', $false, $true); $d.ExportAsFixedFormat('${ps(out)}', 17); $d.Close($false) } finally { $a.Quit() }`;
}

export function toPdf(file: string): Promise<string> {
  const src = resolve(file); // Office quer caminho com \\
  if (!OFFICE.test(src)) return Promise.reject(new Error('só pptx, xlsx ou docx'));
  if (!existsSync(src)) return Promise.reject(new Error('arquivo não existe'));
  const key = createHash('sha1').update(src + ':' + statSync(src).mtimeMs).digest('hex').slice(0, 16);
  const out = resolve(join(CACHE, key + '.pdf'));
  if (existsSync(out)) return Promise.resolve(out);
  if (running.has(key)) return running.get(key)!;
  mkdirSync(CACHE, { recursive: true });
  const p = new Promise<string>((ok, ko) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script(src, out)], { windowsHide: true, timeout: 120_000 }, (err, _o, stderr) => {
    if (existsSync(out)) ok(out); else ko(new Error(`Office não converteu: ${String(stderr || err?.message || '').trim().split('\n')[0].slice(0, 200)}`));
  })).finally(() => running.delete(key));
  running.set(key, p);
  return p;
}
