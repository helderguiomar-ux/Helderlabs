# Guia do Design System — HELDERLABS ERP (Caderno de Engenharia)

> **Diretrizes de Estilo, Paleta e Tipografia da Nova Landing Page & ERP**
> Versão: v0.3.0 | Data: 2026-09-07

---

## 🎨 1. Conceito e Direção Visual

A direção estética escolhida é o **Caderno de Engenharia**:
- Papel quadriculado em grelha milimétrica
- Tinta esferográfica azul (`--pen`) como acento primário
- Caneta de correção vermelha (`--red`) para destaques e notas à margem
- Linhas de caderno com réguas finas (`--rule` e `--rule-2`)
- **Zero emojis**, cantos com raio **2 px** (papel não tem cantos redondos)

---

## 🖌️ 2. Paleta de Tokens (Claro e Escuro)

### Modo Claro (`:root`)
```css
--paper:   #e9ece7;   /* Fundo principal com grelha */
--sheet:   #f7f8f5;   /* Superfície de cartão/folha */
--sheet-2: #eef0eb;   /* Superfície recuada */
--ink:     #191e1b;   /* Texto principal */
--ink-2:   #4e5a54;   /* Texto secundário */
--ink-3:   #7c887f;   /* Texto de apoio e etiquetas */
--rule:    #d3d9d2;   /* Linha divisória subtil */
--rule-2:  #bcc4bb;   /* Linha/Contorno forte */
--pen:     #17408b;   /* Esferográfica azul */
--red:     #a32b1c;   /* Caneta vermelha de anotação */
```

### Modo Escuro (`[data-theme="dark"]`)
```css
--paper:   #111517;
--sheet:   #191e21;
--sheet-2: #1f2528;
--ink:     #e9ede9;
--ink-2:   #a3aeaa;
--ink-3:   #77837e;
--rule:    #2b3235;
--rule-2:  #3b4448;
--pen:     #84aef2;
--red:     #e08a7c;
```

---

## 🔤 3. Tipografia

| Função | Família | Ficheiro/Google Fonts |
|---|---|---|
| Títulos | **Spectral** 500/600 | `font-family: var(--font-serif)` |
| Corpo & Interface | **Archivo** 400/500/600 | `font-family: var(--font-sans)` |
| Etiquetas & Dados | **IBM Plex Mono** 400/500 | `font-family: var(--font-mono); font-variant-numeric: tabular-nums;` |
| Anotações à Margem | **Caveat** 600 | `font-family: var(--font-handwriting)` *(Exclusivo da Landing Page)* |
