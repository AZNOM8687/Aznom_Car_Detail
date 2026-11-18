import { HttpClient, provideHttpClient } from '@angular/common/http';
import { Component, computed, inject, OnInit, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';

import { catalogoInicial, ilustracoes } from './catalogo';

interface Conta {
  email: string;
  papel: 'cliente' | 'admin';
}

interface ItemAgenda {
  id: number;
  tipo: 'servicos' | 'cursos';
  inicio: string;
  fim: string | null;
  hora: string | null;
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

@Component({
  selector: 'aznom-app',
  templateUrl: './app.html',
  styles: [`
    .form-conta { display: grid; gap: 1rem; max-width: 32rem; margin-block: 1rem; }
    .form-conta label { display: grid; gap: .4rem; }
    .form-conta input, .form-conta select, .form-conta textarea {
      width: 100%; padding: .65rem; font: inherit; border: 1px solid #61735c; border-radius: .35rem;
    }
    .form-conta input[type="checkbox"] { width: auto; justify-self: start; }
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
  protected readonly servicos = signal<Servico[]>([]);
  protected readonly estado = signal<'carregando' | 'pronto' | 'reserva'>('carregando');

  private readonly tela = new URLSearchParams(window.location.search).get('tela');
  protected readonly telaGaleria = this.tela === 'galeria';
  protected readonly telaAgenda = this.tela === 'agenda';

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
  protected readonly itensAgenda = signal<ItemAgenda[]>([]);
  protected readonly editando = signal<ItemAgenda | null>(null);
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

  protected readonly abaAgenda = signal<'servicos' | 'cursos'>('servicos');
  protected readonly selecaoAgenda = signal('');
  protected readonly opcoesAgenda = computed(() =>
    this.itensAgenda().filter(item => item.tipo === this.abaAgenda()).map(item => {
      const primeiraColuna = this.dataBr(item.inicio);
      const segundaColuna = item.fim ? this.dataBr(item.fim) : item.hora;
      const separador = item.tipo === 'servicos' ? ' às ' : ' a ';
      return { id: item.id, primeiraColuna, segundaColuna, rotulo: primeiraColuna + separador + segundaColuna };
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
        if (this.telaAgenda || (this.telaPainel && conta.papel === 'admin')) this.carregarAgenda();
        if (this.telaPainel && conta.papel === 'admin') {
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
        this.itensAgenda.set([]);
        this.editando.set(null);
        this.selecaoAgenda.set('');
        this.mensagem.set('');
        this.ocupado.set(false);
      },
      error: erro => this.falha(erro),
    });
  }

  private limparCatalogoAdmin(): void {
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
    this.http.get<ItemAgenda[]>('/api/agenda').subscribe({
      next: itens => {
        this.itensAgenda.set(itens);
        this.ocupado.set(false);
      },
      error: erro => this.falha(erro),
    });
  }

  protected editarDisponibilidade(item: ItemAgenda, formulario: HTMLFormElement): void {
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
    tipo.focus();
  }

  protected cancelarEdicaoAgenda(formulario: HTMLFormElement): void {
    formulario.reset();
    this.editando.set(null);
  }

  protected salvarItem(evento: Event, tipo: string, inicio: string, fim: string, hora: string): void {
    evento.preventDefault();
    const id = this.editando()?.id;
    const dados = { tipo, inicio, fim, hora };
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
        this.carregarAgenda();
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
        this.carregarAgenda();
      },
      error: erro => this.falha(erro),
    });
  }

  private falha(erro: { status?: number; error?: { mensagem?: string } }): void {
    this.ocupado.set(false);
    if (erro.status === 401 && this.conta()) {
      this.conta.set(null);
      this.limparCatalogoAdmin();
      this.itensAgenda.set([]);
      this.editando.set(null);
      this.selecaoAgenda.set('');
    }
    this.mensagem.set(erro.error?.mensagem || 'Não foi possível concluir. Confira se a API está rodando.');
  }

  protected trocarAbaAgenda(aba: 'servicos' | 'cursos'): void {
    if (this.abaAgenda() === aba) return;
    this.abaAgenda.set(aba);
    this.selecaoAgenda.set('');
  }

  protected solicitarAgenda(): string {
    const opcao = this.selecaoAgenda();
    return this.whatsapp(
      this.abaAgenda() === 'servicos'
        ? `Olá, AZNOM! Gostaria de solicitar um atendimento em ${opcao}.`
        : `Olá, AZNOM! Gostaria de consultar uma vaga na turma de ${opcao}.`,
    );
  }

  protected readonly ilustracoes = ilustracoes;
  protected readonly contato = 'https://wa.me/5545999271987';
  protected readonly curso = this.whatsapp('Olá, AZNOM! Gostaria de saber as datas, os valores e a disponibilidade do curso de estética automotiva de uma semana.');

  protected whatsapp(mensagem: string): string {
    return this.contato + '?text=' + encodeURIComponent(mensagem);
  }

  ngOnInit(): void {
    if (this.telaConta || this.telaAgenda || this.telaPainel) {
      this.http.get<Conta>('/api/conta', { timeout: 5000 }).subscribe({
        next: conta => {
          this.conta.set(conta);
          this.carregandoConta.set(false);
          if (this.telaAgenda || (this.telaPainel && conta.papel === 'admin')) this.carregarAgenda();
          if (this.telaPainel && conta.papel === 'admin') {
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
    } else {
      this.carregar();
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
