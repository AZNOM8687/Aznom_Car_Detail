BEGIN;
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
