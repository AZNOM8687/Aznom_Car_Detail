BEGIN;

CREATE TABLE IF NOT EXISTS public.servicos (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome varchar(100) NOT NULL UNIQUE,
    descricao text NOT NULL,
    imagem_url text,
    ativo boolean NOT NULL DEFAULT TRUE
);

INSERT INTO public.servicos (nome, descricao) VALUES
    ('Lavagem técnica detalhada', 'Lavagem técnica detalhada com descontaminação de pintura.'),
    ('Higienização interna', 'Limpeza de bancos, carpetes, tapetes e outras superfícies internas.'),
    ('Polimento comercial', 'Realce do brilho da pintura e redução de marcas superficiais.'),
    ('Polimento técnico', 'Correção de imperfeições na pintura conforme o estado do verniz.'),
    ('Polimento de vidros comercial', 'Melhoria do acabamento dos vidros e redução de marcas leves.'),
    ('Restauração de faróis', 'Recuperação da transparência de lentes opacas ou amareladas.'),
    ('Polimento técnico de vidros', 'Tratamento de marcas e riscos superficiais conforme avaliação.'),
    ('Polimento de metais', 'Recuperação do brilho e do acabamento de superfícies metálicas.'),
    ('Vitrificação de pintura', 'Aplicação de revestimento cerâmico para proteger a pintura.'),
    ('Vitrificação de plásticos', 'Aplicação de revestimento protetor em superfícies plásticas.')
ON CONFLICT (nome) DO NOTHING;

COMMIT;
