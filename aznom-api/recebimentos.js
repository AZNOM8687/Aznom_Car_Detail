const prefixo = '/api/admin/';
const idRota = ':id(\\d{1,10})';
const fuso = 'America/Sao_Paulo';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const centavos = valor => Number.isInteger(valor) && valor >= 0 && valor <= 99999999;

module.exports = function registrarRecebimentos(app, banco, { autenticar, admin, rota, dataValida }) {
  const restrito = [autenticar, admin];
  for (const [recurso, tabela, coluna] of [
    ['atendimentos', 'aznom_atendimentos', 'atendimento_id'],
    ['matriculas', 'aznom_matriculas', 'matricula_id'],
  ]) {
    const caminho = prefixo + recurso + '/' + idRota + '/pagamento';
    app.patch(caminho, ...restrito, rota(async (req, res) => {
      const { valor, anterior } = req.body ?? {};
      if ((valor !== null && !centavos(valor)) || (anterior !== null && !centavos(anterior))) {
        return res.status(400).json({ mensagem: 'Informe um valor combinado válido.' });
      }
      const { rowCount } = await banco.query(`
        UPDATE ${tabela} SET valor_centavos=$1 WHERE id::bigint=$2
          AND valor_centavos IS NOT DISTINCT FROM $3::integer
          AND sinal_centavos+restante_pago_centavos <= coalesce($1,0)
      `, [valor, req.params.id, anterior]);
      if (!rowCount) return res.status(409).json({ mensagem: 'O valor mudou ou está abaixo do total já recebido.' });
      res.sendStatus(204);
    }));

    app.get(caminho + '/recebimentos', ...restrito, rota(async (req, res) => {
      const { rows } = await banco.query(`
        SELECT id, valor_centavos, tipo, meio, to_char(data,'YYYY-MM-DD') AS data, estornado_em IS NOT NULL AS estornado
        FROM aznom_recebimentos WHERE ${coluna}::bigint=$1 ORDER BY data DESC NULLS LAST, id DESC
      `, [req.params.id]);
      res.json(rows);
    }));

    app.post(caminho + '/recebimentos', ...restrito, rota(async (req, res) => {
      const { valor, tipo, meio, data, chave } = req.body ?? {};
      if (!centavos(valor) || !valor || !['sinal','saldo'].includes(tipo) ||
          !['pix','dinheiro','credito','debito','transferencia','outro'].includes(meio) ||
          !dataValida(data) || typeof chave !== 'string' || !uuid.test(chave)) {
        return res.status(400).json({ mensagem: 'Informe valor, data e forma de pagamento válidos.' });
      }

      async function verificarChave() {
        const { rows: [registro] } = await banco.query(`
          SELECT (${coluna}::bigint=$2 AND valor_centavos=$3 AND tipo=$4 AND meio=$5 AND data=$6::date) AS igual
          FROM aznom_recebimentos WHERE chave=$1
        `, [chave, req.params.id, valor, tipo, meio, data]);
        return registro;
      }

      const registro = await verificarChave();
      if (registro) {
        if (registro.igual) return res.sendStatus(204);
        return res.status(409).json({ mensagem: 'O identificador de recebimento já foi usado.' });
      }

      try {
        const { rowCount } = await banco.query(`
          WITH pago AS (
            UPDATE ${tabela} SET
              sinal_centavos=sinal_centavos+CASE WHEN $2='sinal' THEN $1 ELSE 0 END,
              restante_pago_centavos=restante_pago_centavos+CASE WHEN $2='saldo' THEN $1 ELSE 0 END
            WHERE id::bigint=$6 AND $4::date <= (now() AT TIME ZONE '${fuso}')::date
              AND $1 <= valor_centavos-sinal_centavos-restante_pago_centavos
            RETURNING id
          )
          INSERT INTO aznom_recebimentos (${coluna}, valor_centavos, tipo, meio, data, chave)
          SELECT id,$1,$2,$3,$4,$5 FROM pago
        `, [valor, tipo, meio, data, chave, req.params.id]);
        if (!rowCount) {
          const repetido = await verificarChave();
          if (!repetido?.igual) return res.status(409).json({ mensagem: 'Confira a data e o saldo em aberto antes de registrar.' });
        }
      } catch (erro) {
        if (erro.constraint !== 'aznom_recebimentos_chave_key') throw erro;
        const repetido = await verificarChave();
        if (!repetido?.igual) return res.status(409).json({ mensagem: 'O identificador de recebimento já foi usado.' });
      }
      res.sendStatus(204);
    }));

    app.patch(caminho + '/recebimentos/:recebimentoId(\\d{1,10})/estornar', ...restrito, rota(async (req, res) => {
      const { rowCount } = await banco.query(`
        WITH original AS MATERIALIZED (
          SELECT id,${coluna},valor_centavos,tipo FROM aznom_recebimentos
          WHERE id::bigint=$1 AND ${coluna}::bigint=$2 AND estornado_em IS NULL FOR UPDATE
        ), atualizado AS (
          UPDATE ${tabela} p SET
            sinal_centavos=p.sinal_centavos-CASE WHEN r.tipo='sinal' THEN r.valor_centavos ELSE 0 END,
            restante_pago_centavos=p.restante_pago_centavos-CASE WHEN r.tipo='saldo' THEN r.valor_centavos ELSE 0 END
          FROM original r WHERE p.id=r.${coluna} RETURNING r.id
        )
        UPDATE aznom_recebimentos SET estornado_em=now() WHERE id IN (SELECT id FROM atualizado)
      `, [req.params.recebimentoId, req.params.id]);
      if (!rowCount) return res.status(409).json({ mensagem: 'Este recebimento já foi estornado ou não está disponível.' });
      res.sendStatus(204);
    }));
  }

  app.get(prefixo + 'recebimentos', ...restrito, rota(async (req, res) => {
    const { mes } = req.query;
    if (typeof mes !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(mes) || !dataValida(mes + '-01')) {
      return res.status(400).json({ mensagem: 'Selecione um mês válido.' });
    }
    const { rows: [resumo] } = await banco.query(`
      WITH periodo AS (SELECT $1::date AS inicio, ($1::date + interval '1 month') AS fim),
      movimentos AS (
        SELECT r.id, r.valor_centavos, r.data AS data, r.meio, false AS estorno,
          coalesce(a.cliente,m.nome) AS cliente, r.atendimento_id, r.matricula_id
        FROM aznom_recebimentos r LEFT JOIN aznom_atendimentos a ON a.id=r.atendimento_id
          LEFT JOIN aznom_matriculas m ON m.id=r.matricula_id CROSS JOIN periodo p
        WHERE r.data>=p.inicio AND r.data<p.fim
        UNION ALL
        SELECT r.id, r.valor_centavos, (r.estornado_em AT TIME ZONE '${fuso}')::date, r.meio, true,
          coalesce(a.cliente,m.nome), r.atendimento_id, r.matricula_id
        FROM aznom_recebimentos r LEFT JOIN aznom_atendimentos a ON a.id=r.atendimento_id
          LEFT JOIN aznom_matriculas m ON m.id=r.matricula_id CROSS JOIN periodo p
        WHERE (r.estornado_em AT TIME ZONE '${fuso}') >= p.inicio
          AND (r.estornado_em AT TIME ZONE '${fuso}') < p.fim AND r.data IS NOT NULL
      )
      SELECT coalesce((SELECT sum(valor_centavos) FROM movimentos WHERE NOT estorno),0) AS entradas,
        coalesce((SELECT sum(valor_centavos) FROM movimentos WHERE estorno),0) AS estornos,
        (coalesce((SELECT sum(valor_centavos-sinal_centavos-restante_pago_centavos)
          FROM aznom_atendimentos WHERE status<>'cancelado'),0) +
         coalesce((SELECT sum(valor_centavos-sinal_centavos-restante_pago_centavos)
          FROM aznom_matriculas WHERE cancelada_em IS NULL),0)) AS saldo_atual,
        (SELECT count(*)::integer FROM aznom_atendimentos a CROSS JOIN periodo p
          WHERE (a.entregue_em AT TIME ZONE '${fuso}')>=p.inicio AND (a.entregue_em AT TIME ZONE '${fuso}')<p.fim) AS entregues,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'valor_centavos',valor_centavos,'data',to_char(data,'YYYY-MM-DD'),
          'meio',meio,'estorno',estorno,'cliente',cliente,'atendimento_id',atendimento_id,'matricula_id',matricula_id)
          ORDER BY data DESC, id DESC, estorno DESC) FROM movimentos),'[]') AS movimentos
    `, [mes + '-01']);
    res.json(resumo);
  }));
};
