# HelderLabs ERP — Cliente Local

Abre o ERP a partir de um ícone no Ambiente de Trabalho. As páginas correm nesta
máquina; **os dados são os de produção**, acedidos por HTTPS através da API.

```
Ícone → launch.vbs → launcher.mjs → server.mjs (localhost:3400)
                                         │
                                    janela Edge/Chrome em modo aplicação
                                         │
                                    HTTPS → https://helderlabs.eu/api/*
                                         │
                                    PostgreSQL (Neon)
```

## Instalar

Clique direito em `install.ps1` → **Executar com o PowerShell**. Uma vez.

Requisito: Node.js instalado (https://nodejs.org).

## Usar

Duplo clique no ícone **HelderLabs ERP**. Abre uma janela sem barra de endereço,
com o ecrã de login. Fechar a janela encerra o cliente.

## O que este cliente é, e o que não é

**É** o mesmo ERP do `helderlabs.eu`, servido a partir desta máquina. Criar um
cliente aqui cria-o na base de dados online; abrir o site a seguir mostra-o lá.

**Não é** uma instalação independente. Não tem base de dados. Não conhece
credenciais de base de dados nem `DATABASE_URL`. Só sabe falar com a API por
HTTPS, exatamente como o browser.

Autenticação, validação de tenant, permissões e auditoria acontecem todas no
backend. Este processo serve ficheiros — nada mais.

## Configuração

| Variável | Omissão | Para quê |
|:--|:--|:--|
| `HELDERLABS_API_URL` | `https://helderlabs.eu` | API alvo |
| `HELDERLABS_LOCAL_PORT` | `3400` | Porta do cliente |
| `HELDERLABS_CLIENT_VERSION` | `1.2.0` | Versão reportada à API |

A porta tem de constar da allowlist de CORS do backend. A 3400 já está.

## Resolução de problemas

| Sintoma | Causa provável |
|:--|:--|
| "Node.js não encontrado" | Instalar de nodejs.org e reinstalar o atalho |
| "A porta 3400 já está ocupada" | O ERP já está aberto — procura na barra de tarefas |
| "Sem ligação ao servidor HelderLabs" | Sem internet, ou API em baixo |
| "É necessária uma atualização" | `git pull` no repositório; a API exige versão mais recente |
| Janela abre com barra de endereço | Edge e Chrome não encontrados; usou o browser por omissão |

## Ficheiros

| | |
|:--|:--|
| `server.mjs` | Servidor estático + geração do `config.js` |
| `launcher.mjs` | Arranque, espera, deteção de browser, encerramento |
| `launch.vbs` | Corre o launcher sem janela de consola |
| `install.ps1` | Cria o atalho |
| `helderlabs-erp.ico` | Ícone |
