---
name: performance
description: Investigue e melhore a fluidez e o uso de recursos do Magic Table, especialmente durante interações com a mesa, cartas, câmera e imagens.
---

# Performance do Magic Table

Ajude o Magic Table a responder com fluidez em computadores modestos, preservando controles, leitura das cartas e identidade visual. Considere 60 FPS durante as interações uma meta a medir no ambiente relevante, não uma garantia.

## Diagnóstico

- Antes de otimizar, localize o caminho de execução envolvido e obtenha uma medida reproduzível. Registre navegador ou Electron, dispositivo, dimensões da janela, quantidade de cartas, interação, duração e métricas observadas; compare o mesmo cenário antes e depois.
- Identifique a origem do custo: JavaScript, reatividade e renderizações do Vue, layout, pintura, composição, imagens, armazenamento ou rede. Não trate todo atraso como um problema de renderização.
- Para a mesa, considere movimento da câmera CSS 3D, arraste, mão, inspeção de cartas e zonas com muitas cartas. Evite medições de layout por carta em cada quadro, trabalho síncrono repetido e atualizações reativas quando o valor não mudou.
- Se os dados apontarem para um efeito visual caro, reduza seu custo sem tornar os controles lentos, ocultar informações ou descaracterizar a mesa.

## Soluções existentes

- Confira [docs/adaptive-images.md](../../../docs/adaptive-images.md) e os serviços de imagem antes de alterar carregamento, cache ou visibilidade. Preserve os tamanhos adaptativos, a fila compartilhada e priorizada, o cancelamento por consumidor, a decodificação antes da troca e a liberação de URLs temporárias, salvo se uma medição demonstrar um problema nessa solução.
- Preserve o limite de armazenamento e o descarte de cache existentes. Separe o custo de carregar e decodificar imagens do custo de exibi-las.
- Quando for relevante, use `/?stress=200` e o teste de cenário de estresse em [e2e/table.spec.ts](../../../e2e/table.spec.ts). O limite do teste de 150 MiB mede o heap JavaScript no Chromium; não mede FPS, memória total do Electron nem custo de GPU.
- Use [docs/adaptive-images.md](../../../docs/adaptive-images.md) e o benchmark optativo em [e2e/images-benchmark.spec.ts](../../../e2e/images-benchmark.spec.ts) para comparar tráfego e tarefas longas de imagens em condições equivalentes. Tarefas longas e bytes transferidos ajudam a explicar o carregamento, mas não estabelecem FPS.

## Verificação

- Escolha medições adequadas à hipótese: amostras de quadros para fluidez, heap para memória JavaScript, tarefas longas para bloqueios, ferramentas de desempenho do navegador para layout e pintura, e contagem ou bytes para carregamento de recursos.
- Confira o comportamento com uma mesa comum e com o cenário carregado, em desktop e em telas estreitas quando a mudança afetar ambos. Verifique também o modo de movimento reduzido para mudanças que envolvam animação.
- Informe o ambiente, a comparação e o que cada medida representa. Não alegue que o objetivo de 60 FPS foi atingido sem medi-lo no ambiente declarado.
