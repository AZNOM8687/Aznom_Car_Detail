export function dataBr(data: string | null | undefined): string {
  return data ? data.split('-').reverse().join('/') : '';
}

export function dataIso(valor: unknown): string | null {
  const partes = typeof valor === 'string' && /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim());
  if (!partes || partes[3] === '0000') return null;
  const iso = partes[3] + '-' + partes[2] + '-' + partes[1];
  const data = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(data.getTime()) && data.toISOString().slice(0, 10) === iso ? iso : null;
}
