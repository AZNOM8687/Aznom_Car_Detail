import { HttpClient, provideHttpClient } from '@angular/common/http';
import { Component, inject, OnInit, provideZonelessChangeDetection, signal } from '@angular/core';
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
})
class App implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly servicos = signal<Servico[]>([]);
  protected readonly estado = signal<'carregando' | 'pronto' | 'reserva'>('carregando');

  protected readonly ilustracoes = ilustracoes;
  protected readonly contato = 'https://wa.me/5545999271987';
  protected readonly curso = this.whatsapp('Olá, AZNOM! Gostaria de saber as datas, os valores e a disponibilidade do curso de estética automotiva de uma semana.');

  protected whatsapp(mensagem: string): string {
    return this.contato + '?text=' + encodeURIComponent(mensagem);
  }

  ngOnInit(): void {
    this.carregar();
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
