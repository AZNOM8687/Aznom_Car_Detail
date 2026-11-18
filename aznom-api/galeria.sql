CREATE TABLE IF NOT EXISTS public.aznom_fotos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legenda varchar(100) NOT NULL,
  formato text NOT NULL CHECK (formato IN ('image/jpeg', 'image/png', 'image/webp')),
  dados bytea NOT NULL CHECK (octet_length(dados) BETWEEN 1 AND 3145728)
);
