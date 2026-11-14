# AZNOM CAR DETAIL

- `aznom-api/` — API Node.js que consulta o PostgreSQL.
- `aznom-web/` — site Angular com página inicial e catálogo responsivo.

## Como rodar no Windows

Use Node.js 22.12 ou superior na linha 22, ou Node.js 24. Extraia o ZIP e abra a pasta principal `aznom-car-detail` no VS Code. O PostgreSQL precisa estar rodando com o banco `aznom_db` e a tabela `public.servicos` já criada no pgAdmin.

### Terminal 1 — API

No PowerShell, a partir da pasta principal:

```powershell
cd aznom-api
Copy-Item .env.example .env
```

Abra `aznom-api/.env` no VS Code, informe sua senha do PostgreSQL e ajuste a porta ou o usuário se necessário. Em seguida:

```powershell
npm.cmd ci
npm.cmd start
```

Teste em http://127.0.0.1:3000/api/servicos. O endereço deve exibir os serviços ativos em JSON.

### Terminal 2 — Site

Com o primeiro terminal aberto, crie outro pelo menu **Terminal → Novo Terminal**. A partir da pasta principal:

```powershell
cd aznom-web
npm.cmd ci
npm.cmd start
```

Abra http://127.0.0.1:4200. O catálogo usa a API através do proxy de desenvolvimento do Angular.

Esta versão inclui página inicial e catálogo. Login, área do cliente, agendamentos e painel administrativo são etapas futuras.

## Se o catálogo não carregar

Se o terminal do Angular mostrar `ECONNREFUSED 127.0.0.1:3000`, inicie a API com `npm.cmd start` em um terminal aberto na pasta `aznom-api`. Mantenha os dois terminais abertos. Quando http://127.0.0.1:3000/api/servicos exibir os serviços em JSON, clique em **Tentar novamente** no site.

## Galeria, curso e agendamento

A página abre o WhatsApp com mensagens diferentes para serviços e para o curso de uma semana. As datas e horários são combinados na conversa. O catálogo usa o PostgreSQL quando a API responde e mostra uma lista inicial quando a API está indisponível. As imagens ilustrativas ficam identificadas na galeria.
