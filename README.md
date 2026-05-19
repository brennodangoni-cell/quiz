# Cópia pública do quiz

Esta pasta contém uma cópia do que o navegador recebe publicamente em https://quiz.secajejumturbo.site/.

- `index.html`: entrada local do clone, apontando para os bundles em `/_next`.
- `_next/static/`: cópia local dos bundles JS/CSS/fontes públicos do app Next.js.
- `captured/funnel.json`: payload do funil decriptado a partir do HTML público.
- `captured/steps-summary.json`: resumo das 82 etapas e tipos de blocos.
- `captured/media-cache/`: 93 mídias referenciadas pelo funil baixadas para consulta/backup.
- `captured/original.html`: HTML bruto capturado.
- `captured/public-assets/`: arquivos públicos originais baixados para análise.
- `captured/formatted/`: versões formatadas dos JS/CSS públicos para leitura.
- `captured/clone-info.json`: relatório do clone, chunks dinâmicos e patches aplicados.
- `acelerador/index.html`: clone local do upsell público `sjt-upsell-1-b`.
- `ofertaespecial/index.html`: clone local do downsell público `sjt-downsell-1-b`.
- `offer-assets/`: assets públicos do WordPress/Elementor usados pelas páginas de oferta.
- `captured/offer-pages/`: HTML original das páginas de oferta e manifesto dos assets baixados.

O clone local usa o motor compilado real do quiz e recebeu um patch pequeno para permitir renderizar fora do domínio original. Para testar:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Depois abra `http://127.0.0.1:4173/`.

Rotas das ofertas:

- `http://127.0.0.1:4173/acelerador/`
- `http://127.0.0.1:4173/ofertaespecial/`

Checkouts configurados:

- Quiz/front: `https://pay.cakto.com.br/zxwkisn_890004`
- Upsell `/acelerador/`: `https://pay.cakto.com.br/354fsst_890464`
- Recusa do upsell: `https://secajejum.info/ofertaespecial`
- Downsell `/ofertaespecial/`: `https://pay.cakto.com.br/34x5vvy`
- Recusa do downsell: `https://www.cakto.com.br/`
