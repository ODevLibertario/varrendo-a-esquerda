# Varrendo a Esquerda

Painel local, descartável, da apuração do 1º turno de 4 out 2026. Um único processo Node busca os resultados do TSE (ou gera dados falsos), serve a página e envia atualizações por SSE.

**Requisitos:** Node 22+. Nenhuma dependência, sem `npm install`.

## Rodar

```sh
node server.js                 # modo TSE (padrão), http://localhost:8090
MODE=fake node server.js       # simulação (demo em loop)
node server.js --probe         # busca ele-c.json + arquivo nacional de Presidente 1 vez, mostra URLs e resumo, sai
node --test                    # testes
```

### Porta

O padrão é **8090** (a 8080 já está em uso no Mac do Gilson). Para trocar: `PORT=9000 node server.js` ou `"port"` no `config.json`.

### Dados de 2022

Não dá para testar com 2022: o TSE não publica mais esses arquivos (todo caminho `ele2022` dá 404 e o `ele-c.json` só lista pleitos de 2024 em diante), então o perfil 2022 foi removido. O arquivo nacional de 2026 já existe (com zero votos), então `node server.js --probe` já testa o caminho real; para ver o visual use `MODE=fake`.

## Dia da eleição

O schema JSON de 2026 do TSE **não pôde ser verificado antes** (os hosts do TSE estavam bloqueados no ambiente de build). O parser é defensivo, mas:

1. O ciclo é fixado em `ele2026` no `config.json`; se `cycle` for `null`, ele é lido do `ele-c.json` escolhendo o pleito que contém o código 6257. Por volta das **17:00** rode `node server.js --probe` e confira: URLs, `cycle`, `pctSections`, candidatos com partido/lado/votos.
2. Se der 404 ou o padrão de URL for diferente, ajuste `tse.resultUrl` / `tse.configUrl` / `tse.cycle` no `config.json`. Placeholders: `{base} {env} {cycle} {ele} {ele6} {uf} {cargo} {cargo4}` (uf minúscula, `br` = nacional).
3. Para guardar os JSON brutos, defina `tse.saveRawDir` (ex.: `"raw"`): cada ciclo grava uma pasta com timestamp.

Comportamento do poller: 136 requisições por ciclo (Presidente BR + Presidente/Governador/Senador/Dep. Federal/Dep. Estadual por UF; no DF o estadual é Dep. Distrital, `c0008`, porque `df-c0007` não existe), sequenciais com ≥150 ms entre elas, `If-None-Match`/`If-Modified-Since` (304 reaproveita o corpo em cache). O arquivo nacional vai primeiro: se falhar (ex.: 404 antes das 17h) o ciclo é abortado. 429 ou 403 (provável bloqueio de IP) interrompe o ciclo e o próximo espera pelo menos 10 min. 5xx/rede mantêm o último dado bom; 4 erros seguidos encerram o ciclo. Após erro, o próximo ciclo espera o dobro (mín. o intervalo normal, máx. 10 min). O navegador nunca acessa o TSE.

### Deputados

Dep. Federal (`c0006`) e Dep. Estadual/Distrital (`c0007`/`c0008`) vêm dos arquivos da eleição estadual (6259). Como são centenas de vagas, o painel só anuncia **deputados da direita eleitos** (sem notificações de derrota), com cargo e UF em cada item. Se uma atualização trouxer muitos eleitos de uma vez, só os 8 mais novos ganham animação e fogos; os demais entram na lista em silêncio. Mapa e barra continuam usando só o voto para Presidente.

### Filtrar por estado

Clique num estado do mapa (ou Tab + Enter) para focar nele: barra, emoji, % de seções e a lista de notificações passam a mostrar só aquele estado (Presidente no estado para a barra; governador, senadores e deputados do estado na lista), e só os eventos daquele estado soltam fogos. Clique de novo no estado, no botão com o nome dele no topo ou aperte Esc para voltar ao Brasil inteiro.

Com um estado selecionado, o painel também mostra **Pendentes**: as disputas daquele estado ainda não decididas (Governador, Senador, Dep. Federal, Dep. Estadual/Distrital), cada uma com quem lidera agora, a cor do lado dele, o percentual e quanto já foi apurado; atualiza a cada ciclo do servidor (campo `races` no Snapshot). Uma disputa sai de Pendentes quando o TSE marca alguém como eleito ou a disputa vai para o 2º turno. Nos deputados, "lidera" é o mais votado até o momento.

## Editar

- **`parties.json`**: regra do Gilson: **só** os partidos com `"lado": "direita"` contam como direita (PL, NOVO, REPUBLICANOS, MISSÃO, PRD, mais PRC, PSC, PDS, PRONA, PRM e UDN). Todo o resto, inclusive partido desconhecido, é esquerda via `"padrao": "esquerda"`. Não existe mais "centro". Os demais partidos atuais aparecem como `esquerda` só para clareza (o `numero` ajuda quando o arquivo do TSE não traz a sigla). A sigla é comparada sem acento, espaço ou maiúscula (`MISSÃO` = `Missao`). `"ativo": false` marca partido histórico/incorporado (fica na regra, mas a simulação não usa). `overrides` força o lado de um candidato: `{ "sp:15": "direita" }` (uf minúscula + número; `br` para Presidente). Votos anulados ficam fora da soma.
- **`config.json`**: porta, intervalos, URLs/códigos do TSE (`elections.federal` 6257, `elections.estadual` 6259), `minEventPct` (percentual mínimo para notificar derrota da esquerda), `requestSpacingMs`, `saveRawDir`.

## API local (Node)

- `GET /api/state` → Snapshot JSON
- `GET /api/events` → SSE, `event: snapshot` na conexão e a cada atualização; `: ping` a cada 25 s

## Cloudflare Pages

No Pages, os arquivos de `public/` são estáticos e `public/_worker.js` atende à API.
Um segundo Worker (`src/collector-worker.js`) consulta o TSE por agendamento e
publica um snapshot compartilhado em Workers KV. São quatro lotes de até 34
arquivos, com intervalo mínimo de 150 ms entre consultas. Uma rodada completa
ocorre a cada 10 minutos. A coleta só roda entre 17h de 4/10/2026 e 0h de
6/10/2026, horário de Brasília. Um 403/429 interrompe a coleta por pelo menos
10 minutos. O navegador nunca acessa o TSE.

```sh
npm install
npm run build
npm run pages:dev
npm run collector:deploy
npm run pages:deploy -- --project-name varrendo-a-esquerda
```

Os dois arquivos `wrangler*.jsonc` usam o mesmo namespace KV no binding
`RESULTS`. Para outro projeto Cloudflare, crie um namespace próprio e troque o
ID nos dois arquivos. O Worker agendado precisa ser publicado antes do Pages.
Até a primeira rodada, `/api/state` retorna 503 e o painel informa que está
aguardando dados. Depois, o Pages só lê o snapshot; falhas da fonte preservam
os últimos dados bons e aparecem em `source`.

O modo de demonstração fica em `/?mode=fake`, com dados simulados que avançam
a cada 20 segundos. O link no rodapé alterna entre simulação e apuração real.
No Pages, `/api/events` envia apenas um snapshot para compatibilidade; a página
usa `/api/state` e agenda a próxima leitura segundo `nextRefreshAt`. Para SSE
contínuo e `--probe`, use o servidor Node local.
