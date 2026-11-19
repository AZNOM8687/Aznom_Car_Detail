const { telefoneValido } = require('./operacao');

const prefixo = '/api/admin/';
const idRota = ':id(\\d{1,10})';
const idValido = id => Number.isInteger(id) && id > 0 && id <= 2147483647;

module.exports = function registrarGestao(app, banco, { autenticar, admin, rota }) {
  const restrito = [autenticar, admin];
  const matriculas = prefixo + 'matriculas';
  const veiculos = prefixo + 'veiculos';
  const atendimento = prefixo + 'atendimentos/' + idRota;

  app.get(matriculas, ...restrito, rota(async (req, res) => {
    const { rows } = await banco.query(`
      SELECT m.id, m.nome, m.telefone, m.agenda_id, m.cancelada_em IS NOT NULL AS cancelada,
        to_char(coalesce(a.inicio, m.inicio), 'YYYY-MM-DD') AS inicio,
        to_char(coalesce(a.fim, m.fim), 'YYYY-MM-DD') AS fim,
        m.valor_centavos, m.sinal_centavos, m.restante_pago_centavos
      FROM aznom_matriculas m LEFT JOIN aznom_agenda a ON a.id=m.agenda_id AND m.cancelada_em IS NULL
      ORDER BY m.cancelada_em IS NOT NULL, coalesce(a.inicio,m.inicio), m.id
    `);
    res.json(rows);
  }));

  app.post(matriculas, ...restrito, rota(async (req, res) => {
    const { interesseId } = req.body ?? {};
    if (!idValido(interesseId)) return res.status(400).json({ mensagem: 'Selecione uma pessoa da lista de espera.' });
    const { rowCount } = await banco.query(`
      WITH interesse AS MATERIALIZED (
        SELECT id, agenda_id, nome, telefone FROM aznom_lista_espera WHERE id=$1 FOR UPDATE
      ), turma AS (
        UPDATE aznom_agenda a SET confirmadas=a.confirmadas+1, matriculadas=a.matriculadas+1
        FROM interesse e WHERE a.id=e.agenda_id AND a.tipo='cursos' AND a.confirmadas<a.capacidade
          AND a.fim >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
          AND NOT EXISTS (SELECT 1 FROM aznom_matriculas WHERE interesse_id=e.id AND cancelada_em IS NULL)
        RETURNING a.id, a.inicio, a.fim, a.detalhes
      ), nova AS (
        INSERT INTO aznom_matriculas (interesse_id, agenda_id, nome, telefone, inicio, fim, valor_centavos)
        SELECT e.id, t.id, e.nome, e.telefone, t.inicio, t.fim, round((t.detalhes->>'valor')::numeric*100)::integer
        FROM interesse e CROSS JOIN turma t
        RETURNING interesse_id
      )
      UPDATE aznom_lista_espera e SET contatado=true FROM nova WHERE e.id=nova.interesse_id
    `, [interesseId]);
    if (!rowCount) return res.status(409).json({ mensagem: 'Não há vaga disponível ou a pessoa já está matriculada.' });
    res.sendStatus(204);
  }));

  app.post(matriculas + '/direta', ...restrito, rota(async (req, res) => {
    const { agendaId } = req.body ?? {};
    const nome = typeof req.body?.nome === 'string' ? req.body.nome.trim() : '';
    const telefone = telefoneValido(req.body?.telefone);
    if (!idValido(agendaId) || !nome || nome.length > 100 || !telefone) {
      return res.status(400).json({ mensagem: 'Selecione uma turma e informe nome e WhatsApp com DDD.' });
    }
    // Bloqueia o interesse antes da turma, como no fluxo pela lista de espera.
    const { rows } = await banco.query(`
      WITH interesse AS MATERIALIZED (
        SELECT id FROM aznom_lista_espera WHERE agenda_id=$1 AND telefone=$3 FOR UPDATE
      ), turma AS (
        UPDATE aznom_agenda a SET confirmadas=a.confirmadas+1, matriculadas=a.matriculadas+1
        WHERE a.id=$1 AND a.tipo='cursos' AND a.confirmadas<a.capacidade
          AND a.fim >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
          AND NOT EXISTS (SELECT 1 FROM aznom_matriculas WHERE agenda_id=a.id AND telefone=$3 AND cancelada_em IS NULL)
          AND (SELECT count(*) FROM interesse) <= 1
        RETURNING a.id, a.inicio, a.fim, a.detalhes
      ), nova AS (
        INSERT INTO aznom_matriculas (interesse_id, agenda_id, nome, telefone, inicio, fim, valor_centavos)
        SELECT (SELECT id FROM interesse), t.id, $2, $3, t.inicio, t.fim, round((t.detalhes->>'valor')::numeric*100)::integer
        FROM turma t RETURNING id, interesse_id
      ), contatado AS (
        UPDATE aznom_lista_espera e SET contatado=true FROM nova n WHERE e.id=n.interesse_id
      )
      SELECT id FROM nova
    `, [agendaId, nome, telefone]);
    if (!rows.length) return res.status(409).json({ mensagem: 'Não há vaga disponível ou já existe matrícula com esse WhatsApp.' });
    res.sendStatus(204);
  }));

  app.patch(atendimento + '/entrega', ...restrito, rota(async (req, res) => {
    const { andamento, previsao, cuidados } = req.body ?? {};
    const dataHora = typeof previsao === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(previsao)
      ? new Date(previsao + ':00Z') : null;
    if (!['agendado','recebido','execucao','pronto'].includes(andamento) ||
        (previsao !== '' && (!dataHora || previsao.startsWith('0000') || !Number.isFinite(dataHora.getTime()) || dataHora.toISOString().slice(0,16) !== previsao)) ||
        typeof cuidados !== 'string' || cuidados.trim().length > 1200) {
      return res.status(400).json({ mensagem: 'Confira a etapa do serviço, a previsão e os cuidados recomendados.' });
    }
    const { rowCount } = await banco.query(`
      UPDATE aznom_atendimentos SET andamento=CASE WHEN status='confirmado' THEN $2 ELSE andamento END,
        previsao_entrega=$3, cuidados=$4 WHERE id::bigint=$1 AND status<>'cancelado'
    `, [req.params.id, andamento, previsao || null, cuidados.trim()]);
    if (!rowCount) return res.status(409).json({ mensagem: 'Este atendimento não está disponível para edição da entrega.' });
    res.sendStatus(204);
  }));

  app.patch(matriculas + '/' + idRota + '/cancelar', ...restrito, rota(async (req, res) => {
    const { rowCount } = await banco.query(`
      WITH cancelada AS (
        UPDATE aznom_matriculas m SET cancelada_em=now(),
          inicio=coalesce((SELECT inicio FROM aznom_agenda WHERE id=m.agenda_id), inicio),
          fim=coalesce((SELECT fim FROM aznom_agenda WHERE id=m.agenda_id), fim)
        WHERE m.id::bigint=$1 AND m.cancelada_em IS NULL RETURNING agenda_id
      )
      UPDATE aznom_agenda a SET confirmadas=a.confirmadas-1, matriculadas=a.matriculadas-1
      FROM cancelada c WHERE a.id=c.agenda_id
    `, [req.params.id]);
    if (!rowCount) return res.status(409).json({ mensagem: 'A matrícula já foi cancelada ou a turma foi alterada.' });
    res.sendStatus(204);
  }));

  app.get(veiculos, ...restrito, rota(async (req, res) => {
    const { rows } = await banco.query(`
      SELECT v.id, v.modelo, v.placa, count(a.id)::integer AS atendimentos, max(a.data)::text AS ultimo
      FROM aznom_veiculos v LEFT JOIN aznom_atendimentos a ON a.veiculo_id=v.id
      GROUP BY v.id ORDER BY v.modelo, v.placa, v.id
    `);
    res.json(rows);
  }));

  function dadosVeiculo(body) {
    if (typeof body?.modelo !== 'string' || typeof body?.placa !== 'string') return null;
    const modelo = body.modelo.trim();
    const placa = body.placa.trim().toUpperCase().replace(/[ -]/g, '');
    if (!modelo || modelo.length > 100 || (placa && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa))) return null;
    return [modelo, placa || null];
  }

  app.put(atendimento + '/ficha/veiculo', ...restrito, rota(async (req, res) => {
    const { veiculoId } = req.body ?? {};
    const dados = dadosVeiculo(req.body);
    const selecionado = veiculoId !== undefined;
    if (selecionado ? !idValido(veiculoId) : !dados) {
      return res.status(400).json({ mensagem: 'Selecione um veículo ou informe o modelo e uma placa válida, se houver.' });
    }

    const { rowCount } = selecionado
      ? await banco.query(`UPDATE aznom_atendimentos SET veiculo_id=$2 WHERE id::bigint=$1 AND veiculo_id IS NULL
          AND EXISTS (SELECT 1 FROM aznom_veiculos WHERE id=$2)`, [req.params.id, veiculoId])
      : await banco.query(`
          WITH atual AS MATERIALIZED (
            SELECT id FROM aznom_atendimentos WHERE id::bigint=$1 AND veiculo_id IS NULL FOR UPDATE
          ), novo AS (
            INSERT INTO aznom_veiculos (modelo, placa)
            SELECT $2, $3 FROM atual ON CONFLICT (placa) DO NOTHING RETURNING id
          )
          UPDATE aznom_atendimentos a SET veiculo_id=n.id FROM atual x, novo n WHERE a.id=x.id
        `, [req.params.id, ...dados]);
    if (!rowCount) return res.status(409).json({ mensagem: 'Já existe um cadastro com essa placa ou o atendimento já está vinculado. Confira os veículos cadastrados.' });
    res.sendStatus(204);
  }));

  app.delete(atendimento + '/ficha/veiculo', ...restrito, rota(async (req, res) => {
    const { rowCount } = await banco.query('UPDATE aznom_atendimentos SET veiculo_id=NULL WHERE id::bigint=$1 AND veiculo_id IS NOT NULL',
      [req.params.id]);
    res.sendStatus(rowCount ? 204 : 404);
  }));

  app.patch(veiculos + '/' + idRota, ...restrito, rota(async (req, res) => {
    const dados = dadosVeiculo(req.body);
    if (!dados) return res.status(400).json({ mensagem: 'Informe o modelo e uma placa válida, se houver.' });
    const { rowCount } = await banco.query('UPDATE aznom_veiculos SET modelo=$1, placa=$2 WHERE id::bigint=$3', [...dados, req.params.id]);
    res.sendStatus(rowCount ? 204 : 404);
  }));

  app.get(prefixo + 'resumo', ...restrito, rota(async (req, res) => {
    const { rows: [resumo] } = await banco.query(`
      WITH local AS (SELECT now() AT TIME ZONE 'America/Sao_Paulo' AS agora)
      SELECT to_char(agora, 'YYYY-MM-DD') AS dia,
        (SELECT count(*)::integer FROM aznom_atendimentos
          WHERE status='confirmado' AND data=agora::date AND hora>=agora::time) AS total_hoje,
        coalesce((SELECT jsonb_agg(t ORDER BY t.hora, t.id) FROM (
          SELECT id, cliente, servico, left(hora::text, 5) AS hora FROM aznom_atendimentos
          WHERE status='confirmado' AND data=agora::date AND hora>=agora::time
          ORDER BY hora, id LIMIT 5
        ) t), '[]') AS proximos,
        (SELECT count(*)::integer FROM aznom_orcamentos WHERE status='aguardando') AS orcamentos_aguardando,
        coalesce((SELECT jsonb_agg(t ORDER BY t.inicio, t.id) FROM (
          SELECT a.id, a.inicio::text, a.fim::text, a.capacidade-a.confirmadas AS vagas,
            count(e.id)::integer AS espera
          FROM aznom_agenda a JOIN aznom_lista_espera e ON e.agenda_id=a.id
          LEFT JOIN aznom_matriculas m ON m.interesse_id=e.id AND m.cancelada_em IS NULL
          WHERE a.tipo='cursos' AND a.fim>=agora::date AND a.confirmadas<a.capacidade AND m.id IS NULL
          GROUP BY a.id ORDER BY a.inicio, a.id LIMIT 5
        ) t), '[]') AS turmas
      FROM local
    `);
    res.json(resumo);
  }));
};
