import { HttpClient } from '@angular/common/http';
import { afterNextRender, Component, effect, inject, Injector, input, OnInit, output, signal } from '@angular/core';

import { VeiculoCadastrado } from './gestao';
import { DadosPagamento, PagamentoEditor } from './recebimentos';
import { DadosEntrega, EntregaEditor } from './entrega';

interface Horario {
  id: number;
  inicio: string;
  hora: string | null;
}

interface Orcamento {
  id: number;
  cliente: string;
  telefone: string | null;
  veiculo: string;
  servico: string;
  valor_centavos: number | null;
  status: 'recebido' | 'enviado' | 'aguardando' | 'confirmado' | 'encerrado';
  atendimento_id: number | null;
  horario_preferido?: string;
  fotos?: number[];
}

interface Interesse {
  id: number;
  nome: string;
  telefone: string;
  inicio: string;
  fim: string;
  vagas: number;
  vigente: boolean;
  contatado: boolean;
  matricula_id: number | null;
}

type EtapaFoto = 'antes' | 'depois';

export interface FichaAtendimento extends DadosPagamento, DadosEntrega {
  cliente: string;
  telefone: string | null;
  veiculo_id: number | null;
  data: string;
  hora: string;
  observacoes_veiculo: string;
}

const opcoes = { headers: { 'X-Aznom': '1' }, timeout: 8000 };
const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (data: string) => data.split('-').reverse().join('/');
const whatsapp = (telefone: string, texto: string) => 'https://wa.me/' + telefone + '?text=' + encodeURIComponent(texto);

function campos(formulario: HTMLFormElement, nomes: string[]): Record<string, FormDataEntryValue | null> {
  const dados = new FormData(formulario);
  return Object.fromEntries(nomes.map(nome => [nome, dados.get(nome)]));
}

@Component({
  selector: 'aznom-orcamentos',
  styleUrl: './operacao.css',
  template: `
    <h2 id="titulo-orcamentos">Orçamentos</h2>
    <form #formulario class="form-conta" (submit)="salvar($event, formulario)">
      <h3>{{ editando() ? 'Editar orçamento' : 'Novo orçamento recebido pelo WhatsApp' }}</h3>
      <label>Cliente <input name="cliente" maxlength="100" required></label>
      <label>WhatsApp com DDD <input name="telefone" type="tel" maxlength="25"></label>
      <label>Modelo do veículo <input name="veiculo" maxlength="100" required></label>
      <label>Serviço <input name="servico" list="servicos-atendimento" maxlength="100" required></label>
      <label>Valor em reais <input name="valor" inputmode="decimal" maxlength="9" placeholder="Ex.: 250,00"></label>
      <label>Situação
        <select name="status">
          @for (status of etapas; track status) {
            <option [value]="status">{{ rotulos[status] }}</option>
          }
        </select>
      </label>
      <div class="acoes">
        <button class="botao" type="submit" [disabled]="ocupado()">Salvar orçamento</button>
        @if (editando()) {
          <button class="botao botao-secundario" type="button" [disabled]="ocupado()"
            (click)="formulario.reset(); editando.set(null)">Cancelar edição</button>
        }
      </div>
    </form>
    @if (mensagem()) {
      <p role="status">{{ mensagem() }}</p>
    }
    @if (convertendo(); as pedido) {
      <form id="form-converter-orcamento" #conversao class="form-conta" (submit)="converter($event, pedido, conversao)">
        <h3>Agendar para {{ pedido.cliente }}</h3>
        @if (horarios().length) {
          <label>Horário livre
            <select name="agendaId" required>
              <option value="">Selecione um horário</option>
              @for (horario of horarios(); track horario.id) {
                <option [value]="horario.id">{{ dataBr(horario.inicio) }} às {{ horario.hora }}</option>
              }
            </select>
          </label>
          <button class="botao" type="submit" [disabled]="ocupado()">Confirmar e criar atendimento</button>
        } @else {
          <p>Nenhum horário livre. Cadastre uma disponibilidade na agenda.</p>
        }
        <button class="botao botao-secundario" type="button" [disabled]="ocupado()" (click)="convertendo.set(null)">Fechar</button>
      </form>
    }
    <div class="grade">
      @for (item of itens(); track item.id) {
        <article class="card card-texto">
          <h3>{{ item.cliente }} · {{ item.servico }}</h3>
          <p>{{ item.veiculo }} · {{ rotulos[item.status] }}</p>
          @if (item.horario_preferido) { <p>Horário de preferência: {{ item.horario_preferido }}</p> }
          @for (posicao of item.fotos ?? []; track posicao) {
            <a class="botao botao-secundario" [href]="'/api/admin/orcamentos/' + item.id + '/fotos/' + posicao" target="_blank" rel="noopener">Foto {{ posicao }}</a>
          }
          @if (item.valor_centavos !== null) {
            <p>{{ reais.format(item.valor_centavos / 100) }}</p>
          }
          <div class="acoes">
            @if (item.atendimento_id) {
              <button class="botao botao-secundario" type="button" (click)="verAtendimento.emit(item.atendimento_id)">Ver atendimento</button>
            } @else {
              <button class="botao botao-secundario" type="button" [disabled]="ocupado()" (click)="editar(item, formulario)">Editar orçamento</button>
              @if (item.status !== 'encerrado') {
                <button class="botao" type="button" [disabled]="ocupado()" (click)="abrirConversao(item, formulario)">Converter em atendimento</button>
              }
            }
          </div>
        </article>
      } @empty {
        @if (!ocupado() && !mensagem()) { <p>Nenhum orçamento registrado.</p> }
      }
    </div>
  `,
})
export class Orcamentos implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/admin/orcamentos';
  readonly horarios = input.required<Horario[]>();
  readonly convertido = output<void>();
  readonly alterado = output<void>();
  readonly verAtendimento = output<number>();
  private readonly injector = inject(Injector);
  readonly itens = signal<Orcamento[]>([]);
  readonly editando = signal<Orcamento | null>(null);
  readonly convertendo = signal<Orcamento | null>(null);
  readonly ocupado = signal(false);
  readonly mensagem = signal('');
  readonly rotulos = { recebido: 'Recebido', enviado: 'Orçamento enviado', aguardando: 'Aguardando resposta',
    confirmado: 'Confirmado', encerrado: 'Encerrado' };
  readonly etapas = ['recebido', 'enviado', 'aguardando', 'encerrado'] as const;
  readonly dataBr = dataBr;
  readonly reais = reais;

  ngOnInit(): void {
    this.carregar();
  }

  private carregar(): void {
    this.ocupado.set(true);
    this.http.get<Orcamento[]>(this.url, { timeout: 5000 }).subscribe({
      next: itens => { this.itens.set(itens); this.ocupado.set(false); },
      error: erro => this.falha(erro),
    });
  }

  editar(item: Orcamento, formulario: HTMLFormElement): void {
    this.editando.set(item);
    this.convertendo.set(null);
    this.mensagem.set('');
    const valores = { cliente: item.cliente, telefone: item.telefone ?? '', veiculo: item.veiculo, servico: item.servico,
      valor: item.valor_centavos === null ? '' : (item.valor_centavos / 100).toFixed(2).replace('.', ','), status: item.status };
    for (const [nome, valor] of Object.entries(valores)) {
      (formulario.elements.namedItem(nome) as HTMLInputElement | HTMLSelectElement).value = valor;
    }
    formulario.scrollIntoView({ block: 'center' });
    (formulario.elements.namedItem('cliente') as HTMLInputElement).focus({ preventScroll: true });
  }

  salvar(evento: Event, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const id = this.editando()?.id;
    const dados = campos(formulario, ['cliente', 'telefone', 'veiculo', 'servico', 'valor', 'status']);
    const pedido = id ? this.http.put(this.url + '/' + id, dados, opcoes) : this.http.post(this.url, dados, opcoes);
    this.executar(pedido, 'Orçamento salvo.', () => {
      formulario.reset();
      this.editando.set(null);
      this.alterado.emit();
    });
  }

  abrirConversao(item: Orcamento, formulario: HTMLFormElement): void {
    formulario.reset();
    this.editando.set(null);
    this.convertendo.set(item);
    this.mensagem.set('');
    afterNextRender(() => {
      const formulario = document.getElementById('form-converter-orcamento');
      formulario?.scrollIntoView({ block: 'center' });
      formulario?.querySelector('select')?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  converter(evento: Event, item: Orcamento, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const agendaId = Number(new FormData(formulario).get('agendaId'));
    if (!agendaId) return;
    this.executar(this.http.post(this.url + '/' + item.id + '/converter', { agendaId }, opcoes),
      'Orçamento convertido em atendimento.', () => {
        this.convertendo.set(null);
        this.editando.set(null);
        this.convertido.emit();
      }, true);
  }

  private executar(pedido: ReturnType<HttpClient['post']>, mensagem: string, sucesso: () => void, atualizaAgenda = false): void {
    this.ocupado.set(true);
    this.mensagem.set('');
    pedido.subscribe({
      next: () => { sucesso(); this.mensagem.set(mensagem); this.carregar(); },
      error: erro => {
        this.falha(erro);
        if (erro.status === 409) {
          if (atualizaAgenda) this.convertido.emit();
          this.carregar();
        }
      },
    });
  }

  private falha(erro: { error?: { mensagem?: string } }): void {
    this.ocupado.set(false);
    this.mensagem.set(erro.error?.mensagem || 'Não foi possível concluir a operação do orçamento.');
  }
}

@Component({
  selector: 'aznom-interesse',
  styleUrl: './operacao.css',
  template: `
    <form #formulario class="form-conta" (submit)="enviar($event, formulario)">
      <h3>Lista de espera · {{ turma() }}</h3>
      <p>A equipe poderá chamar pelo WhatsApp se uma vaga abrir.</p>
      <label>Nome <input name="nome" maxlength="100" autocomplete="name" required></label>
      <label>WhatsApp com DDD <input name="telefone" type="tel" maxlength="25" autocomplete="tel" required></label>
      <label><input name="autorizado" type="checkbox" required> Autorizo o contato sobre esta turma.</label>
      <button class="botao" type="submit" [disabled]="ocupado() || enviado()">Registrar interesse</button>
      @if (mensagem()) { <p role="status">{{ mensagem() }}</p> }
      @if (mudou()) {
        <button class="botao botao-secundario" type="button" (click)="atualizar.emit()">Atualizar turmas</button>
      }
    </form>
  `,
})
export class InteresseTurma {
  private readonly http = inject(HttpClient);
  readonly id = input.required<number>();
  readonly turma = input.required<string>();
  readonly atualizar = output<void>();
  readonly ocupado = signal(false);
  readonly enviado = signal(false);
  readonly mudou = signal(false);
  readonly mensagem = signal('');

  enviar(evento: Event, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const dados = new FormData(formulario);
    this.ocupado.set(true);
    this.mudou.set(false);
    this.mensagem.set('');
    this.http.post('/api/agenda/' + this.id() + '/lista-espera', {
      nome: dados.get('nome'), telefone: dados.get('telefone'), autorizado: dados.has('autorizado'),
    }, opcoes).subscribe({
      next: () => {
        formulario.reset();
        this.enviado.set(true);
        this.ocupado.set(false);
        this.mensagem.set('Seu interesse foi registrado.');
      },
      error: erro => {
        this.ocupado.set(false);
        this.mudou.set(erro.status === 409);
        this.mensagem.set(erro.error?.mensagem || 'Não foi possível registrar seu interesse.');
      },
    });
  }
}

@Component({
  selector: 'aznom-lista-espera',
  template: `
    <h2 id="titulo-espera">Lista de espera das turmas</h2>
    <div class="acoes">
      <button class="botao botao-secundario" type="button" [disabled]="ocupado()" (click)="atualizar()">Atualizar lista</button>
    </div>
    @if (mensagem()) { <p role="status">{{ mensagem() }}</p> }
    <div class="grade">
      @for (item of itens(); track item.id) {
        <article class="card card-texto">
          <h3>{{ item.nome }}</h3>
          <p>{{ dataBr(item.inicio) }} a {{ dataBr(item.fim) }} · {{ item.vigente ? item.vagas + ' vagas livres' : 'Turma encerrada' }}</p>
          <p>{{ item.matricula_id ? 'Matrícula confirmada' : item.contatado ? 'Contato registrado' : 'Aguardando contato' }}</p>
          @if (item.matricula_id) {
            <a [href]="'#matricula-' + item.matricula_id">Ver matrícula</a>
          } @else if (item.vigente) {
            <div class="acoes">
              @if (item.vagas > 0) {
                <a class="botao botao-secundario" [href]="link(item)" target="_blank" rel="noopener">Avisar pelo WhatsApp</a>
                <button class="botao" type="button" [disabled]="ocupado()" (click)="matricular(item)">Confirmar matrícula</button>
              }
              <button class="botao botao-secundario" type="button" [disabled]="ocupado()" (click)="alternar(item)">
                {{ item.contatado ? 'Marcar como pendente' : 'Marcar como contatado' }}
              </button>
            </div>
          }
        </article>
      } @empty {
        @if (!ocupado() && !mensagem()) { <p>Nenhum interesse registrado.</p> }
      }
    </div>
  `,
})
export class ListaEspera {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/admin/lista-espera';
  readonly revisao = input.required<unknown>();
  readonly matriculaAlterada = output<void>();
  readonly itens = signal<Interesse[]>([]);
  readonly ocupado = signal(false);
  readonly mensagem = signal('');
  readonly dataBr = dataBr;

  constructor() {
    effect(onCleanup => {
      this.revisao();
      const consulta = this.carregar();
      onCleanup(() => consulta.unsubscribe());
    });
  }

  atualizar(): void {
    this.mensagem.set('');
    this.carregar();
  }

  private carregar() {
    this.ocupado.set(true);
    return this.http.get<Interesse[]>(this.url, { timeout: 5000 }).subscribe({
      next: itens => { this.itens.set(itens); this.ocupado.set(false); },
      error: () => { this.ocupado.set(false); this.mensagem.set('Não foi possível carregar a lista de espera.'); },
    });
  }

  link(item: Interesse): string {
    return whatsapp(item.telefone, `Olá, ${item.nome}! Aqui é da AZNOM. Abriu uma vaga na turma de ${dataBr(item.inicio)} a ${dataBr(item.fim)}. Você ainda tem interesse?`);
  }

  matricular(item: Interesse): void {
    this.ocupado.set(true);
    this.mensagem.set('');
    this.http.post('/api/admin/matriculas', { interesseId: item.id }, opcoes).subscribe({
      next: () => {
        this.mensagem.set('Matrícula confirmada.');
        this.carregar();
        this.matriculaAlterada.emit();
      },
      error: erro => {
        this.mensagem.set(erro.error?.mensagem || 'Não foi possível confirmar a matrícula.');
        this.carregar();
        if (erro.status === 409) this.matriculaAlterada.emit();
      },
    });
  }

  alternar(item: Interesse): void {
    this.ocupado.set(true);
    this.mensagem.set('');
    this.http.patch(this.url + '/' + item.id, { contatado: !item.contatado }, opcoes).subscribe({
      next: () => {
        this.itens.update(itens => itens.map(atual => atual.id === item.id ? { ...atual, contatado: !item.contatado } : atual));
        this.ocupado.set(false);
      },
      error: () => {
        this.ocupado.set(false);
        this.mensagem.set('Não foi possível atualizar o contato.');
      },
    });
  }
}

@Component({
  selector: 'aznom-ficha-veiculo',
  imports: [PagamentoEditor, EntregaEditor],
  styleUrl: './operacao.css',
  template: `
    <h4>Ficha do veículo</h4>
    @if (item().veiculo_id; as veiculoId) {
      <p>Veículo vinculado: {{ item().modelo_cadastrado }} @if (item().placa) { · {{ item().placa }} }</p>
      <div class="acoes">
        <button class="botao botao-secundario" type="button" (click)="verHistorico.emit(veiculoId)">Ver histórico do veículo</button>
        <button class="botao botao-secundario" type="button" [disabled]="ocupado()" (click)="desvincular()">Desvincular veículo</button>
      </div>
    } @else {
      <details>
        <summary>Identificar este veículo</summary>
        @if (veiculos().length) {
          <form #vinculo class="form-conta" (submit)="vincular($event, vinculo)">
            <label>Veículo cadastrado
              <select name="veiculo" required>
                <option value="">Selecione um veículo</option>
                @for (veiculo of veiculos(); track veiculo.id) {
                  <option [value]="veiculo.id">{{ veiculo.modelo }} · {{ veiculo.placa ?? 'Sem placa, cadastro ' + veiculo.id }}</option>
                }
              </select>
            </label>
            <button class="botao botao-secundario" type="submit" [disabled]="ocupado()">Vincular veículo</button>
          </form>
        }
        <form #novoVeiculo class="form-conta" (submit)="cadastrar($event, novoVeiculo)">
          <label>Modelo <input name="modelo" maxlength="100" [value]="item().veiculo" required></label>
          <label>Placa (opcional) <input name="placa" maxlength="12" placeholder="ABC1D23"></label>
          <button class="botao botao-secundario" type="submit" [disabled]="ocupado()">Cadastrar e vincular</button>
        </form>
      </details>
    }
    @if (item().status !== 'cancelado') {
      <aznom-entrega [item]="item()" (atualizado)="atualizada.emit()"></aznom-entrega>
    }
    <aznom-pagamento [dados]="item()" [caminho]="pagamento()" (atualizado)="atualizada.emit()"></aznom-pagamento>
    <form #ficha class="form-conta" (submit)="salvar($event, ficha)">
      <label>WhatsApp com DDD <input name="telefone" type="tel" maxlength="25" [value]="item().telefone ?? ''"></label>
      <label>Serviços realizados <textarea name="servicos_realizados" rows="3" maxlength="1200" [value]="item().servicos_realizados"></textarea></label>
      <label>Observações do veículo <textarea name="observacoes_veiculo" rows="3" maxlength="1200" [value]="item().observacoes_veiculo"></textarea></label>
      <button class="botao" type="submit" [disabled]="ocupado()">Salvar ficha</button>
    </form>
    <div class="grade">
      @for (etapa of etapas; track etapa) {
        <div class="foto-ficha">
          <h5>{{ etapa === 'antes' ? 'Antes' : 'Depois' }}</h5>
          @if (item().fotos.includes(etapa)) {
            <img [src]="caminhoFoto(etapa) + '?v=' + versao()" [alt]="'Veículo ' + etapa + ' do atendimento'" loading="lazy">
            <button class="botao botao-secundario" type="button" [disabled]="ocupado()" (click)="remover(etapa)">Remover foto</button>
          }
          <form class="form-conta" (submit)="enviar($event, etapa, arquivo.files?.item(0))">
            <label>{{ item().fotos.includes(etapa) ? 'Substituir foto' : 'Adicionar foto' }}
              <input #arquivo type="file" accept="image/jpeg,image/png,image/webp" required>
            </label>
            <button class="botao botao-secundario" type="submit" [disabled]="ocupado()">Enviar foto</button>
          </form>
        </div>
      }
    </div>
    @if (mensagem()) { <p role="status">{{ mensagem() }}</p> }
  `,
})
export class FichaVeiculo {
  private readonly http = inject(HttpClient);
  readonly item = input.required<FichaAtendimento>();
  readonly veiculos = input.required<VeiculoCadastrado[]>();
  readonly verHistorico = output<number>();
  readonly veiculoAlterado = output<void>();
  readonly atualizada = output<void>();
  readonly ocupado = signal(false);
  readonly mensagem = signal('');
  readonly versao = signal(0);
  readonly etapas = ['antes', 'depois'] as const;

  private caminho(): string {
    return '/api/admin/atendimentos/' + this.item().id + '/ficha';
  }

  pagamento(): string {
    return '/api/admin/atendimentos/' + this.item().id + '/pagamento';
  }

  vincular(evento: Event, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const veiculoId = Number(new FormData(formulario).get('veiculo'));
    if (!veiculoId) return;
    this.executar(this.http.put(this.caminho() + '/veiculo', { veiculoId }, opcoes),
      'Veículo vinculado.', () => this.veiculoAlterado.emit());
  }

  cadastrar(evento: Event, formulario: HTMLFormElement): void {
    evento.preventDefault();
    this.executar(this.http.put(this.caminho() + '/veiculo', campos(formulario, ['modelo', 'placa']), opcoes),
      'Veículo cadastrado e vinculado.', () => this.veiculoAlterado.emit());
  }

  desvincular(): void {
    if (!window.confirm('Desvincular este atendimento do cadastro do veículo?')) return;
    this.executar(this.http.delete(this.caminho() + '/veiculo', opcoes),
      'Veículo desvinculado.', () => this.veiculoAlterado.emit());
  }

  caminhoFoto(etapa: EtapaFoto): string {
    return this.caminho() + '/fotos/' + etapa;
  }

  salvar(evento: Event, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const dados = campos(formulario, ['telefone', 'servicos_realizados', 'observacoes_veiculo']);
    this.executar(this.http.patch(this.caminho(), dados, opcoes), 'Ficha atualizada.');
  }

  enviar(evento: Event, etapa: EtapaFoto, arquivo: File | null | undefined): void {
    evento.preventDefault();
    if (!arquivo || !['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type) || arquivo.size > 3 * 1024 * 1024) {
      this.mensagem.set('Selecione uma foto JPG, PNG ou WebP de até 3 MB.');
      return;
    }
    this.executar(this.http.put(this.caminhoFoto(etapa), arquivo, { ...opcoes, timeout: 30000 }), 'Foto salva.', () => {
      (evento.target as HTMLFormElement).reset();
      this.versao.update(valor => valor + 1);
    });
  }

  remover(etapa: EtapaFoto): void {
    if (!window.confirm('Remover esta foto da ficha?')) return;
    this.executar(this.http.delete(this.caminhoFoto(etapa), opcoes), 'Foto removida.');
  }

  private executar(pedido: ReturnType<HttpClient['post']>, mensagem: string, sucesso?: () => void): void {
    this.ocupado.set(true);
    this.mensagem.set('');
    pedido.subscribe({
      next: () => {
        sucesso?.();
        this.ocupado.set(false);
        this.mensagem.set(mensagem);
        this.atualizada.emit();
      },
      error: erro => {
        this.ocupado.set(false);
        this.mensagem.set(erro.error?.mensagem || 'Não foi possível atualizar a ficha.');
      },
    });
  }
}
