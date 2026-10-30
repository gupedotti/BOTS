# Gubots — guia de manutenção

Você está dentro do código do próprio Gubots, o app que está rodando agora. O usuário pede ajustes pelo chat; você implementa, testa e publica sozinho. Responda em português, curto.

## Mapa
- `server/` — Node 24 com TypeScript nativo (sem build): `index.ts` (HTTP/REST/WS), `hub.ts` (bots, fila, delegação), `engines.ts` (Claude Agent SDK e Codex app-server), `mcp.ts` (ferramentas dos bots), `browser.ts` (Chrome/Playwright), `memory.ts`, `db.ts` (node:sqlite), `settings.ts`.
- `web/src/` — React 19 + Tailwind v4 + shadcn: `views/` (Chat, Bots, Tasks, Memory, Settings, Computer), `components/`, `store.ts` (estado, REST, WS), `index.css` (tokens do tema).
- `data/` — banco, perfis do Chrome, memória e configurações do usuário. NUNCA apague nem edite à mão.
- `test/smoke.test.ts` — testes de fumaça.

## Como publicar uma mudança
1. Antes de mexer: `git status` (deve estar limpo). Se houver mudanças soltas, faça commit delas antes, com a mensagem "wip: estado anterior".
2. Faça a mudança mínima que resolve o pedido. Siga o estilo do código ao redor: enxuto, sem dependência nova sem necessidade, textos da UI em pt-BR.
3. Rode `npm run check`. Se mexeu no servidor, rode também `npm test`. Corrija até passar.
4. Mudou a UI: rode `npm run build`. As abas abertas recebem o aviso "O Gubots foi atualizado".
5. Mudou `server/`: chame a ferramenta `restart_gubots` só no fim da resposta. O servidor reinicia sozinho depois que você terminar.
6. Atualize o `README.md` sempre que mudar comportamento ou feature (regra do usuário).
7. Faça commit: `git add -A && git commit -m "<o que mudou>"`. Se algo quebrar, `git revert HEAD` desfaz.
8. Responda ao usuário em 2–4 linhas: o que mudou, o que testou e se precisa recarregar.

## Cuidados
- Nunca exponha a senha, o token (`data/token.txt`) ou as chaves de `data/settings.json`.
- Não mude porta, login nem o túnel Cloudflare sem o usuário pedir explicitamente.
- Nunca use `git push`, `git reset --hard` ou apague arquivos fora do que o pedido exige.
- Se o pedido for ambíguo ou arriscado, pergunte antes em uma linha.
