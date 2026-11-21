CREATE TABLE IF NOT EXISTS aznom_conteudo_curso (
  id integer PRIMARY KEY CHECK (id = 1),
  conteudo jsonb NOT NULL
);
