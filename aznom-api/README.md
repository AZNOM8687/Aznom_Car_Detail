# AZNOM CAR DETAIL — API do catálogo

A API lê os serviços ativos já cadastrados na tabela `public.servicos` do banco `aznom_db`.

## Rodar no Windows com o VS Code

1. Extraia o ZIP e abra a pasta `aznom-api` em **Arquivo → Abrir Pasta**.
2. Com o Node.js instalado, abra **Terminal → Novo Terminal**.
3. No PowerShell, execute `Copy-Item .env.example .env`. Abra o arquivo `.env` e substitua `SUA_SENHA_DO_POSTGRES` pela senha definida na instalação. Se necessário, ajuste o usuário e a porta para os valores do pgAdmin.
4. Execute `npm install` e depois `npm start`.
5. Abra http://127.0.0.1:3000/api/servicos. O navegador deve mostrar o catálogo em JSON. Quando um serviço ainda não tem foto, o campo `imagem_url` aparece como `null`.

Mantenha o terminal aberto enquanto testa. Se o PowerShell bloquear o script do npm, use `npm.cmd install` e `npm.cmd start`.

Se a rota retornar erro, veja a mensagem no terminal do VS Code. Confira se o PostgreSQL está rodando, se a senha e a porta conferem e se a tabela `public.servicos` existe no banco `aznom_db`. Após editar o `.env`, pare a API com **Ctrl+C** e rode `npm start` novamente.
