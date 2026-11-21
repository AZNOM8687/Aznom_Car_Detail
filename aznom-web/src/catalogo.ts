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
  { arquivo: 'lavagem', servico: 'Lavagem técnica detalhada', titulo: 'Lavagem técnica — antes e depois' },
  { arquivo: 'higienizacao', servico: 'Higienização interna', titulo: 'Higienização interna — antes e depois' },
  { arquivo: 'polimento', servico: 'Polimento técnico', titulo: 'Polimento de pintura — antes e depois' },
  { arquivo: 'farois', servico: 'Restauração de faróis', titulo: 'Restauração de faróis — antes e depois' },
  { arquivo: 'vitrificacao', servico: 'Vitrificação de pintura', titulo: 'Aplicação de vitrificação na pintura' },
  { arquivo: 'politriz', servico: 'Polimento técnico', titulo: 'Politriz sobre o capô' },
  { arquivo: 'moto', servico: '', titulo: 'Lavagem de motocicleta' },
  { arquivo: 'colheitadeira', servico: '', titulo: 'Polimento de máquina agrícola' },
  { arquivo: 'estudio-azul', servico: '', titulo: 'Veículo azul em estúdio de detalhamento · imagem ilustrativa' },
  { arquivo: 'polimento-studio', servico: '', titulo: 'Polimento de pintura em estúdio · imagem ilustrativa' },
  { arquivo: 'interior-studio', servico: '', titulo: 'Aspiração e limpeza interna · imagem ilustrativa' },
  { arquivo: 'rodas-acabamento', servico: '', titulo: 'Acabamento de rodas · imagem ilustrativa' },
  { arquivo: 'lavagem-studio', servico: '', titulo: 'Lavagem manual com espuma · imagem ilustrativa' },
  { arquivo: 'lavagem-capo', servico: '', titulo: 'Lavagem detalhada do capô · imagem ilustrativa' },
  { arquivo: 'espuma-studio', servico: '', titulo: 'Aplicação de espuma na carroceria · imagem ilustrativa' },
  { arquivo: 'bancos-studio', servico: '', titulo: 'Limpeza de estofamento · imagem ilustrativa' },
  { arquivo: 'rodas-studio', servico: '', titulo: 'Detalhamento de roda com pincel · imagem ilustrativa' },
  { arquivo: 'polimento-vermelho', servico: '', titulo: 'Polimento de carroceria vermelha · imagem ilustrativa' },
  { arquivo: 'polimento-preto', servico: '', titulo: 'Polimento de capô preto · imagem ilustrativa' },
  { arquivo: 'couro-studio', servico: '', titulo: 'Limpeza de banco de couro · imagem ilustrativa' },
];
