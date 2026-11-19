import { HttpClient } from '@angular/common/http';
import { Component, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type Andamento = 'agendado' | 'recebido' | 'execucao' | 'pronto';

export interface DadosEntrega {
  id: number;
  andamento: Andamento;
  status: string;
  previsao_entrega: string | null;
  entregue_em: string | null;
  cuidados: string;
  servico: string;
  servicos_realizados: string;
  modelo_cadastrado: string | null;
  veiculo: string;
  placa: string | null;
  fotos: TipoFoto[];
}

type TipoFoto = 'antes' | 'depois';
export const etapasEntrega = { agendado: 'Agendado', recebido: 'Veículo recebido',
  execucao: 'Em execução', pronto: 'Pronto para retirada' } as const;
const opcoes = { headers: { 'X-Aznom': '1' }, timeout: 8000 };
const escaparHtml = (texto: string) => texto.replace(/[&<>"']/g, caractere =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[caractere] ?? caractere);

export function dataHoraEntrega(valor: string): string {
  const [data, hora] = valor.split('T');
  return data.split('-').reverse().join('/') + ' às ' + hora;
}

@Component({
  selector: 'aznom-entrega',
  styleUrl: './operacao.css',
  template: `
    <details>
      <summary>Andamento e entrega</summary>
      <form #formulario class="form-conta" (submit)="salvar($event, formulario)">
        @if (item().status === 'confirmado') {
          <label>Etapa do serviço
            <select name="andamento" [value]="item().andamento">
              @for (etapa of etapas; track etapa) { <option [value]="etapa">{{ rotulos[etapa] }}</option> }
            </select>
          </label>
        }
        <label>Previsão de retirada (horário de São Paulo)
          <input type="datetime-local" name="previsao" [value]="item().previsao_entrega ?? ''">
        </label>
        <label>Cuidados para o cliente <textarea name="cuidados" rows="3" maxlength="1200" [value]="item().cuidados"></textarea></label>
        <button class="botao botao-secundario" type="submit" [disabled]="ocupado()">Salvar andamento e entrega</button>
      </form>
      @if (item().andamento === 'pronto' || item().status === 'concluido') {
        <form #comprovante class="form-conta" (submit)="gerar($event, comprovante)">
          <h5>Comprovante de entrega</h5>
          @for (foto of item().fotos; track foto) {
            <label><input type="checkbox" [name]="foto"> Incluir foto de {{ foto }}</label>
          }
          <button class="botao" type="submit" [disabled]="ocupado()">Abrir comprovante para imprimir ou salvar em PDF</button>
        </form>
      }
      @if (mensagem()) { <p role="status">{{ mensagem() }}</p> }
    </details>
  `,
})
export class EntregaEditor {
  private readonly http = inject(HttpClient);
  readonly item = input.required<DadosEntrega>();
  readonly atualizado = output<void>();
  readonly ocupado = signal(false);
  readonly mensagem = signal('');
  readonly rotulos = etapasEntrega;
  readonly etapas = Object.keys(etapasEntrega) as Andamento[];

  salvar(evento: Event, formulario: HTMLFormElement): void {
    evento.preventDefault();
    const dados = new FormData(formulario);
    this.ocupado.set(true);
    this.mensagem.set('');
    this.http.patch('/api/admin/atendimentos/' + this.item().id + '/entrega', {
      andamento: dados.get('andamento') ?? this.item().andamento,
      previsao: dados.get('previsao'), cuidados: dados.get('cuidados'),
    }, opcoes).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.mensagem.set('Andamento e entrega atualizados.');
        this.atualizado.emit();
      },
      error: erro => {
        this.ocupado.set(false);
        this.mensagem.set(erro.error?.mensagem || 'Não foi possível atualizar a entrega.');
      },
    });
  }

  async gerar(evento: Event, formulario: HTMLFormElement): Promise<void> {
    evento.preventDefault();
    const janela = window.open('', '_blank');
    if (!janela) {
      this.mensagem.set('Permita abrir uma nova aba para visualizar o comprovante.');
      return;
    }
    janela.opener = null;
    janela.document.title = 'Preparando comprovante · AZNOM';
    janela.document.body.textContent = 'Preparando comprovante…';
    const item = this.item();
    const dados = new FormData(formulario);
    this.ocupado.set(true);
    this.mensagem.set('');
    try {
      const fotos = await Promise.all(item.fotos.filter(foto => dados.has(foto))
        .map(async foto => ({ foto, url: await this.carregarFoto(item.id, foto) })));
      if (janela.closed) return;
      const doc = janela.document;
      doc.open();
      doc.write(this.documento(item, fotos));
      doc.close();
      doc.getElementById('imprimir')?.addEventListener('click', () => janela.print());
    } catch {
      janela.close();
      this.mensagem.set('Não foi possível gerar o comprovante com as fotos selecionadas.');
    } finally {
      this.ocupado.set(false);
    }
  }

  private async carregarFoto(id: number, foto: TipoFoto): Promise<string> {
    const imagem = await firstValueFrom(this.http.get('/api/admin/atendimentos/' + id + '/ficha/fotos/' + foto,
      { responseType: 'blob', timeout: 12000 }));
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(imagem.type)) throw new Error('Tipo de imagem inválido.');
    return new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(String(leitor.result));
      leitor.onerror = reject;
      leitor.readAsDataURL(imagem);
    });
  }

  private documento(item: DadosEntrega, fotos: { foto: TipoFoto; url: string }[]): string {
    const veiculo = escaparHtml(item.modelo_cadastrado ?? item.veiculo);
    const placa = item.placa ? ' · ' + escaparHtml(item.placa) : '';
    const servicos = escaparHtml(item.servicos_realizados || item.servico);
    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comprovante de entrega ${item.id} · AZNOM</title>
<style>
  body { color:#172019; margin:2rem auto; max-width:50rem; padding:0 1.5rem; font:16px/1.5 system-ui,sans-serif }
  header { border-bottom:2px solid #304e32; margin-bottom:1.25rem; padding-bottom:.75rem }
  h1,h2,p { margin:.5rem 0 }
  h2 { font-size:1.1rem }
  section,figure { break-inside:avoid; margin:1rem 0 }
  .texto { white-space:pre-wrap; overflow-wrap:anywhere }
  img { max-width:100%; max-height:16rem; object-fit:contain; display:block }
  figcaption { margin:.5rem 0 }
  button { font:inherit; padding:.55rem .9rem }
  @media print { button { display:none } body { margin:0; padding:0 } }
</style></head><body>
<button id="imprimir" type="button">Imprimir ou salvar em PDF</button>
<header><p>AZNOM CAR DETAIL</p><h1>Comprovante de entrega</h1><p>Atendimento nº ${item.id}</p></header>
<section><h2>Veículo</h2><p>${veiculo}${placa}</p>
${item.entregue_em ? '<p>Entregue em ' + escaparHtml(dataHoraEntrega(item.entregue_em)) + '</p>' :
  item.previsao_entrega ? '<p>Previsão de retirada: ' + escaparHtml(dataHoraEntrega(item.previsao_entrega)) + '</p>' : ''}</section>
<section><h2>Serviços realizados</h2><p class="texto">${servicos}</p></section>
${item.cuidados ? '<section><h2>Cuidados recomendados</h2><p class="texto">' + escaparHtml(item.cuidados) + '</p></section>' : ''}
${fotos.map(({ foto, url }) => '<figure><img src="' + escaparHtml(url) + '" alt="Veículo ' + foto +
  ' do serviço"><figcaption>' + (foto === 'antes' ? 'Antes' : 'Depois') + '</figcaption></figure>').join('')}
</body></html>`;
  }
}
