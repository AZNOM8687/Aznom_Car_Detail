import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';

import { DadosPagamento, PagamentoEditor } from './recebimentos';

export interface VeiculoCadastrado {
  id: number;
  modelo: string;
  placa: string | null;
  atendimentos: number;
  ultimo: string | null;
}

interface Matricula extends DadosPagamento {
  id: number;
  nome: string;
  telefone: string;
  inicio: string;
  fim: string;
  cancelada: boolean;
}

interface Resumo {
  dia: string;
  total_hoje: number;
  proximos: { id: number; cliente: string; servico: string; hora: string }[];
  orcamentos_aguardando: number;
  comentarios_pendentes?: number;
  retiradas_hoje?: number;
  turmas_proximas?: number;
  turmas: { id: number; inicio: string; fim: string; vagas: number; espera: number }[];
}

export const opcoesGestao = { headers: { 'X-Aznom': '1' }, timeout: 8000 };
const dataBr = (data: string) => data.split('-').reverse().join('/');
const mensagemErro = (erro: HttpErrorResponse, padrao: string) => erro.error?.mensagem || padrao;

@Component({
  selector: 'aznom-matriculas',
  imports: [PagamentoEditor],
  styleUrl: './operacao.css',
  template: `
    <h2 id="titulo-matriculas">Matrículas</h2>
    @if (turmas().length) {
      <form #formulario class="form-conta" (submit)="matricular($event, formulario)">
        <h3>Matrícula direta</h3>
        <label>Turma com vagas
          <select name="agendaId" required>
            <option value="">Selecione a turma</option>
            @for (turma of turmas(); track turma.id) {
              <option [value]="turma.id">{{ dataBr(turma.inicio) }} a {{ dataBr(turma.fim) }} · {{ turma.vagas }} {{ turma.vagas === 1 ? 'vaga' : 'vagas' }}</option>
            }
          </select>
        </label>
        <label>Nome do aluno <input name="nome" maxlength="100" required></label>
        <label>WhatsApp com DDD <input name="telefone" type="tel" maxlength="25" required></label>
        <button class="botao" type="submit" [disabled]="ocupado()">Confirmar matrícula direta</button>
      </form>
    } @else {
      <p>Nenhuma turma aberta para matrícula direta.</p>
    }

    @if (mensagem()) { <p role="status">{{ mensagem() }}</p> }
    <div class="grade">
      @for (item of itens(); track item.id) {
        <article class="card card-texto" [id]="'matricula-' + item.id">
          <h3>{{ item.nome }}</h3>
          <p>{{ dataBr(item.inicio) }} a {{ dataBr(item.fim) }} · {{ item.cancelada ? 'Cancelada' : 'Matriculada' }}</p>
          <aznom-pagamento [dados]="item" [caminho]="url + '/' + item.id + '/pagamento'" (atualizado)="pagamentoAtualizado()"></aznom-pagamento>
          @if (!item.cancelada) {
            <button class="botao botao-secundario" type="button" [disabled]="ocupado()" (click)="cancelar(item)">Cancelar matrícula</button>
          }
        </article>
      } @empty {
        @if (!ocupado() && !mensagem()) { <p>Nenhuma matrícula registrada.</p> }
      }
    </div>
  `,
})
export class MatriculasPainel {
  private readonly http = inject(HttpClient);
  readonly url = '/api/admin/matriculas';
  readonly turmas = input.required<{ id: number; inicio: string; fim: string; vagas: number }[]>();
  readonly pagamentoAlterado = output<void>();
  readonly revisao = input.required<number>();
  readonly alterada = output<void>();
  readonly itens = signal<Matricula[]>([]);
  readonly ocupado = signal(false);
  readonly mensagem = signal('');
  readonly dataBr = dataBr;
  private consulta = 0;

  constructor() { effect(() => { this.revisao(); this.carregar(); }); }

  carregar(): void {
    const consulta = ++this.consulta;
    this.ocupado.set(true);
    this.http.get<Matricula[]>(this.url, { timeout: 5000 }).subscribe({
      next: itens => {
        if (consulta !== this.consulta) return;
        this.itens.set(itens);
        this.ocupado.set(false);
      },
      error: erro => {
        if (consulta !== this.consulta) return;
        this.mensagem.set(mensagemErro(erro, 'Não foi possível carregar as matrículas.'));
        this.ocupado.set(false);
      },
    });
  }

  pagamentoAtualizado(): void {
    this.carregar();
    this.pagamentoAlterado.emit();
  }

  matricular(evento: Event, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const dados = new FormData(formulario);
    this.ocupado.set(true);
    this.mensagem.set('');
    this.http.post(this.url + '/direta', {
      agendaId: Number(dados.get('agendaId')), nome: dados.get('nome'), telefone: dados.get('telefone'),
    }, opcoesGestao).subscribe({
      next: () => {
        formulario.reset();
        this.mensagem.set('Matrícula direta confirmada.');
        this.alterada.emit();
        this.carregar();
      },
      error: erro => {
        this.mensagem.set(mensagemErro(erro, 'Não foi possível confirmar esta matrícula.'));
        this.ocupado.set(false);
        if (erro.status === 409) this.alterada.emit();
      },
    });
  }

  cancelar(item: Matricula): void {
    if (!window.confirm('Cancelar a matrícula de ' + item.nome + ' e liberar a vaga?')) return;
    this.ocupado.set(true);
    this.mensagem.set('');
    this.http.patch(this.url + '/' + item.id + '/cancelar', {}, opcoesGestao).subscribe({
      next: () => {
        this.mensagem.set('Matrícula cancelada. A vaga foi liberada.');
        this.carregar();
        this.alterada.emit();
      },
      error: erro => {
        this.mensagem.set(mensagemErro(erro, 'Não foi possível cancelar a matrícula.'));
        this.carregar();
      },
    });
  }
}

@Component({
  selector: 'aznom-veiculos',
  styleUrl: './operacao.css',
  template: `
    <h2 id="titulo-veiculos">Veículos cadastrados</h2>
    @if (mensagem()) { <p role="status">{{ mensagem() }}</p> }
    <label class="form-conta">Buscar por placa ou modelo
      <input type="search" #busca (input)="filtro.set(busca.value)">
    </label>
    <div class="grade">
      @for (item of filtrados(); track item.id) {
        <article class="card card-texto">
          <h3>{{ item.modelo }}</h3>
          <p>{{ item.placa ?? 'Sem placa cadastrada' }} · {{ item.atendimentos }} {{ item.atendimentos === 1 ? 'atendimento' : 'atendimentos' }}</p>
          @if (item.ultimo) { <p>Registro mais recente: {{ dataBr(item.ultimo) }}</p> }
          <div class="acoes">
            <button class="botao" type="button" (click)="verHistorico.emit(item.id)">Ver histórico do veículo</button>
            <button class="botao botao-secundario" type="button" [disabled]="ocupado()" (click)="editando.set(item.id)">Editar cadastro</button>
          </div>
          @if (editando() === item.id) {
            <form #formulario class="form-conta" (submit)="salvar($event, item, formulario)">
              <label>Modelo <input name="modelo" maxlength="100" required [value]="item.modelo"></label>
              <label>Placa (opcional) <input name="placa" maxlength="12" [value]="item.placa ?? ''"></label>
              <div class="acoes">
                <button class="botao" type="submit" [disabled]="ocupado()">Salvar cadastro</button>
                <button class="botao botao-secundario" type="button" [disabled]="ocupado()" (click)="editando.set(null)">Fechar edição</button>
              </div>
            </form>
          }
        </article>
      } @empty {
        <p>{{ filtro() ? 'Nenhum veículo corresponde à busca.' : 'Cadastre ou vincule um veículo na ficha de um atendimento.' }}</p>
      }
    </div>
  `,
})
export class VeiculosPainel {
  private readonly http = inject(HttpClient);
  readonly itens = input.required<VeiculoCadastrado[]>();
  readonly alterado = output<void>();
  readonly verHistorico = output<number>();
  readonly filtro = signal('');
  readonly editando = signal<number | null>(null);
  readonly ocupado = signal(false);
  readonly mensagem = signal('');
  readonly dataBr = dataBr;
  readonly filtrados = computed(() => {
    const termo = this.filtro().trim().toUpperCase();
    return this.itens().filter(item => item.modelo.toUpperCase().includes(termo) ||
      (item.placa ?? '').includes(termo.replace(/[ -]/g, '')));
  });

  salvar(evento: Event, item: VeiculoCadastrado, formulario: HTMLFormElement): void {
    evento.preventDefault();
    this.ocupado.set(true);
    this.mensagem.set('');
    const dados = new FormData(formulario);
    this.http.patch('/api/admin/veiculos/' + item.id, {
      modelo: dados.get('modelo'), placa: dados.get('placa'),
    }, opcoesGestao).subscribe({
      next: () => {
        this.editando.set(null);
        this.ocupado.set(false);
        this.mensagem.set('Veículo atualizado.');
        this.alterado.emit();
      },
      error: erro => {
        this.ocupado.set(false);
        this.mensagem.set(mensagemErro(erro, 'Não foi possível atualizar o veículo.'));
      },
    });
  }
}

@Component({
  selector: 'aznom-resumo',
  template: `
    <div class="painel-secao-topo">
      <div><h2 id="titulo-resumo">Resumo do dia</h2>
        @if (dados(); as resumo) { <p>{{ dataBr(resumo.dia) }}</p> }
      </div>
      <button class="botao botao-secundario" type="button" [disabled]="ocupado()" (click)="carregar()">Atualizar resumo</button>
    </div>
    @if (ocupado()) { <p class="estado-painel" role="status">Carregando resumo do dia…</p> }
    @if (mensagem()) { <p class="estado-painel" role="status">{{ mensagem() }}</p> }
    @if (dados(); as resumo) {
      <div class="painel-indicadores">
        <article><h3>Atendimentos restantes hoje</h3><strong>{{ resumo.total_hoje }}</strong><a href="./?tela=painel#painel-agenda">Abrir agenda</a></article>
        <article><h3>Orçamentos aguardando resposta</h3><strong>{{ resumo.orcamentos_aguardando }}</strong><a href="./?tela=painel#painel-orcamentos">Abrir orçamentos</a></article>
        @if (resumo.retiradas_hoje !== undefined) {
          <article><h3>Retiradas previstas hoje</h3><strong>{{ resumo.retiradas_hoje }}</strong><a href="./?tela=painel#painel-atendimentos">Abrir atendimentos</a></article>
          <article><h3>Depoimentos pendentes</h3><strong>{{ resumo.comentarios_pendentes }}</strong><a href="./?tela=painel&amp;secao=depoimentos">Revisar depoimentos</a></article>
          <article><h3>Turmas nos próximos 7 dias</h3><strong>{{ resumo.turmas_proximas }}</strong><a href="./?tela=painel#painel-turmas">Abrir turmas</a></article>
        }
      </div>
      <div class="grade painel-detalhes">
        <article class="card card-texto">
          <h3>Próximos atendimentos</h3>
          <ul>
            @for (item of resumo.proximos; track item.id) {
              <li><button class="botao botao-secundario" type="button" (click)="verAtendimento.emit(item.id)">
                {{ item.hora }} · {{ item.cliente }} · {{ item.servico }}
              </button></li>
            } @empty { <li>Nenhum atendimento confirmado para o restante do dia.</li> }
          </ul>
        </article>
        <article class="card card-texto">
          <h3>Turmas com vaga e lista de espera</h3>
          <ul>
            @for (item of resumo.turmas; track item.id) {
              <li>{{ dataBr(item.inicio) }} a {{ dataBr(item.fim) }} · {{ item.vagas }} {{ item.vagas === 1 ? 'vaga' : 'vagas' }} · {{ item.espera }} na espera</li>
            } @empty { <li>Nenhuma turma com vagas e pessoas na espera.</li> }
          </ul>
          <a href="./?tela=painel#painel-espera">Abrir lista de espera</a>
        </article>
      </div>
    }
  `,
})
export class ResumoPainel {
  private readonly http = inject(HttpClient);
  readonly revisao = input.required<number>();
  readonly verAtendimento = output<number>();
  readonly dados = signal<Resumo | null>(null);
  readonly ocupado = signal(false);
  readonly mensagem = signal('');
  readonly dataBr = dataBr;
  private consulta = 0;

  constructor() { effect(() => { this.revisao(); this.carregar(); }); }

  carregar(): void {
    const consulta = ++this.consulta;
    this.ocupado.set(true);
    this.mensagem.set('');
    this.http.get<Resumo>('/api/admin/resumo', { timeout: 5000 }).subscribe({
      next: dados => {
        if (consulta !== this.consulta) return;
        this.dados.set(dados);
        this.ocupado.set(false);
      },
      error: erro => {
        if (consulta !== this.consulta) return;
        this.mensagem.set(erro.status === 500
          ? 'O servidor não conseguiu consultar o resumo. Confira os logs da API no Render.'
          : mensagemErro(erro, 'Não foi possível carregar o resumo. Tente atualizar.'));
        this.ocupado.set(false);
      },
    });
  }
}
