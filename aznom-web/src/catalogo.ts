const servicos = [
  ['Lavagem técnica detalhada', 'Lavagem técnica detalhada com descontaminação de pintura.'],
  ['Higienização interna', 'Limpeza de bancos, carpetes, tapetes e outras superfícies internas.'],
  ['Polimento comercial', 'Realce do brilho da pintura e redução de marcas superficiais.'],
  ['Polimento técnico', 'Correção de imperfeições na pintura conforme o estado do verniz.'],
  ['Polimento de vidros comercial', 'Melhoria do acabamento dos vidros e redução de marcas leves.'],
  ['Restauração de faróis', 'Recuperação da transparência de lentes opacas ou amareladas.'],
  ['Polimento técnico de vidros', 'Tratamento de marcas e riscos superficiais conforme avaliação.'],
  ['Polimento de metais', 'Recuperação do brilho e do acabamento de superfícies metálicas.'],
  ['Vitrificação de pintura', 'Aplicação de revestimento cerâmico para proteger a pintura.'],
  ['Vitrificação de plásticos', 'Aplicação de revestimento protetor em superfícies plásticas.'],
];

export const catalogoInicial = servicos.map(([nome, descricao], indice) => ({
  id: indice + 1,
  nome,
  descricao,
  imagem_url: null,
}));

export const ilustracoes = [
  { arquivo: 'lavagem', titulo: 'Lavagem técnica — antes e depois' },
  { arquivo: 'higienizacao', titulo: 'Higienização interna — antes e depois' },
  { arquivo: 'polimento', titulo: 'Polimento de pintura — antes e depois' },
  { arquivo: 'farois', titulo: 'Restauração de faróis — antes e depois' },
  { arquivo: 'vitrificacao', titulo: 'Aplicação de vitrificação na pintura' },
  { arquivo: 'politriz', titulo: 'Politriz sobre o capô' },
  { arquivo: 'moto', titulo: 'Lavagem de motocicleta' },
  { arquivo: 'colheitadeira', titulo: 'Polimento de máquina agrícola' },
];
