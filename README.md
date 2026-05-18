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

O clone local usa o motor compilado real do quiz e recebeu um patch pequeno para permitir renderizar fora do domínio original. Para testar:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Depois abra `http://127.0.0.1:4173/`.
