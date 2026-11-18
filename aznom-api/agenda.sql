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
COMMIT;
