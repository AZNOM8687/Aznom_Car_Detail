import { HttpClient, provideHttpClient } from '@angular/common/http';
import { Component, computed, inject, OnInit, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';

import { catalogoInicial, ilustracoes } from './catalogo';

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

  private readonly horariosServicos: { data: string; hora: string }[] = [
    // Adicione um item por horário real: { data: 'DD/MM/AAAA', hora: 'HH:mm' },
  ];

  private readonly turmasCurso: { inicio: string; fim: string }[] = [
    // Adicione um item por turma real: { inicio: 'DD/MM/AAAA', fim: 'DD/MM/AAAA' },
  ];

  protected readonly abaAgenda = signal<'servicos' | 'cursos'>('servicos');
  protected readonly selecaoAgenda = signal('');
  protected readonly opcoesAgenda = computed(() =>
    this.abaAgenda() === 'servicos'
      ? this.horariosServicos.map(({ data, hora }) => ({
          primeiraColuna: data,
          segundaColuna: hora,
          rotulo: `${data} às ${hora}`,
        }))
      : this.turmasCurso.map(({ inicio, fim }) => ({
          primeiraColuna: inicio,
          segundaColuna: fim,
          rotulo: `${inicio} a ${fim}`,
        })),
  );

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
    if (!this.telaGaleria && !this.telaAgenda) {
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
