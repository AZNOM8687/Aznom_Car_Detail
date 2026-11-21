BEGIN;
CREATE TABLE IF NOT EXISTS aznom_contas (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  senha text NOT NULL,
  papel text NOT NULL DEFAULT 'cliente' CHECK (papel IN ('cliente', 'admin'))
);
CREATE TABLE IF NOT EXISTS aznom_sessoes (
  token text PRIMARY KEY,
  conta_id integer NOT NULL REFERENCES aznom_contas(id) ON DELETE CASCADE,
  expira timestamptz NOT NULL
);
ALTER TABLE aznom_contas ALTER COLUMN senha DROP NOT NULL;
ALTER TABLE aznom_contas ADD COLUMN IF NOT EXISTS google_sub text UNIQUE;
CREATE TABLE IF NOT EXISTS aznom_agenda (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo text NOT NULL,
  inicio date NOT NULL,
  fim date,
  hora time,
  CHECK ((tipo = 'servicos' AND hora IS NOT NULL AND fim IS NULL)
      OR (tipo = 'cursos' AND hora IS NULL AND fim IS NOT NULL AND fim >= inicio))
);
CREATE UNIQUE INDEX IF NOT EXISTS aznom_agenda_horarios ON aznom_agenda (inicio, hora) WHERE tipo = 'servicos';
CREATE UNIQUE INDEX IF NOT EXISTS aznom_agenda_turmas ON aznom_agenda (inicio, fim) WHERE tipo = 'cursos';
ALTER TABLE aznom_agenda
  ADD COLUMN IF NOT EXISTS capacidade integer NOT NULL DEFAULT 1
    CHECK (capacidade BETWEEN 1 AND 1000 AND (tipo = 'cursos' OR capacidade = 1)),
  ADD COLUMN IF NOT EXISTS confirmadas integer NOT NULL DEFAULT 0
    CHECK (confirmadas BETWEEN 0 AND capacidade);
ALTER TABLE aznom_agenda ADD COLUMN IF NOT EXISTS atendimento_registrado boolean NOT NULL DEFAULT false
  CHECK (NOT atendimento_registrado OR (tipo = 'servicos' AND confirmadas = 1));
CREATE TABLE IF NOT EXISTS aznom_atendimentos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agenda_id integer REFERENCES aznom_agenda(id) ON DELETE SET NULL,
  cliente varchar(100) NOT NULL,
  veiculo varchar(100) NOT NULL,
  servico varchar(100) NOT NULL,
  data date NOT NULL,
  hora time NOT NULL,
  status text NOT NULL DEFAULT 'confirmado' CHECK (status IN ('confirmado', 'concluido', 'cancelado'))
);
CREATE UNIQUE INDEX IF NOT EXISTS aznom_atendimentos_ativos
  ON aznom_atendimentos (agenda_id) WHERE status <> 'cancelado';
ALTER TABLE aznom_agenda ADD COLUMN IF NOT EXISTS detalhes jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS aznom_reagendamentos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  atendimento_id integer NOT NULL REFERENCES aznom_atendimentos(id),
  anterior timestamp NOT NULL,
  novo timestamp NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS aznom_depoimentos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  autor varchar(80) NOT NULL,
  servico varchar(100) NOT NULL,
  texto varchar(600) NOT NULL,
  publicado boolean NOT NULL DEFAULT false
);
ALTER TABLE aznom_atendimentos
  ADD COLUMN IF NOT EXISTS telefone varchar(13),
  ADD COLUMN IF NOT EXISTS servicos_realizados varchar(1200) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS observacoes_veiculo varchar(1200) NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS aznom_orcamentos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cliente varchar(100) NOT NULL,
  telefone varchar(13),
  veiculo varchar(100) NOT NULL,
  servico varchar(100) NOT NULL,
  valor_centavos integer CHECK (valor_centavos >= 0),
  status text NOT NULL DEFAULT 'recebido'
    CHECK (status IN ('recebido','enviado','aguardando','confirmado','encerrado')),
  atendimento_id integer UNIQUE REFERENCES aznom_atendimentos(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'confirmado') = (atendimento_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS aznom_lista_espera (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agenda_id integer NOT NULL REFERENCES aznom_agenda(id) ON DELETE CASCADE,
  nome varchar(100) NOT NULL,
  telefone varchar(13) NOT NULL,
  contatado boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agenda_id, telefone)
);
CREATE TABLE IF NOT EXISTS aznom_fotos_veiculo (
  atendimento_id integer NOT NULL REFERENCES aznom_atendimentos(id) ON DELETE CASCADE,
  etapa text NOT NULL CHECK (etapa IN ('antes', 'depois')),
  formato text NOT NULL CHECK (formato IN ('image/jpeg', 'image/png', 'image/webp')),
  dados bytea NOT NULL CHECK (octet_length(dados) <= 3145728),
  PRIMARY KEY (atendimento_id, etapa)
);
ALTER TABLE aznom_agenda ADD COLUMN IF NOT EXISTS matriculadas integer NOT NULL DEFAULT 0
  CHECK (matriculadas BETWEEN 0 AND confirmadas AND (tipo = 'cursos' OR matriculadas = 0));
CREATE TABLE IF NOT EXISTS aznom_veiculos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  modelo varchar(100) NOT NULL,
  placa varchar(7) UNIQUE CHECK (placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$')
);
ALTER TABLE aznom_atendimentos
  ADD COLUMN IF NOT EXISTS veiculo_id integer REFERENCES aznom_veiculos(id),
  ADD COLUMN IF NOT EXISTS valor_centavos integer CHECK (valor_centavos >= 0),
  ADD COLUMN IF NOT EXISTS sinal_centavos integer NOT NULL DEFAULT 0 CHECK (sinal_centavos >= 0),
  ADD COLUMN IF NOT EXISTS restante_pago_centavos integer NOT NULL DEFAULT 0
    CHECK (restante_pago_centavos >= 0 AND sinal_centavos::bigint + restante_pago_centavos <= coalesce(valor_centavos, 0));
CREATE INDEX IF NOT EXISTS aznom_atendimentos_veiculo ON aznom_atendimentos (veiculo_id);
CREATE TABLE IF NOT EXISTS aznom_matriculas (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  interesse_id integer REFERENCES aznom_lista_espera(id) ON DELETE SET NULL,
  agenda_id integer REFERENCES aznom_agenda(id) ON DELETE SET NULL,
  nome varchar(100) NOT NULL,
  telefone varchar(13) NOT NULL,
  inicio date NOT NULL,
  fim date NOT NULL,
  cancelada_em timestamptz,
  valor_centavos integer CHECK (valor_centavos >= 0),
  sinal_centavos integer NOT NULL DEFAULT 0 CHECK (sinal_centavos >= 0),
  restante_pago_centavos integer NOT NULL DEFAULT 0
    CHECK (restante_pago_centavos >= 0 AND sinal_centavos::bigint + restante_pago_centavos <= coalesce(valor_centavos, 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS aznom_matriculas_ativas
  ON aznom_matriculas (interesse_id) WHERE cancelada_em IS NULL;
ALTER TABLE aznom_atendimentos
  ADD COLUMN IF NOT EXISTS andamento text NOT NULL DEFAULT 'agendado'
    CHECK (andamento IN ('agendado','recebido','execucao','pronto')),
  ADD COLUMN IF NOT EXISTS previsao_entrega timestamp,
  ADD COLUMN IF NOT EXISTS entregue_em timestamptz,
  ADD COLUMN IF NOT EXISTS cuidados varchar(1200) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS aznom_matriculas_telefone_ativo
  ON aznom_matriculas (agenda_id, telefone) WHERE cancelada_em IS NULL;
CREATE TABLE IF NOT EXISTS aznom_recebimentos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  atendimento_id integer REFERENCES aznom_atendimentos(id),
  matricula_id integer REFERENCES aznom_matriculas(id),
  valor_centavos integer NOT NULL CHECK (valor_centavos > 0),
  tipo text NOT NULL CHECK (tipo IN ('sinal','saldo')),
  meio text NOT NULL CHECK (meio IN ('pix','dinheiro','credito','debito','transferencia','outro','legado')),
  data date,
  chave uuid UNIQUE,
  estornado_em timestamptz,
  CHECK ((atendimento_id IS NULL) <> (matricula_id IS NULL)),
  CHECK ((data IS NULL) = (meio = 'legado'))
);
CREATE INDEX IF NOT EXISTS aznom_recebimentos_atendimento ON aznom_recebimentos (atendimento_id);
CREATE INDEX IF NOT EXISTS aznom_recebimentos_matricula ON aznom_recebimentos (matricula_id);
CREATE INDEX IF NOT EXISTS aznom_recebimentos_data ON aznom_recebimentos (data);
INSERT INTO aznom_recebimentos (atendimento_id, matricula_id, valor_centavos, tipo, meio)
SELECT a.id, NULL::integer, p.valor, p.tipo, 'legado'
FROM aznom_atendimentos a
CROSS JOIN LATERAL (VALUES (a.sinal_centavos,'sinal'),(a.restante_pago_centavos,'saldo')) p(valor,tipo)
WHERE p.valor>0 AND NOT EXISTS (SELECT 1 FROM aznom_recebimentos r WHERE r.atendimento_id=a.id)
UNION ALL
SELECT NULL::integer, m.id, p.valor, p.tipo, 'legado'
FROM aznom_matriculas m
CROSS JOIN LATERAL (VALUES (m.sinal_centavos,'sinal'),(m.restante_pago_centavos,'saldo')) p(valor,tipo)
WHERE p.valor>0 AND NOT EXISTS (SELECT 1 FROM aznom_recebimentos r WHERE r.matricula_id=m.id);
CREATE TABLE IF NOT EXISTS aznom_conteudo_curso (
  id integer PRIMARY KEY CHECK (id = 1),
  conteudo jsonb NOT NULL
);
ALTER TABLE aznom_orcamentos
  ADD COLUMN IF NOT EXISTS conta_id integer REFERENCES aznom_contas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS horario_preferido varchar(120);
ALTER TABLE aznom_atendimentos
  ADD COLUMN IF NOT EXISTS conta_id integer REFERENCES aznom_contas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retorno_sugerido date;
CREATE INDEX IF NOT EXISTS aznom_atendimentos_conta ON aznom_atendimentos(conta_id);
CREATE TABLE IF NOT EXISTS aznom_fotos_orcamento (
  orcamento_id integer REFERENCES aznom_orcamentos(id) ON DELETE CASCADE,
  posicao integer CHECK (posicao BETWEEN 1 AND 3),
  formato text NOT NULL CHECK (formato IN ('image/jpeg','image/png','image/webp')),
  dados bytea NOT NULL CHECK (octet_length(dados) <= 1048576),
  PRIMARY KEY (orcamento_id, posicao)
);
COMMIT;
