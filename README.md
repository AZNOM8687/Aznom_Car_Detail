# AZNOM CAR DETAIL

Projeto Angular e Node.js com PostgreSQL. Inclui catálogo, galeria, curso, solicitação pelo WhatsApp, cadastro, login, agenda de serviços e turmas, e painel para administrar disponibilidades.

## 1. Prepare o PostgreSQL

No pgAdmin, conecte-se ao PostgreSQL. Use o banco `aznom_db` ou crie-o em **Databases → Create → Database**.

- **Banco novo:** no Query Tool do banco `aznom_db`, abra e execute `aznom-api/catalogo.sql`. Ele cria a tabela `servicos` e insere os dez cadastros iniciais.
- **Banco já usado:** se a tabela `servicos` já existe, siga diretamente para o próximo passo.
- Em ambos os casos, execute `aznom-api/agenda.sql` no mesmo banco. Esse script cria as tabelas de contas, sessões e disponibilidades.

## 2. Inicie a API no primeiro terminal

Extraia o ZIP e abra a pasta `aznom-car-detail` no VS Code. Use Node.js 22.12 ou superior na linha 22, ou Node.js 24. Em um terminal PowerShell aberto na pasta principal, execute:

```powershell
cd aznom-api
if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
}
```

Abra `aznom-api/.env` e preencha a senha do PostgreSQL. Ajuste também o nome do banco, a porta ou o usuário se sua instalação usar outros valores.

```powershell
npm.cmd ci
if ($LASTEXITCODE -eq 0) {
    npm.cmd start
}
```

Mantenha o terminal aberto. Confira se http://127.0.0.1:3000/api/servicos retorna o JSON do catálogo.

## 3. Inicie o Angular no segundo terminal

Abra outro PowerShell na pasta principal do projeto e rode:

```powershell
cd aznom-web
npm.cmd ci --include=dev
if ($LASTEXITCODE -eq 0) {
    npm.cmd start
}
```

Abra http://127.0.0.1:4200/. Se o Angular já estiver rodando e você precisar reinstalar as dependências, pare o processo anterior com **Ctrl+C** antes do `npm.cmd ci`, para liberar o esbuild.

## 4. Configure seu acesso administrativo

1. Abra http://127.0.0.1:4200/?tela=conta e clique em **Criar uma conta**. A senha deve ter pelo menos 10 caracteres.
2. No Query Tool de `aznom_db`, execute a consulta abaixo com o mesmo e-mail do cadastro.

```sql
UPDATE aznom_contas
SET papel = 'admin'
WHERE email = lower('SEU-EMAIL-AQUI')
RETURNING email, papel;
```

3. Atualize a página e abra **Painel administrativo**. Cadastre um horário de atendimento ou uma turma para que a agenda mostre as primeiras disponibilidades.
4. Abra http://127.0.0.1:4200/?tela=agenda e verifique as abas de serviços e cursos. Para conferir a experiência do cliente, teste com uma segunda conta comum.

A agenda é pública. Os clientes escolhem um horário ou uma turma e enviam a solicitação pelo WhatsApp. Após confirmar a reserva na conversa, marque o horário como ocupado ou confirme uma vaga da turma no painel. O site exibe só horários livres e turmas com vagas. Para serviços, use **Registrar atendimento** na agenda do painel e informe cliente, veículo e serviço. O histórico permite concluir ou cancelar o atendimento. Cancelar libera o horário se ele ainda estiver no futuro. Para turmas, use **Desfazer confirmação** para liberar uma vaga.

Os links do catálogo e do portfólio preenchem o serviço no formulário de orçamento. O visitante informa o veículo e pode escolher um horário antes de abrir o WhatsApp. A página do curso reúne o conteúdo e as turmas com vagas.

Ao atualizar uma instalação existente, reaplique `aznom-api/agenda.sql` antes de iniciar a nova versão da API. Horários e turmas de instalações que ainda não tinham o controle de vagas começam com capacidade de uma vaga e nenhuma confirmação. Se a instalação já controlava vagas, os valores existentes são preservados. É possível detalhar um horário já ocupado com **Registrar atendimento**.

## Publicação

Para oferecer cadastro, login e agenda no site público, a interface precisa de acesso à API Node.js e ao PostgreSQL. Neste projeto, a API também pode servir o Angular compilado pelo mesmo endereço HTTPS.

1. No ambiente de hospedagem, mantenha `aznom-web` e `aznom-api` como pastas irmãs. Em `aznom-web`, rode `npm ci --include=dev` e `npm run build`.
2. Em `aznom-api`, rode `npm ci` e use `npm start` como comando de inicialização. O servidor disponibiliza o build de `aznom-web/dist/aznom-web/browser` no mesmo endereço de `/api`.
3. Configure `HOST=0.0.0.0`, `NODE_ENV=production`, a porta fornecida pela plataforma e as variáveis de conexão do PostgreSQL no ambiente do servidor. Prepare o banco hospedado com os scripts SQL e configure o administrador nele.

### Netlify com API hospedada

1. Hospede a pasta `aznom-api` em um serviço Node.js com HTTPS. Use `npm ci` para instalar as dependências, `npm start` para iniciar e configure `HOST=0.0.0.0`, `NODE_ENV=production` e a conexão PostgreSQL. Em um banco novo, execute `catalogo.sql`, `agenda.sql` e `galeria.sql`. Em um banco existente, reaplique `agenda.sql` para atualizar a agenda e o login com Google.
2. Conecte o repositório ao site existente no Netlify. Configure `AZNOM_API_ORIGIN` no ambiente de build com a origem HTTPS do backend, sem o caminho `/api`. O `netlify.toml` na raiz compila o Angular e gera o proxy de `/api/*`. Verifique se o painel do Netlify usa essa configuração.
3. Após publicar, abra `https://aznomcardetail.netlify.app/api/conta` sem sessão. A resposta esperada é JSON com status 401.

### Acesso com Google

1. No Google Cloud, configure a tela de consentimento e crie um cliente OAuth do tipo **Aplicativo da Web**.
2. Cadastre `https://aznomcardetail.netlify.app/api/auth/google/callback` como URI de redirecionamento autorizada para produção. Para teste local, cadastre `http://localhost:4200/api/auth/google/callback` e abra o Angular pelo endereço `http://localhost:4200`.
3. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` no ambiente da API. Use exatamente a URI cadastrada no Google. Se a tela de consentimento estiver em teste, adicione os e-mails autorizados como usuários de teste.
4. Reinicie a API e teste **Entrar com Google**. Uma nova identidade cria uma conta de cliente e usa a mesma sessão da AZNOM. Se o e-mail já existir no cadastro com senha, entre com a senha do site. O fluxo do Google não vincula contas existentes automaticamente.

## Gerencie o catálogo e a agenda

No site local, entre com a conta de administrador e abra **Painel administrativo**.
Em **Catálogo de serviços**, cadastre ou edite nome e descrição. Desmarque
**Mostrar no catálogo** para ocultar um serviço. Na seção **Agenda**, cadastre,
edite ou remova horários de atendimento e datas de turmas. As mudanças são
gravadas no banco conectado à API. Esta atualização usa as tabelas existentes.

## Operação da agenda e publicação de depoimentos

- Em **Agenda**, use **Visão semanal** para navegar por data e filtrar horários sem reserva, atendimentos confirmados ou concluídos e turmas.
- Use **Reagendar** em um atendimento confirmado. Escolha outro horário livre. A agenda libera o horário anterior e o histórico guarda as duas datas. Avise o cliente pelo WhatsApp.
- Ao cadastrar ou editar uma turma, expanda **Detalhes opcionais da turma** para preencher valor em reais, local, pré-requisitos e o que está incluso. A página do curso mostra os campos preenchidos.
- Em **Depoimentos**, cadastre o texto com o serviço e o nome que o cliente autorizou exibir. Para publicar, marque **Exibir no site** e confirme a autorização. Para retirar um depoimento do site, edite-o e desmarque **Exibir no site**.

## Orçamentos, lista de espera e fichas de veículos

- Em **Orçamentos**, registre pedidos recebidos pelo WhatsApp, anote o valor e acompanhe a situação. Quando o cliente fechar, use **Converter em atendimento** e escolha um horário livre. Os dados são reaproveitados e o orçamento guarda o vínculo com o atendimento.
- Informe o WhatsApp com DDD no orçamento ou na ficha do atendimento. Use os botões de confirmação, lembrete e reagendamento para abrir a mensagem no WhatsApp e confira o texto antes de enviar.
- Turmas lotadas continuam visíveis. Quem autorizar o contato pode registrar interesse. Em **Lista de espera**, a equipe pode consultar as vagas, abrir a mensagem de aviso quando houver disponibilidade e marcar quem já foi contatado.
- Em **Histórico de atendimentos**, busque por cliente ou modelo. A ficha aceita serviços realizados, observações e uma foto de antes e uma de depois por atendimento, em JPG, PNG ou WebP de até 3 MB cada. As fichas e imagens ficam disponíveis apenas no painel administrativo.

## Matrículas, veículos, pagamentos e resumo do dia

- Quando uma pessoa da **Lista de espera** aceitar uma vaga, use **Confirmar matrícula**. O nome passa a constar em **Matrículas**. Cancelar uma matrícula preserva o registro e devolve uma vaga. Contagens de vagas confirmadas antes da atualização continuam registradas como confirmações manuais.
- Na ficha de um atendimento, expanda **Identificar este veículo** para vincular um cadastro existente ou criar um novo com placa opcional. Use **Veículos** para corrigir o cadastro e abrir todos os atendimentos vinculados.
- Em **Pagamento**, informe o valor combinado e registre cada recebimento como sinal ou pagamento do saldo. O valor do orçamento convertido ou da turma já vem preenchido quando cadastrado.
- O **Resumo do dia** usa o horário de São Paulo. Ele mostra os próximos atendimentos de hoje, a quantidade de orçamentos aguardando resposta e as turmas com vagas e pessoas na espera.

## Recebimentos, matrícula direta e entrega

- Registre cada recebimento na ficha do atendimento ou da matrícula, com valor, data e forma de pagamento. Use **Estornar registro** para corrigir uma entrada e liberar esse valor no saldo. Em **Recebimentos**, escolha um mês para ver entradas, estornos e entregas do período, além do saldo em aberto atual.
- A migração preserva valores recebidos anteriormente como registros sem data e sem forma de pagamento. Esses valores continuam abatendo o saldo. O relatório mensal usa somente movimentações com data e entregas registradas após a atualização.
- Em **Matrículas**, use **Matrícula direta** para inscrever alguém em uma turma com vagas. Se o telefone já estiver na lista de espera da turma, a matrícula também será vinculada ao interesse.
- Na ficha do veículo, abra **Andamento e entrega** para registrar a etapa, a previsão de retirada e os cuidados recomendados. Quando o veículo estiver pronto, o painel prepara o aviso no WhatsApp com a previsão e o saldo em aberto, se houver. Use **Marcar como entregue** para registrar a entrega efetiva.
- Em **Comprovante de entrega**, selecione as fotos que quer incluir e abra o documento. Use **Imprimir ou salvar em PDF** para gerar o arquivo que será compartilhado com o cliente.

## Adicione fotos pelo painel

No Query Tool do banco `aznom_db`, execute `aznom-api/galeria.sql` uma vez.
Reinicie a API e o Angular. Entre como administrador, abra **Painel administrativo**
e acesse **Galeria**. Preencha a legenda, escolha uma foto JPG, PNG ou WebP de
até 3 MB e clique em **Publicar foto**. Ela aparece junto das demais na galeria.
Use **Remover foto** para retirar uma imagem enviada pelo painel. As imagens já
incluídas no projeto continuam na grade. Para que o envio e as fotos do banco
funcionem no Netlify, a API e o PostgreSQL precisam estar hospedados.

Para atualizar uma foto enviada, clique em **Editar foto** no painel. Você pode
mudar só a legenda ou selecionar um arquivo novo para substituir a imagem.
Na seção **Agenda**, use **Editar disponibilidade** para mudar a data, o horário
ou o período de uma turma.
