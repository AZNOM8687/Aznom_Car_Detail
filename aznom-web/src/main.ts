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

@Component({
  selector: 'aznom-app',
  templateUrl: './app.html',
  styles: [`
    .form-conta { display: grid; gap: 1rem; max-width: 32rem; margin-block: 1rem; }
    .form-conta label { display: grid; gap: .4rem; }
    .form-conta input, .form-conta select {
      width: 100%; padding: .65rem; font: inherit; border: 1px solid #61735c; border-radius: .35rem;
    }
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
  protected readonly itensAgenda = signal<ItemAgenda[]>([]);
  protected readonly editando = signal<ItemAgenda | null>(null);
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
        if (this.telaAgenda || this.telaPainel) this.carregarAgenda();
      },
      error: erro => this.falha(erro),
    });
  }

  protected sair(): void {
    this.ocupado.set(true);
    this.http.post('/api/sair', {}, { headers: this.cabecalhos }).subscribe({
      next: () => {
        this.conta.set(null);
        this.itensAgenda.set([]);
        this.editando.set(null);
        this.selecaoAgenda.set('');
        this.mensagem.set('');
        this.ocupado.set(false);
      },
      error: erro => this.falha(erro),
    });
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
          if (this.telaAgenda || this.telaPainel) this.carregarAgenda();
        },
        error: erro => {
          this.carregandoConta.set(false);
          if (erro.status !== 401) this.falha(erro);
        },
      });
    } else if (!this.telaGaleria) {
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
