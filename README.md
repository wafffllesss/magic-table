# magic-table

Meu app para se jogar Magic. Esta POC de Commander oferece uma mesa compartilhada de quatro lugares. A interface usa Vue 3, TypeScript e uma mesa CSS 3D leve. A demonstração local já permite explorar os playmats, as zonas, a mão, a pilha, os marcadores e os atalhos sem configurar serviços externos.

## Executar

Requer Node.js 22 ou superior e pnpm. Java 21 ou superior é necessário para executar o emulador Firebase usado nos testes de regras.

```sh
pnpm install
pnpm dev
```

Abra o endereço mostrado pelo Vite e escolha **Entrar na mesa** para iniciar a demonstração local. Os decks são guardados neste dispositivo. A biblioteca de quatro decks Commander e as cartas são carregadas sob demanda da API do Scryfall.

## Sala multiplayer Firebase

Crie um projeto Firebase, habilite autenticação anônima e crie um Realtime Database. Copie `.env.example` para `.env.local` e preencha as credenciais do app Web, incluindo a URL do Realtime Database. Publique as regras antes de abrir a sala:

```sh
pnpm exec firebase deploy --only database --project SEU_PROJECT_ID
pnpm dev
```

As regras negam acesso por padrão, mantêm mãos e bibliotecas em nós privados por lugar e permitem que o ocupante atual leia esses dados. Uma substituição herda os dados privados do lugar. Autenticação anônima e regras de acesso protegem a sala; o cliente ainda embaralha e interpreta as cartas, então esta POC é casual e não impede trapaças.

## Dados locais

O IndexedDB guarda decks pessoais, preferências, metadados de cartas e imagens. O cache descartável de metadados e imagens tem limite combinado de 200 MiB e remove primeiro os itens menos usados; decks pessoais permanecem. A aplicação busca somente cartas necessárias, limita chamadas ao Scryfall e continua usando dados textuais quando imagens ou rede não estão disponíveis.

## Verificações

```sh
pnpm typecheck
pnpm test
pnpm test:rules
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

`test:rules` inicia o emulador local do Realtime Database. Os testes de navegador exercitam a entrada, a mesa CSS 3D, os atalhos e o layout compacto. `.env.local` não é necessário para a suíte local.

Durante o desenvolvimento, `/?stress=200` abre o cenário de estresse com 200 permanentes públicas. O teste de navegador verifica a renderização e usa o heap exposto pelo Chromium como uma verificação inicial do limite de 150 MiB.

## Próximos limites

A mesa acompanha zonas, mana simples, comandante, turnos e pilha, mas jogadores ainda resolvem alvos e efeitos de cartas. O código está organizado para uma futura janela Electron com uma ponte nativa mínima; empacotamento, tamanho do instalador e consumo total serão medidos nessa etapa.
