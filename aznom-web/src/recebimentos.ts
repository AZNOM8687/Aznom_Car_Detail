import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { Observable } from 'rxjs';

export interface DadosPagamento {
  valor_centavos: number | null;
  sinal_centavos: number;
  restante_pago_centavos: number;
}

interface Recebimento {
  id: number;
  valor_centavos: number;
  tipo: 'sinal' | 'saldo';
  meio: keyof typeof meios;
  data: string | null;
  estornado: boolean;
}

interface Movimento {
  id: number;
  valor_centavos: number;
  meio: keyof typeof meios;
  data: string;
  estorno: boolean;
  cliente: string;
  atendimento_id: number | null;
  matricula_id: number | null;
}

interface Resumo {
  entradas: string;
  estornos: string;
  saldo_atual: string;
  entregues: number;
  movimentos: Movimento[];
}

const opcoes = { headers: { 'X-Aznom': '1' }, timeout: 8000 };
const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const hoje = () => new Intl.DateTimeFormat('sv-SE', {timeZone: 'America/Sao_Paulo'}).format(new Date());
const dataBr = (data: string) => data.split('-').reverse().join('/');
const moeda = (valor: number | string) => reais.format(Number(valor) / 100);
const centavos = (valor: string) => /^\d{1,6}([,.]\d{1,2})?$/.test(valor)
  ? Math.round(Number(valor.replace(',', '.')) * 100) : null;
const meios = { pix: 'Pix', dinheiro: 'Dinheiro', credito: 'Cartão de crédito', debito: 'Cartão de débito',
  transferencia: 'Transferência', outro: 'Outro', legado: 'Forma não registrada' };

@Component({
  selector: 'aznom-pagamento',
  styleUrl: './operacao.css',
  template: `
    <details (toggle)="aberto.set(painel.open)" #painel>
      <summary>Pagamento · {{ saldo() === null ? 'Valor a definir' : saldo() === 0 ? 'Quitado' : 'Saldo de ' + moeda(saldo()!) }}</summary>
      <form #valorForm class="form-conta" (submit)="salvarValor($event, valorForm)">
        <label>Valor combinado <input name="valor" inputmode="decimal" maxlength="9" [value]="formatar(dados().valor_centavos)"></label>
        <p>Total recebido: {{ moeda(dados().sinal_centavos + dados().restante_pago_centavos) }}</p>
        <button class="botao botao-secundario" type="submit" [disabled]="ocupado()">Salvar valor combinado</button>
      </form>
      @if (saldo() !== null && saldo()! > 0) {
        <form #entradaForm class="form-conta" (submit)="registrar($event, entradaForm)">
          <label>Valor recebido <input name="valor" inputmode="decimal" maxlength="9" required></label>
          <label>Data do recebimento <input name="data" type="date" [attr.value]="dia" [max]="dia" required></label>
          <label>Tipo
            <select name="tipo"><option value="sinal">Sinal</option><option value="saldo">Pagamento do saldo</option></select>
          </label>
          <label>Forma de pagamento
            <select name="meio" required>
              <option value="">Selecione</option>
              @for (meio of meiosNovos; track meio) { <option [value]="meio">{{ meios[meio] }}</option> }
            </select>
          </label>
          <button class="botao" type="submit" [disabled]="ocupado()">Registrar recebimento</button>
        </form>
      }
      @if (mensagem()) { <p role="status">{{ mensagem() }}</p> }
      <h5>Histórico de recebimentos</h5>
      <ul>
        @for (item of recebimentos(); track item.id) {
          <li>
            {{ item.data ? dataBr(item.data) : 'Data não registrada' }} · {{ item.tipo === 'sinal' ? 'Sinal' : 'Pagamento do saldo' }} · {{ meios[item.meio] }} · {{ moeda(item.valor_centavos) }}
            @if (item.estornado) { <strong> · Estornado</strong> }
            @else {
              <button class="botao botao-secundario" type="button" [disabled]="ocupado()" (click)="estornar(item)">Estornar registro</button>
            }
          </li>
        } @empty { <li>{{ carregando() ? 'Carregando recebimentos…' : 'Nenhum recebimento registrado.' }}</li> }
      </ul>
    </details>
  `,
})
export class PagamentoEditor {
  private readonly http = inject(HttpClient);
  readonly caminho = input.required<string>();
  readonly dados = input.required<DadosPagamento>();
  readonly atualizado = output<void>();
  readonly ocupado = signal(false);
  readonly carregando = signal(false);
  readonly aberto = signal(false);
  readonly mensagem = signal('');
  readonly recebimentos = signal<Recebimento[]>([]);
  readonly dia = hoje();
  readonly dataBr = dataBr;
  readonly moeda = moeda;
  readonly meios = meios;
  readonly meiosNovos = ['pix','dinheiro','credito','debito','transferencia','outro'] as const;
  private chavePendente?: { dados: string; chave: string };
  private consulta = 0;
  readonly saldo = computed(() => {
    const { valor_centavos, sinal_centavos, restante_pago_centavos } = this.dados();
    return valor_centavos === null ? null : valor_centavos - sinal_centavos - restante_pago_centavos;
  });

  constructor() { effect(() => { if (this.aberto()) this.carregar(); }); }

  formatar(valor: number | null): string {
    return valor === null ? '' : (valor / 100).toFixed(2).replace('.', ',');
  }

  private carregar(): void {
    const consulta = ++this.consulta;
    this.carregando.set(true);
    this.http.get<Recebimento[]>(this.caminho() + '/recebimentos', { timeout: 5000 }).subscribe({
      next: dados => {
        if (consulta !== this.consulta) return;
        this.recebimentos.set(dados);
        this.carregando.set(false);
      },
      error: () => {
        if (consulta !== this.consulta) return;
        this.mensagem.set('Não foi possível carregar os recebimentos.');
        this.carregando.set(false);
      },
    });
  }

  salvarValor(evento: Event, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const texto = String(new FormData(formulario).get('valor') ?? '').trim();
    const valor = centavos(texto);
    if (texto && valor === null) {
      this.mensagem.set('Informe o valor combinado em reais.');
      return;
    }
    this.executar(this.http.patch(this.caminho(), { valor, anterior: this.dados().valor_centavos }, opcoes), 'Valor combinado atualizado.');
  }

  registrar(evento: Event, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const campos = new FormData(formulario);
    const valor = centavos(String(campos.get('valor') ?? '').trim());
    if (!valor) {
      this.mensagem.set('Informe um recebimento maior que zero.');
      return;
    }
    const dados = { valor, tipo: campos.get('tipo'), meio: campos.get('meio'), data: campos.get('data') };
    const assinatura = JSON.stringify(dados);
    if (this.chavePendente?.dados !== assinatura) this.chavePendente = { dados: assinatura, chave: crypto.randomUUID() };
    this.executar(this.http.post(this.caminho() + '/recebimentos', { ...dados, chave: this.chavePendente.chave }, opcoes),
      'Recebimento registrado.', () => { this.chavePendente = undefined; formulario.reset(); });
  }

  estornar(item: Recebimento): void {
    if (!window.confirm('Estornar o registro de ' + moeda(item.valor_centavos) + '?')) return;
    this.executar(this.http.patch(this.caminho() + '/recebimentos/' + item.id + '/estornar', {}, opcoes), 'Estorno registrado.');
  }

  private executar(pedido: Observable<unknown>, mensagem: string, sucesso?: () => void): void {
    this.ocupado.set(true);
    this.mensagem.set('');
    pedido.subscribe({
      next: () => {
        sucesso?.();
        this.ocupado.set(false);
        this.mensagem.set(mensagem);
        this.atualizado.emit();
        this.carregar();
      },
      error: (erro: HttpErrorResponse) => {
        this.ocupado.set(false);
        this.mensagem.set(erro.error?.mensagem || 'Não foi possível atualizar o pagamento.');
        if (erro.status === 409) { this.atualizado.emit(); this.carregar(); }
      },
    });
  }
}

@Component({
  selector: 'aznom-resumo-mensal',
  styleUrl: './operacao.css',
  template: `
    <h2 id="titulo-recebimentos">Recebimentos do mês</h2>
    <div class="acoes">
      <label>Mês <input #periodo type="month" [value]="mes()" (change)="selecionar(periodo.value)"></label>
      <button class="botao botao-secundario" type="button" [disabled]="ocupado()" (click)="carregar()">Atualizar recebimentos</button>
    </div>
    @if (mensagem()) { <p role="status">{{ mensagem() }}</p> }
    @if (dados(); as resumo) {
      <div class="grade">
        <article class="card card-texto"><h3>Entradas do mês</h3><p>{{ moeda(resumo.entradas) }}</p>
          @if (+resumo.estornos) { <p>Estornos: {{ moeda(resumo.estornos) }} · Líquido: {{ moeda(+resumo.entradas - +resumo.estornos) }}</p> }
        </article>
        <article class="card card-texto"><h3>Saldo em aberto hoje</h3><p>{{ moeda(resumo.saldo_atual) }}</p></article>
        <article class="card card-texto"><h3>Serviços entregues no mês</h3><p>{{ resumo.entregues }}</p></article>
      </div>
      @if (resumo.movimentos.length) {
        <div class="movimentos">
          <table>
            <caption>Movimentações registradas no mês</caption>
            <thead><tr><th scope="col">Data</th><th scope="col">Cliente</th><th scope="col">Forma</th><th scope="col">Valor</th></tr></thead>
            <tbody>
              @for (item of resumo.movimentos; track item.id + ':' + item.estorno) {
                <tr><td>{{ dataBr(item.data) }}</td><td>{{ item.cliente }} · {{ item.atendimento_id ? 'Atendimento' : 'Matrícula' }}</td>
                  <td>{{ meios[item.meio] }}</td><td>{{ moeda(item.estorno ? -item.valor_centavos : item.valor_centavos) }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p>Nenhuma movimentação com data neste mês.</p>
      }
    }
  `,
})
export class ResumoMensal {
  private readonly http = inject(HttpClient);
  readonly revisao = input.required<number>();
  readonly mes = signal(hoje().slice(0, 7));
  readonly dados = signal<Resumo | null>(null);
  readonly ocupado = signal(false);
  readonly mensagem = signal('');
  readonly meios = meios;
  readonly moeda = moeda;
  readonly dataBr = dataBr;
  private consulta = 0;

  constructor() { effect(() => { this.revisao(); this.carregar(); }); }

  selecionar(valor: string): void {
    if (!/^\d{4}-\d{2}$/.test(valor)) return;
    this.dados.set(null);
    this.mes.set(valor);
  }

  carregar(): void {
    const consulta = ++this.consulta;
    this.ocupado.set(true);
    this.mensagem.set('');
    this.http.get<Resumo>('/api/admin/recebimentos', { params: { mes: this.mes() }, timeout: 5000 }).subscribe({
      next: dados => {
        if (consulta !== this.consulta) return;
        this.dados.set(dados);
        this.ocupado.set(false);
      },
      error: () => {
        if (consulta !== this.consulta) return;
        this.mensagem.set('Não foi possível carregar os recebimentos do mês.');
        this.ocupado.set(false);
      },
    });
  }
}
