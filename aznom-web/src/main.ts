import { HttpClient, provideHttpClient } from '@angular/common/http';
import { afterNextRender, Component, computed, inject, Injector, OnInit, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';

import { catalogoInicial, ilustracoes } from './catalogo';
import { FichaAtendimento, FichaVeiculo, InteresseTurma, ListaEspera, Orcamentos } from './operacao';

import { MatriculasPainel, ResumoPainel, VeiculoCadastrado, VeiculosPainel } from './gestao';

import { dataHoraEntrega, etapasEntrega } from './entrega';
import { ResumoMensal } from './recebimentos';

interface Conta {
  email: string;
  papel: 'cliente' | 'admin';
}

interface DetalhesTurma {
  valor?: number;
  local?: string;
  requisitos?: string;
  inclusos?: string;
}

interface Depoimento {
  id: number;
  autor: string;
  servico: string;
  texto: string;
  publicado?: boolean;
}

interface ItemAgenda {
  id: number;
  tipo: 'servicos' | 'cursos';
  inicio: string;
  fim: string | null;
  hora: string | null;
  detalhes: DetalhesTurma;
}

interface ItemAgendaPublico extends ItemAgenda {
  vagas: number;
}

interface ItemAgendaAdmin extends ItemAgenda {
  capacidade: number;
  matriculadas: number;
  livre: boolean;
  confirmadas: number;
}

interface Atendimento extends FichaAtendimento {
  agenda_id: number | null;
  status: 'confirmado' | 'concluido' | 'cancelado';
  reagendamentos: { anterior: string; novo: string }[];
}

interface Servico {
  id: number;
  nome: string;
  descricao: string;
  imagem_url: string | null;
}

interface FotoGaleria {
  id: number;
  legenda: string;
}

interface ServicoAdmin {
  id: number;
  nome: string;
  descricao: string;
  ativo: boolean;
}

const fusoAgenda = 'America/Sao_Paulo';
const diaLocal = () => new Intl.DateTimeFormat('sv-SE', { timeZone: fusoAgenda }).format(new Date());
function deslocarDia(data: string, dias: number): string {
  const dia = new Date(data + 'T12:00:00Z');
  dia.setUTCDate(dia.getUTCDate() + dias);
  return dia.toISOString().slice(0, 10);
}
function segundaDaSemana(data: string): string {
  const dia = new Date(data + 'T12:00:00Z').getUTCDay();
  return deslocarDia(data, -((dia + 6) % 7));
}

@Component({
  selector: 'aznom-app',
  imports: [FichaVeiculo, InteresseTurma, ListaEspera, Orcamentos, MatriculasPainel, ResumoPainel, VeiculosPainel, ResumoMensal],
  templateUrl: './app.html',
  styles: [`
    .form-conta { display: grid; gap: 1rem; max-width: 32rem; margin-block: 1rem; }
    .form-conta label { display: grid; gap: .4rem; }
    .form-conta input, .form-conta select, .form-conta textarea {
      width: 100%; padding: .65rem; font: inherit; border: 1px solid #61735c; border-radius: .35rem;
    }
    .form-conta input[type="checkbox"] { width: auto; justify-self: start; }
    .filtros-semana { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 1rem; }
    .filtros-semana label { display: grid; gap: .35rem; }
    .linha-semana { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-block: .35rem; }
    .detalhes-turma { margin-block: .65rem; }
    .detalhes-turma dt { font-weight: 700; }
    .detalhes-turma dd { margin: 0 0 .5rem; white-space: pre-line; overflow-wrap: anywhere; }
    blockquote { margin-inline: 0; overflow-wrap: anywhere; }
    .agenda-tabela { margin-top: 1.5rem; overflow-x: auto; }
    .agenda-tabela table { width: 100%; border-collapse: collapse; background: #1b211c; }
    .agenda-tabela caption { margin-bottom: .75rem; text-align: left; font-weight: 700; }
    .agenda-tabela th, .agenda-tabela td { padding: .75rem; border-bottom: 1px solid #39443a; text-align: left; }
    .agenda-tabela th { background: #253428; color: #c6f277; }
    .agenda-tabela .linha-selecionada { background: #253428; }
    .agenda-tabela input { accent-color: #c6f277; }
  `],
})
class App implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly injector = inject(Injector);
  protected readonly servicos = signal<Servico[]>([]);
  protected readonly estado = signal<'carregando' | 'pronto' | 'reserva'>('carregando');

  private readonly parametros = new URLSearchParams(window.location.search);
  private readonly tela = this.parametros.get('tela');
  protected readonly telaCurso = this.tela === 'curso';
  protected readonly telaGaleria = this.tela === 'galeria';
  protected readonly telaAgenda = this.tela === 'agenda' || this.telaCurso;

  protected readonly telaConta = this.tela === 'conta';
  protected readonly telaPainel = this.tela === 'painel';
  protected readonly conta = signal<Conta | null>(null);
  protected readonly cadastro = signal(false);
  protected readonly carregandoConta = signal(true);
  protected readonly ocupado = signal(false);
  protected readonly mensagem = signal('');
  protected readonly mensagemGoogle = new Map([
    ['indisponivel', 'O acesso com Google ainda não foi configurado.'],
    ['cancelado', 'Você cancelou o acesso com Google.'],
    ['conta-existente', 'Já existe uma conta AZNOM com este e-mail. Entre com a senha do site.'],
    ['falha', 'Não foi possível entrar com Google. Tente novamente.'],
  ]).get(new URLSearchParams(window.location.search).get('google') ?? '');
  protected readonly itensAgenda = signal<ItemAgendaPublico[]>([]);
  protected readonly agendaAdmin = signal<ItemAgendaAdmin[]>([]);
  protected readonly semana = signal(segundaDaSemana(diaLocal()));
  protected readonly filtroSemana = signal('todos');
  protected readonly agendaSemanal = signal<ItemAgendaAdmin[]>([]);
  protected readonly semanaOcupada = signal(false);
  protected readonly mensagemSemana = signal('');
  protected readonly diasSemana = computed(() => Array.from({ length: 7 }, (_, indice) => {
    const data = deslocarDia(this.semana(), indice);
    const itens = this.agendaSemanal().filter(item =>
      item.inicio <= data && (item.fim ?? item.inicio) >= data &&
      (this.filtroSemana() === 'todos' || this.filtroSemana() === this.situacaoAgenda(item)),
    );
    return { data, itens };
  }));
  protected readonly reagendando = signal<Atendimento | null>(null);
  protected readonly horariosLivres = computed(() => this.agendaAdmin().filter(item => item.livre));
  protected readonly depoimentos = signal<Depoimento[]>([]);
  protected readonly depoimentosPorServico = computed(() => {
    const porServico = new Map<string, Depoimento[]>();
    for (const item of this.depoimentos()) {
      const lista = porServico.get(item.servico) ?? [];
      lista.push(item);
      porServico.set(item.servico, lista);
    }
    return porServico;
  });
  protected readonly depoimentoEditando = signal<Depoimento | null>(null);
  protected readonly depoimentosOcupados = signal(false);
  protected readonly mensagemDepoimento = signal('');
  protected readonly reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  protected readonly dataSemana = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit',
  });

  protected readonly atendimentos = signal<Atendimento[]>([]);
  protected readonly revisaoResumo = signal(0);
  protected readonly revisaoFinanceiro = signal(0);
  protected readonly dataHoraEntrega = dataHoraEntrega;
  protected readonly etapasEntrega = etapasEntrega;
  protected readonly turmasAbertas = computed(() => this.agendaAdmin()
    .filter(item => item.tipo === 'cursos' && item.fim && item.confirmadas < item.capacidade)
    .map(item => ({ id: item.id, inicio: item.inicio, fim: item.fim!, vagas: item.capacidade - item.confirmadas })));
  protected readonly revisaoMatriculas = signal(0);
  protected readonly veiculos = signal<VeiculoCadastrado[]>([]);
  protected readonly mensagemVeiculos = signal('');
  protected readonly veiculoHistorico = signal<number | null>(null);
  protected readonly veiculoFiltrado = computed(() => this.veiculos().find(item => item.id === this.veiculoHistorico()));
  protected readonly filtroAtendimento = signal('');
  protected readonly fichaSelecionada = signal<number | null>(null);
  protected readonly atendimentosFiltrados = computed(() => {
    const termo = this.filtroAtendimento().trim().toLocaleLowerCase('pt-BR');
    const placa = termo.toLocaleUpperCase('pt-BR').replace(/[ -]/g, '');
    return this.atendimentos().filter(item =>
      (this.veiculoHistorico() === null || item.veiculo_id === this.veiculoHistorico()) &&
      ([item.cliente, item.veiculo, item.modelo_cadastrado].join(' ').toLocaleLowerCase('pt-BR').includes(termo) ||
        (!!placa && item.placa?.includes(placa))),
    );
  });
  protected readonly atendimentosOcupados = signal(false);
  protected readonly mensagemAtendimento = signal('');
  protected readonly horarioAtendimento = signal<ItemAgendaAdmin | null>(null);
  protected readonly atendimentosPorHorario = computed(() => new Map(
    this.atendimentos().filter(item => item.status !== 'cancelado').map(item => [item.agenda_id, item]),
  ));
  protected readonly rotulosAtendimento = {
    confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado',
  };
  protected readonly editando = signal<ItemAgendaAdmin | null>(null);
  protected readonly fotoEditando = signal<FotoGaleria | null>(null);
  protected readonly versaoFotos = signal(0);
  protected readonly fotosGaleria = signal<FotoGaleria[]>([]);
  protected readonly galeriaOcupada = signal(false);
  protected readonly mensagemGaleria = signal('');
  protected readonly servicosAdmin = signal<ServicoAdmin[]>([]);
  protected readonly servicoEditando = signal<ServicoAdmin | null>(null);
  protected readonly catalogoOcupado = signal(false);
  protected readonly mensagemCatalogo = signal('');
  private readonly cabecalhos = { 'X-Aznom': '1' };

  protected readonly abaAgenda = signal<'servicos' | 'cursos'>(this.telaCurso ? 'cursos' : 'servicos');
  protected readonly selecaoAgenda = signal('');
  protected readonly turmaEspera = signal<number | null>(null);
  protected readonly opcaoEspera = computed(() => this.opcoesAgenda().find(item => item.id === this.turmaEspera()));
  protected readonly servicoOrcamento = signal((this.parametros.get('servico') ?? '').slice(0, 100));
  protected readonly veiculoOrcamento = signal('');
  protected readonly opcoesAgenda = computed(() =>
    this.itensAgenda().filter(item => item.tipo === this.abaAgenda()).map(item => {
      const primeiraColuna = this.dataBr(item.inicio);
      const segundaColuna = item.fim ? this.dataBr(item.fim) : item.hora;
      const separador = item.tipo === 'servicos' ? ' às ' : ' a ';
      return { id: item.id, detalhes: item.detalhes, vagas: item.vagas, primeiraColuna, segundaColuna, rotulo: primeiraColuna + separador + segundaColuna };
    }),
  );

  protected dataBr(data: string): string {
    return data.split('-').reverse().join('/');
  }

  protected alternarCadastro(): void {
    this.cadastro.update(valor => !valor);
    this.mensagem.set('');
  }

  protected autenticar(evento: Event, email: string, senha: string): void {
    evento.preventDefault();
    const rota = this.cadastro() ? 'cadastro' : 'login';
    this.ocupado.set(true);
    this.mensagem.set('');
    this.http.post<Conta>('/api/' + rota, { email, senha }, { headers: this.cabecalhos }).subscribe({
      next: conta => {
        this.ocupado.set(false);
        this.conta.set(conta);
        if (this.telaPainel && conta.papel === 'admin') {
          this.carregarAgendaAdmin();
          this.carregarAtendimentos();
          this.carregarVeiculos();
          this.carregarDepoimentos();
          this.carregarCatalogoAdmin();
          this.carregarFotos();
        }
      },
      error: erro => this.falha(erro),
    });
  }

  protected sair(): void {
    this.ocupado.set(true);
    this.http.post('/api/sair', {}, { headers: this.cabecalhos }).subscribe({
      next: () => {
        this.conta.set(null);
        this.limparCatalogoAdmin();
        this.agendaAdmin.set([]);
        this.editando.set(null);
        this.selecaoAgenda.set('');
        this.mensagem.set('');
        this.ocupado.set(false);
      },
      error: erro => this.falha(erro),
    });
  }

  private limparCatalogoAdmin(): void {
    this.agendaSemanal.set([]);
    this.reagendando.set(null);
    this.fichaSelecionada.set(null);
    this.veiculos.set([]);
    this.veiculoHistorico.set(null);
    this.mensagemVeiculos.set('');
    this.filtroAtendimento.set('');
    this.depoimentos.set([]);
    this.depoimentoEditando.set(null);
    this.mensagemDepoimento.set('');
    this.atendimentos.set([]);
    this.horarioAtendimento.set(null);
    this.mensagemAtendimento.set('');
    this.servicosAdmin.set([]);
    this.servicoEditando.set(null);
    this.mensagemCatalogo.set('');
    this.fotosGaleria.set([]);
    this.fotoEditando.set(null);
    this.mensagemGaleria.set('');
  }

  protected carregarFotos(): void {
    this.galeriaOcupada.set(true);
    this.http.get<FotoGaleria[]>('/api/galeria', { timeout: 8000 }).subscribe({
      next: fotos => {
        this.fotosGaleria.set(fotos);
        this.galeriaOcupada.set(false);
      },
      error: () => {
        this.galeriaOcupada.set(false);
        this.mensagemGaleria.set('Não foi possível carregar as fotos adicionadas pelo painel.');
      },
    });
  }

  protected editarFoto(foto: FotoGaleria, legenda: HTMLInputElement, arquivo: HTMLInputElement): void {
    this.fotoEditando.set(foto);
    this.mensagemGaleria.set('');
    legenda.value = foto.legenda;
    arquivo.value = '';
    legenda.focus();
  }

  protected cancelarEdicaoFoto(formulario: HTMLFormElement): void {
    this.fotoEditando.set(null);
    formulario.reset();
  }

  protected enviarFoto(evento: Event, legenda: string, foto?: File): void {
    evento.preventDefault();
    const id = this.fotoEditando()?.id;
    if ((!foto && !id) || (foto && (!['image/jpeg', 'image/png', 'image/webp'].includes(foto.type) || foto.size > 3 * 1024 * 1024))) {
      this.mensagemGaleria.set('Selecione uma imagem JPG, PNG ou WebP de até 3 MB.');
      return;
    }

    const url = '/api/galeria';
    const headers = this.cabecalhos;
    const params = { legenda };
    const pedido = id
      ? (foto ? this.http.put(url + '/' + id, foto, { headers, params })
              : this.http.patch(url + '/' + id, { legenda }, { headers }))
      : this.http.post(url, foto, { headers, params });

    this.galeriaOcupada.set(true);
    this.mensagemGaleria.set('');
    pedido.subscribe({
      next: () => {
        this.cancelarEdicaoFoto(evento.target as HTMLFormElement);
        if (id && foto) this.versaoFotos.update(versao => versao + 1);
        this.mensagemGaleria.set(id ? 'Foto atualizada.' : 'Foto publicada na galeria.');
        this.carregarFotos();
      },
      error: erro => this.falhaGaleria(erro),
    });
  }

  protected removerFoto(id: number): void {
    if (!window.confirm('Remover esta foto da galeria?')) return;
    this.galeriaOcupada.set(true);
    this.mensagemGaleria.set('');
    this.http.delete('/api/galeria/' + id, { headers: this.cabecalhos }).subscribe({
      next: () => {
        this.mensagemGaleria.set('Foto removida.');
        this.carregarFotos();
      },
      error: erro => this.falhaGaleria(erro),
    });
  }

  private falhaGaleria(erro: { status?: number; error?: { mensagem?: string } }): void {
    this.galeriaOcupada.set(false);
    if (erro.status === 401) {
      this.falha(erro);
      return;
    }
    this.mensagemGaleria.set(erro.error?.mensagem || 'Não foi possível atualizar a galeria.');
  }

  protected carregarCatalogoAdmin(): void {
    this.catalogoOcupado.set(true);
    this.http.get<ServicoAdmin[]>('/api/admin/servicos').subscribe({
      next: servicos => {
        this.servicosAdmin.set(servicos);
        this.catalogoOcupado.set(false);
      },
      error: erro => this.falhaCatalogo(erro),
    });
  }

  protected salvarServico(formulario: HTMLFormElement, evento: Event): void {
    evento.preventDefault();
    const campos = new FormData(formulario);
    const dados = {
      nome: campos.get('nome'),
      descricao: campos.get('descricao'),
      ativo: campos.has('ativo'),
    };
    const id = this.servicoEditando()?.id;
    const url = '/api/admin/servicos';
    const opcoes = { headers: this.cabecalhos };
    const pedido = id ? this.http.put(url + '/' + id, dados, opcoes) : this.http.post(url, dados, opcoes);

    this.catalogoOcupado.set(true);
    this.mensagemCatalogo.set('');
    pedido.subscribe({
      next: () => {
        this.cancelarEdicaoServico(formulario);
        this.mensagemCatalogo.set('Serviço salvo.');
        this.carregarCatalogoAdmin();
      },
      error: erro => this.falhaCatalogo(erro),
    });
  }

  protected cancelarEdicaoServico(formulario: HTMLFormElement): void {
    formulario.reset();
    this.servicoEditando.set(null);
  }

  private falhaCatalogo(erro: { status?: number; error?: { mensagem?: string } }): void {
    this.catalogoOcupado.set(false);
    if (erro.status === 401) {
      this.falha(erro);
      return;
    }
    this.mensagemCatalogo.set(erro.error?.mensagem || 'Não foi possível carregar ou salvar o catálogo.');
  }

  protected carregarAgenda(): void {
    this.ocupado.set(true);
    this.mensagem.set('');
    this.selecaoAgenda.set('');
    this.turmaEspera.set(null);
    this.http.get<ItemAgendaPublico[]>('/api/agenda', { timeout: 5000 }).subscribe({
      next: itens => {
        this.itensAgenda.set(itens);
        this.ocupado.set(false);
      },
      error: erro => this.falha(erro),
    });
  }

  private carregarAgendaAdmin(): void {
    this.atualizarResumo();
    this.carregarSemana();
    this.ocupado.set(true);
    this.http.get<ItemAgendaAdmin[]>('/api/admin/agenda', { timeout: 5000 }).subscribe({
      next: itens => {
        this.agendaAdmin.set(itens);
        this.revisaoMatriculas.update(valor => valor + 1);
        this.ocupado.set(false);
      },
      error: erro => this.falha(erro),
    });
  }

  protected situacaoAgenda(item: ItemAgendaAdmin): string {
    if (item.tipo === 'cursos') return 'turma';
    return this.atendimentosPorHorario().get(item.id)?.status ?? (item.confirmadas ? 'confirmado' : 'livre');
  }

  protected selecionarSemana(data: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data.startsWith('0000') ||
        !Number.isFinite(Date.parse(data + 'T12:00:00Z'))) return;
    this.semana.set(segundaDaSemana(data));
    this.carregarSemana();
  }

  protected moverSemana(dias: number): void {
    this.selecionarSemana(deslocarDia(this.semana(), dias));
  }

  private ultimaConsultaSemana = 0;

  protected carregarSemana(): void {
    const consulta = ++this.ultimaConsultaSemana;
    this.semanaOcupada.set(true);
    this.mensagemSemana.set('');
    this.http.get<ItemAgendaAdmin[]>('/api/admin/agenda', {
      params: { semana: this.semana() }, timeout: 5000,
    }).subscribe({
      next: itens => {
        if (consulta !== this.ultimaConsultaSemana || !this.conta()) return;
        this.agendaSemanal.set(itens);
        this.semanaOcupada.set(false);
      },
      error: () => {
        if (consulta !== this.ultimaConsultaSemana || !this.conta()) return;
        this.semanaOcupada.set(false);
        this.mensagemSemana.set('Não foi possível carregar esta semana.');
      },
    });
  }

  protected rotuloDataHora(valor: string): string {
    const [data, hora] = valor.split(' ');
    return this.dataBr(data) + ' às ' + hora;
  }

  protected rotuloDiaSemana(data: string): string {
    return this.dataSemana.format(new Date(data + 'T12:00:00Z'));
  }

  protected iniciarReagendamento(item: Atendimento): void {
    this.reagendando.set(item);
    this.mensagemAtendimento.set('');
    afterNextRender(() => {
      const formulario = document.getElementById('form-reagendar');
      formulario?.scrollIntoView({ block: 'center' });
      formulario?.querySelector('select')?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  protected reagendar(evento: Event, item: Atendimento, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const agendaId = Number(new FormData(formulario).get('novoHorario'));
    if (!agendaId) return;
    this.atendimentosOcupados.set(true);
    this.mensagemAtendimento.set('');
    this.http.patch('/api/admin/atendimentos/' + item.id + '/reagendar',
      { agendaId, agendaAnterior: item.agenda_id }, { headers: this.cabecalhos }).subscribe({
      next: () => {
        this.reagendando.set(null);
        this.mensagemAtendimento.set('Atendimento reagendado.');
        this.carregarAtendimentos();
        this.carregarAgendaAdmin();
      },
      error: erro => {
        if (erro.status === 409) this.reagendando.set(null);
        this.falhaAtendimento(erro);
      },
    });
  }

  protected carregarDepoimentos(): void {
    const url = this.telaPainel ? '/api/admin/depoimentos' : '/api/depoimentos';
    this.depoimentosOcupados.set(true);
    this.http.get<Depoimento[]>(url, { timeout: 5000 }).subscribe({
      next: itens => {
        if (!this.telaPainel || this.conta()?.papel === 'admin') this.depoimentos.set(itens);
        this.depoimentosOcupados.set(false);
      },
      error: () => {
        this.depoimentosOcupados.set(false);
        this.mensagemDepoimento.set('Não foi possível carregar os depoimentos.');
      },
    });
  }

  protected fotoDoServico(servico: string): string | undefined {
    if (servico === 'Restauração de faróis') return 'farol-real';
    return this.ilustracoes.find(foto => foto.servico === servico)?.arquivo;
  }

  protected iniciarDepoimento(item: Depoimento, formulario: HTMLFormElement): void {
    formulario.reset();
    this.depoimentoEditando.set(item);
    for (const campo of ['autor', 'servico', 'texto'] as const) {
      (formulario.elements.namedItem(campo) as HTMLInputElement | HTMLTextAreaElement).value = item[campo];
    }
    (formulario.elements.namedItem('publicado') as HTMLInputElement).checked = !!item.publicado;
    (formulario.elements.namedItem('autor') as HTMLInputElement).focus();
  }

  protected salvarDepoimento(evento: Event, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const campos = new FormData(formulario);
    const dados = {
      autor: campos.get('autor'), servico: campos.get('servico'), texto: campos.get('texto'),
      publicado: campos.has('publicado'), autorizado: campos.has('autorizado'),
    };
    const id = this.depoimentoEditando()?.id;
    const url = '/api/admin/depoimentos';
    const opcoes = { headers: this.cabecalhos };
    const pedido = id ? this.http.put(url + '/' + id, dados, opcoes) : this.http.post(url, dados, opcoes);
    this.depoimentosOcupados.set(true);
    this.mensagemDepoimento.set('');
    pedido.subscribe({
      next: () => {
        formulario.reset();
        this.depoimentoEditando.set(null);
        this.mensagemDepoimento.set(dados.publicado ? 'Depoimento publicado.' : 'Depoimento salvo como rascunho.');
        this.carregarDepoimentos();
      },
      error: erro => {
        this.depoimentosOcupados.set(false);
        this.mensagemDepoimento.set(erro.error?.mensagem || 'Não foi possível salvar o depoimento.');
      },
    });
  }

  protected carregarAtendimentos(): void {
    this.atualizarFinanceiro();
    this.atendimentosOcupados.set(true);
    this.http.get<Atendimento[]>('/api/admin/atendimentos', { timeout: 5000 }).subscribe({
      next: itens => {
        this.atendimentos.set(itens);
        this.atendimentosOcupados.set(false);
      },
      error: erro => this.falhaAtendimento(erro),
    });
  }

  protected atualizarResumo(): void {
    this.revisaoResumo.update(valor => valor + 1);
  }

  protected atualizarFinanceiro(): void {
    this.revisaoFinanceiro.update(valor => valor + 1);
  }

  protected matriculaAlterada(): void {
    this.atualizarFinanceiro();
    this.carregarAgendaAdmin();
  }

  protected carregarVeiculos(): void {
    this.mensagemVeiculos.set('');
    this.http.get<VeiculoCadastrado[]>('/api/admin/veiculos', { timeout: 5000 }).subscribe({
      next: itens => {
        if (this.conta()?.papel === 'admin') this.veiculos.set(itens);
      },
      error: () => this.mensagemVeiculos.set('Não foi possível carregar os veículos.'),
    });
  }

  protected verHistoricoVeiculo(id: number): void {
    this.veiculoHistorico.set(id);
    this.filtroAtendimento.set('');
    afterNextRender(() => document.getElementById('titulo-atendimentos')?.scrollIntoView({ block: 'center' }),
      { injector: this.injector });
  }

  protected aposConversao(): void {
    this.carregarAtendimentos();
    this.carregarAgendaAdmin();
  }

  protected abrirAtendimento(id: number): void {
    this.veiculoHistorico.set(null);
    this.filtroAtendimento.set('');
    afterNextRender(() => document.getElementById('atendimento-' + id)?.scrollIntoView({ block: 'center' }),
      { injector: this.injector });
  }

  protected mensagemCliente(item: Atendimento, tipo: 'confirmacao' | 'lembrete' | 'reagendamento' | 'retirada'): string {
    const atual = this.dataBr(item.data) + ' às ' + item.hora;
    const mudanca = item.reagendamentos[item.reagendamentos.length - 1];
    const saldo = item.valor_centavos === null ? null
      : item.valor_centavos - item.sinal_centavos - item.restante_pago_centavos;
    const retirada = item.previsao_entrega ? ' A previsão de retirada é ' + dataHoraEntrega(item.previsao_entrega) + '.'
      : ' Podemos combinar o horário de retirada por aqui.';
    const textos = {
      confirmacao: `Confirmamos o atendimento de ${item.servico} do seu ${item.veiculo} em ${atual}.`,
      lembrete: `Passando para lembrar do atendimento do seu ${item.veiculo} em ${atual}.`,
      reagendamento: `Seu atendimento do ${item.veiculo} foi reagendado${mudanca ? ' de ' + this.rotuloDataHora(mudanca.anterior) : ''} para ${atual}.`,
      retirada: `Seu ${item.modelo_cadastrado ?? item.veiculo} está pronto para retirada.${retirada}` +
        (saldo !== null && saldo > 0 ? ' O saldo pendente é ' + this.reais.format(saldo / 100) + '.' : ''),
    };
    return 'https://wa.me/' + item.telefone + '?text=' + encodeURIComponent(`Olá, ${item.cliente}! Aqui é da AZNOM. ${textos[tipo]}`);
  }

  protected iniciarAtendimento(item: ItemAgendaAdmin, formulario: HTMLFormElement): void {
    formulario.reset();
    this.horarioAtendimento.set(item);
    this.mensagemAtendimento.set('');
    afterNextRender(() => {
      formulario.scrollIntoView({ block: 'center' });
      (formulario.elements.namedItem('cliente') as HTMLInputElement).focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  protected registrarAtendimento(evento: Event, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const horario = this.horarioAtendimento();
    if (!horario) return;
    const campos = new FormData(formulario);
    const dados = {
      agendaId: horario.id,
      cliente: campos.get('cliente'),
      veiculo: campos.get('veiculo'),
      servico: campos.get('servico'),
      telefone: campos.get('telefone'),
    };
    this.atendimentosOcupados.set(true);
    this.mensagemAtendimento.set('');
    this.http.post('/api/admin/atendimentos', dados, { headers: this.cabecalhos }).subscribe({
      next: () => {
        formulario.reset();
        this.horarioAtendimento.set(null);
        this.mensagemAtendimento.set('Atendimento confirmado.');
        this.carregarAtendimentos();
        this.carregarAgendaAdmin();
      },
      error: erro => this.falhaAtendimento(erro),
    });
  }

  protected atualizarAtendimento(item: Atendimento, status: 'concluido' | 'cancelado'): void {
    if (status === 'cancelado' && !window.confirm('Cancelar este atendimento e liberar o horário?')) return;
    this.atendimentosOcupados.set(true);
    this.mensagemAtendimento.set('');
    this.http.patch('/api/admin/atendimentos/' + item.id, { status }, { headers: this.cabecalhos }).subscribe({
      next: () => {
        if (this.reagendando()?.id === item.id) this.reagendando.set(null);
        this.mensagemAtendimento.set(status === 'concluido' ? 'Atendimento concluído.' : 'Atendimento cancelado.');
        this.carregarAtendimentos();
        this.carregarAgendaAdmin();
      },
      error: erro => this.falhaAtendimento(erro),
    });
  }

  private falhaAtendimento(erro: { status?: number; error?: { mensagem?: string } }): void {
    this.atendimentosOcupados.set(false);
    if (erro.status === 401) {
      this.falha(erro);
      return;
    }
    this.mensagemAtendimento.set(erro.error?.mensagem || 'Não foi possível acessar os atendimentos.');
    if (erro.status === 409) {
      this.carregarAtendimentos();
      this.carregarAgendaAdmin();
    }
  }

  protected alterarConfirmacoes(item: ItemAgendaAdmin, novo: number): void {
    this.ocupado.set(true);
    this.mensagem.set('');
    this.http.patch('/api/agenda/' + item.id + '/confirmacoes',
      { atual: item.confirmadas, novo }, { headers: this.cabecalhos }).subscribe({
      next: () => {
        this.mensagem.set(novo > item.confirmadas ? 'Confirmação registrada.' : 'Confirmação desfeita.');
        this.carregarAgendaAdmin();
      },
      error: erro => {
        this.falha(erro);
        if (erro.status === 409) this.carregarAgendaAdmin();
      },
    });
  }

  protected editarDisponibilidade(item: ItemAgendaAdmin, formulario: HTMLFormElement): void {
    this.editando.set(item);
    this.mensagem.set('');
    const tipo = formulario.elements.namedItem('tipo') as HTMLSelectElement;
    const inicio = formulario.elements.namedItem('inicio') as HTMLInputElement;
    const hora = formulario.elements.namedItem('hora') as HTMLInputElement;
    const fim = formulario.elements.namedItem('fim') as HTMLInputElement;
    tipo.value = item.tipo;
    inicio.value = item.inicio;
    hora.value = item.hora ?? '';
    fim.value = item.fim ?? '';
    (formulario.elements.namedItem('capacidade') as HTMLInputElement).value = String(item.capacidade);
    for (const campo of ['valor', 'local', 'requisitos', 'inclusos'] as const) {
      const controle = formulario.elements.namedItem(campo) as HTMLInputElement | HTMLTextAreaElement;
      controle.value = String(item.detalhes[campo] ?? '');
    }
    tipo.focus();
  }

  protected cancelarEdicaoAgenda(formulario: HTMLFormElement): void {
    formulario.reset();
    this.editando.set(null);
  }

  protected salvarItem(evento: Event, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const id = this.editando()?.id;
    const campos = new FormData(formulario);
    const dados = {
      tipo: campos.get('tipo'), inicio: campos.get('inicio'), fim: campos.get('fim'),
      hora: campos.get('hora'), capacidade: Number(campos.get('capacidade')),
      detalhes: {
        valor: campos.get('valor'), local: campos.get('local'),
        requisitos: campos.get('requisitos'), inclusos: campos.get('inclusos'),
      },
    };
    const opcoes = { headers: this.cabecalhos };
    const pedido = id
      ? this.http.put('/api/agenda/' + id, dados, opcoes)
      : this.http.post('/api/agenda', dados, opcoes);
    this.ocupado.set(true);
    this.mensagem.set('');
    pedido.subscribe({
      next: () => {
        (evento.target as HTMLFormElement).reset();
        this.editando.set(null);
        this.mensagem.set('Agenda atualizada.');
        this.carregarAgendaAdmin();
      },
      error: erro => this.falha(erro),
    });
  }

  protected removerItem(id: number): void {
    if (!window.confirm('Remover esta disponibilidade da agenda?')) return;
    this.ocupado.set(true);
    this.mensagem.set('');
    this.http.delete('/api/agenda/' + id, { headers: this.cabecalhos }).subscribe({
      next: () => {
        if (this.editando()?.id === id) this.editando.set(null);
        this.mensagem.set('Disponibilidade removida.');
        this.carregarAgendaAdmin();
      },
      error: erro => this.falha(erro),
    });
  }

  private falha(erro: { status?: number; error?: { mensagem?: string } }): void {
    this.ocupado.set(false);
    if (erro.status === 401 && this.conta()) {
      this.conta.set(null);
      this.limparCatalogoAdmin();
      this.agendaAdmin.set([]);
      this.editando.set(null);
      this.selecaoAgenda.set('');
    }
    this.mensagem.set(erro.error?.mensagem || 'Não foi possível concluir. Confira se a API está rodando.');
  }

  protected trocarAbaAgenda(aba: 'servicos' | 'cursos'): void {
    if (this.abaAgenda() === aba) return;
    this.abaAgenda.set(aba);
    this.selecaoAgenda.set('');
    this.turmaEspera.set(null);
  }

  protected linkOrcamento(servico = ''): string {
    const parametros = new URLSearchParams({ tela: 'agenda' });
    if (servico) parametros.set('servico', servico);
    return './?' + parametros.toString();
  }

  protected solicitarOrcamento(evento: Event): void {
    evento.preventDefault();
    const veiculo = this.veiculoOrcamento().trim();
    const servico = this.servicoOrcamento().trim();
    if (!veiculo || !servico) return;
    const horario = this.selecaoAgenda();
    const linhas = [
      'Olá, AZNOM! Gostaria de solicitar um orçamento.',
      'Serviço: ' + servico,
      'Veículo: ' + veiculo,
    ];
    if (horario) linhas.push('Horário de preferência: ' + horario);
    window.location.assign(this.whatsapp(linhas.join('\n')));
  }

  protected solicitarAgenda(): string {
    return this.whatsapp(`Olá, AZNOM! Gostaria de consultar uma vaga na turma de ${this.selecaoAgenda()}.`);
  }

  protected readonly ilustracoes = ilustracoes;
  protected readonly contato = 'https://wa.me/5545999271987';
  protected readonly curso = this.whatsapp('Olá, AZNOM! Gostaria de saber as próximas datas, o valor e o que está incluso no curso de estética automotiva de uma semana.');

  protected whatsapp(mensagem: string): string {
    return this.contato + '?text=' + encodeURIComponent(mensagem);
  }

  ngOnInit(): void {
    if (this.telaAgenda) {
      this.carregarAgenda();
      if (!this.telaCurso) this.carregar();
    } else if (this.telaConta || this.telaPainel) {
      this.http.get<Conta>('/api/conta', { timeout: 5000 }).subscribe({
        next: conta => {
          this.conta.set(conta);
          this.carregandoConta.set(false);
          if (this.telaPainel && conta.papel === 'admin') {
            this.carregarAgendaAdmin();
            this.carregarAtendimentos();
            this.carregarVeiculos();
            this.carregarDepoimentos();
            this.carregarCatalogoAdmin();
            this.carregarFotos();
          }
        },
        error: erro => {
          this.carregandoConta.set(false);
          if (erro.status !== 401) this.falha(erro);
        },
      });
    } else if (this.telaGaleria) {
      this.carregarFotos();
      this.carregarDepoimentos();
    } else {
      this.carregar();
      this.carregarDepoimentos();
    }
  }

  protected carregar(): void {
    this.estado.set('carregando');
    this.http.get<Servico[]>('/api/servicos', { timeout: 5000 }).subscribe({
      next: (servicos) => {
        this.servicos.set(servicos);
        this.estado.set('pronto');
      },
      error: () => {
        this.servicos.set(catalogoInicial);
        this.estado.set('reserva');
      },
    });
  }
}

bootstrapApplication(App, {
  providers: [provideHttpClient(), provideZonelessChangeDetection()],
}).catch(console.error);
