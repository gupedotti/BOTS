// Instala/atualiza as skills de design e documentos (anthropics/skills) em data/skills e as dependências
// que elas usam: pptxgenjs/docx/sharp em data/node_modules (alcançáveis a partir de data/bots/<id>/) e
// markitdown/python-pptx/python-docx/openpyxl no Python do usuário. Uso: npm run design:setup
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DATA = process.env.GUBOTS_DATA || join(ROOT, 'data');
const SKILLS = ['pptx', 'docx', 'xlsx', 'pdf', 'frontend-design', 'canvas-design', 'algorithmic-art', 'theme-factory', 'web-artifacts-builder', 'slack-gif-creator'];
const run = (cmd, args, cwd) => { console.log('>', cmd, args.join(' ')); execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }); };

const tmp = join(tmpdir(), 'gubots-skills-' + Date.now());
run('git', ['clone', '-q', '--depth', '1', 'https://github.com/anthropics/skills', tmp]);
const dest = join(DATA, 'skills');
mkdirSync(dest, { recursive: true });
for (const s of SKILLS) {
  rmSync(join(dest, s), { recursive: true, force: true });
  cpSync(join(tmp, 'skills', s), join(dest, s), { recursive: true });
}
rmSync(tmp, { recursive: true, force: true });

if (!existsSync(join(DATA, 'package.json'))) writeFileSync(join(DATA, 'package.json'), JSON.stringify({ name: 'gubots-data', private: true }, null, 1));
run('npm', ['install', '--no-audit', '--no-fund', 'pptxgenjs', 'docx', 'sharp', 'react', 'react-dom', 'react-icons'], DATA);
// todo Python do PATH (o servidor pode achar um diferente do terminal); os sem pip são pulados
let pys = [];
try { pys = execFileSync('where.exe', ['python'], { encoding: 'utf8' }).split(/\r?\n/).filter(p => p && !/WindowsApps/i.test(p)); } catch { /* sem python no PATH */ }
for (const py of pys) {
  try { execFileSync(py, ['-m', 'pip', '--version'], { stdio: 'ignore' }); } catch { console.log('sem pip:', py); continue; }
  run(`"${py}"`, ['-m', 'pip', 'install', '--user', '-q', '"markitdown[pptx,docx,xlsx]"', 'python-pptx', 'python-docx', 'openpyxl', 'pypdf', 'pillow']);
}
console.log('skills prontas em', dest);
