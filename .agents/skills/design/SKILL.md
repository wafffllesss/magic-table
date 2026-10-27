---
name: design
description: Crie ou refine a experiência visual e as interações do Magic Table, mantendo uma mesa de Magic imersiva, consistente, clara e acessível.
---

# Design do Magic Table

Faça a mesa lembrar uma partida presencial de Magic por meio da disposição dos jogadores, playmats, cartas, profundidade, iluminação e movimento. Mantenha a interface coerente com os padrões e a identidade visual que o projeto já estabelece.

## Linguagem visual e interação

- Antes de desenhar, examine os componentes, variáveis de estilo e interações existentes. Reutilize a paleta escura com acentos verdes, os componentes e os estados visuais do projeto; acrescente novas cores ou tratamentos quando ajudarem a comunicar contexto, estado ou ação.
- Use perspectiva, posição dos lugares, playmats, sombras e luz para dar sensação de espaço ao redor de uma mesa física. Mantenha nomes, faces, contadores e estados das cartas legíveis.
- Anime ações que representem movimentos reconhecíveis de uma partida, como comprar, mover, virar, selecionar e inspecionar uma carta. Prefira movimento breve, com início e término claros, que mantenha o estado final fácil de perceber.
- Remova palavras dispensáveis dos controles quando um símbolo comum deixar a ação clara: por exemplo, `+` para adicionar. Mantenha um rótulo visível quando o símbolo for ambíguo ou as consequências da ação precisarem de explicação.
- Controles compostos apenas por ícones precisam de nome acessível e, quando necessário, ajuda contextual. Preserve foco visível e uso por teclado e toque.
- Respeite a preferência de movimento reduzido e confira os layouts estreitos. Estados importantes não devem depender exclusivamente de animação, cor ou interação com ponteiro.
- Preserve a distinção entre ações permitidas e indisponíveis e não revele na interface cartas ou dados de zonas privadas a outros jogadores.

## Desempenho e validação

- Mantenha efeitos de luz, transparência, sombra e transformação compatíveis com a fluidez da mesa; escolha tratamentos mais leves quando efeitos ou movimentos afetarem a resposta dos controles.
- Acione também `$performance` quando a proposta envolver custo de renderização, movimento contínuo, muitas cartas, carregamento de imagens ou comportamento diferente por dispositivo.
- Verifique a mudança no fluxo real da partida em desktop e em uma tela estreita ou com toque, conforme a área afetada. Confirme legibilidade, estados da interação, nomes acessíveis e movimento reduzido quando aplicável.
