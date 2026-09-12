import crypto from 'node:crypto';

// OVH API Client com assinatura SHA1 nativa (sem dependências externas)
class OvhClient {
  constructor(appKey, appSecret, consumerKey, endpoint = 'https://eu.api.ovh.com/1.0') {
    this.appKey = appKey;
    this.appSecret = appSecret;
    this.consumerKey = consumerKey;
    this.endpoint = endpoint;
    this.timeDelta = 0;
  }

  async initTime() {
    try {
      const res = await fetch(`${this.endpoint}/auth/time`);
      const serverTime = await res.json();
      this.timeDelta = serverTime - Math.round(Date.now() / 1000);
    } catch (e) {
      this.timeDelta = 0;
    }
  }

  async request(method, path, body = null) {
    const now = Math.round(Date.now() / 1000) + this.timeDelta;
    const url = `${this.endpoint}${path}`;
    const bodyStr = body ? JSON.stringify(body) : '';

    const toSign = [
      this.appSecret,
      this.consumerKey,
      method.toUpperCase(),
      url,
      bodyStr,
      String(now)
    ].join('+');

    const signature = '$1$' + crypto.createHash('sha1').update(toSign).digest('hex');

    const headers = {
      'X-Ovh-Application': this.appKey,
      'X-Ovh-Consumer': this.consumerKey,
      'X-Ovh-Timestamp': String(now),
      'X-Ovh-Signature': signature,
      'Content-Type': 'application/json'
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? bodyStr : undefined
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status} ${res.statusText}`);
    }

    return data;
  }
}

async function run() {
  console.log('============================================================');
  console.log('  CONFIGURAÇÃO AUTOMÁTICA DE DNS — OVH & RESEND');
  console.log('  Domínio: helderlabs.eu');
  console.log('============================================================\n');

  const appKey = process.env.OVH_APPLICATION_KEY;
  const appSecret = process.env.OVH_APPLICATION_SECRET;
  const consumerKey = process.env.OVH_CONSUMER_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  let dkimValue = process.env.RESEND_DKIM_VALUE;

  // Valores reais devolvidos pela API do Resend para ESTE domínio.
  // Nunca são inventados nem copiados de exemplos genéricos: se a API
  // estiver acessível, é ela que manda; caso contrário usam-se os valores
  // de recurso documentados mais abaixo (região eu-west-1).
  let spfTxtRecord = null;   // { name, value }
  let spfMxRecord = null;    // { name, value, priority }

  if (!appKey || !appSecret || !consumerKey) {
    console.error('[ERRO] Faltam as credenciais da API da OVH!');
    console.error('Certifique-se de que definiu:');
    console.error('  - OVH_APPLICATION_KEY');
    console.error('  - OVH_APPLICATION_SECRET');
    console.error('  - OVH_CONSUMER_KEY');
    console.error('\nPode gerar estas chaves em: https://eu.api.ovh.com/createToken/?GET=/domain/zone/helderlabs.eu/*&POST=/domain/zone/helderlabs.eu/*&PUT=/domain/zone/helderlabs.eu/*&DELETE=/domain/zone/helderlabs.eu/*');
    process.exit(1);
  }

  // Se tivermos a RESEND_API_KEY, obtemos DKIM, SPF e MX diretamente do Resend.
  // A consulta é feita mesmo que o DKIM já venha do ambiente, porque o SPF e o MX
  // também têm de sair daqui — são específicos deste domínio e desta região.
  if (resendApiKey) {
    try {
      console.log('1. A consultar dados do domínio no Resend...');
      const resendRes = await fetch('https://api.resend.com/domains', {
        headers: { 'Authorization': `Bearer ${resendApiKey}` }
      });
      const resendData = await resendRes.json();
      const domainSummary =
        resendData.data?.find(d => d.name === 'helderlabs.eu') || resendData.data?.[0];

      // A listagem (/domains) não traz os registos; é preciso pedir o domínio.
      let domainObj = domainSummary;
      if (domainSummary?.id && !domainSummary.records) {
        const oneRes = await fetch(`https://api.resend.com/domains/${domainSummary.id}`, {
          headers: { 'Authorization': `Bearer ${resendApiKey}` }
        });
        domainObj = await oneRes.json();
      }

      if (domainObj && Array.isArray(domainObj.records)) {
        const dkimRec = domainObj.records.find(
          r => r.record === 'DKIM' || (r.name || '').includes('_domainkey')
        );
        if (dkimRec && !dkimValue) dkimValue = dkimRec.value;

        const txt = domainObj.records.find(
          r => (r.type || '').toUpperCase() === 'TXT' && (r.value || '').includes('v=spf1')
        );
        if (txt) spfTxtRecord = { name: txt.name, value: txt.value };

        const mx = domainObj.records.find(r => (r.type || '').toUpperCase() === 'MX');
        if (mx) spfMxRecord = { name: mx.name, value: mx.value, priority: mx.priority };

        console.log(`   Registos obtidos do Resend: DKIM ${dkimRec ? 'sim' : 'não'} · SPF ${txt ? 'sim' : 'não'} · MX ${mx ? 'sim' : 'não'}`);
      }
    } catch (e) {
      console.warn('[AVISO] Não foi possível obter os registos via API do Resend:', e.message);
      console.warn('        Serão usados os valores de recurso (eu-west-1). Confirme no painel do Resend antes de verificar o domínio.');
    }
  }

  if (!dkimValue) {
    console.error('[ERRO] É necessário fornecer o valor do DKIM (ou RESEND_API_KEY ou RESEND_DKIM_VALUE).');
    process.exit(1);
  }

  const ovh = new OvhClient(appKey, appSecret, consumerKey);
  await ovh.initTime();

  console.log('2. A ligar à API da OVH para gerir a zona helderlabs.eu...');

  // 1. Obter registos existentes da zona
  const recordIds = await ovh.request('GET', '/domain/zone/helderlabs.eu/record');
  console.log(`   Encontrados ${recordIds.length} registos na zona DNS.`);

  const records = [];
  for (const id of recordIds) {
    const rec = await ovh.request('GET', `/domain/zone/helderlabs.eu/record/${id}`);
    records.push(rec);
  }

  // 2. Configurar DKIM (TXT para resend._domainkey)
  const existingDkim = records.find(r => r.fieldType === 'TXT' && r.subDomain === 'resend._domainkey');
  if (existingDkim) {
    console.log('3. A atualizar registo DKIM existente...');
    await ovh.request('PUT', `/domain/zone/helderlabs.eu/record/${existingDkim.id}`, {
      target: `"${dkimValue.replace(/^"|"$/g, '')}"`
    });
    console.log('   [OK] Registo DKIM atualizado.');
  } else {
    console.log('3. A criar novo registo DKIM (resend._domainkey)...');
    await ovh.request('POST', '/domain/zone/helderlabs.eu/record', {
      fieldType: 'TXT',
      subDomain: 'resend._domainkey',
      target: `"${dkimValue.replace(/^"|"$/g, '')}"`
    });
    console.log('   [OK] Registo DKIM criado.');
  }

  // ---------------------------------------------------------------------------
  // 3. SPF e MX no SUBDOMÍNIO "send" — e não na raiz.
  //
  // Esta secção estava errada. O Resend (região eu-west-1, sobre Amazon SES)
  // exige os dois registos no subdomínio `send`:
  //
  //     TXT  send  =  v=spf1 include:amazonses.com ~all
  //     MX   send  =  feedback-smtp.eu-west-1.amazonses.com   (prioridade 10)
  //
  // A versão anterior escrevia o SPF na RAIZ do domínio e nunca criava o MX.
  // O resultado seria o DKIM a verificar, o SPF a falhar por estar no sítio
  // errado, e o MX ausente — domínio NOT VERIFIED, sem indicação do motivo.
  //
  // Os valores não são escritos à mão: vêm da própria API do Resend (`records`),
  // com estes apenas como recurso caso a API não esteja acessível.
  // ---------------------------------------------------------------------------
  // A OVH espera o subdomínio RELATIVO ("send"); o Resend pode devolver o nome
  // já qualificado ("send.helderlabs.eu"). Normalizar evita criar um registo
  // duplicado em "send.helderlabs.eu.helderlabs.eu".
  const relHost = (name, fallback) => {
    if (!name) return fallback;
    const trimmed = String(name).replace(/\.$/, '');
    if (trimmed === 'helderlabs.eu') return '';
    return trimmed.endsWith('.helderlabs.eu')
      ? trimmed.slice(0, -'.helderlabs.eu'.length)
      : trimmed;
  };

  const spfHost = relHost(spfTxtRecord?.name, 'send');
  const spfValue = spfTxtRecord?.value || 'v=spf1 include:amazonses.com ~all';
  const mxHost = relHost(spfMxRecord?.name, 'send');
  const mxValue = (spfMxRecord?.value || 'feedback-smtp.eu-west-1.amazonses.com').replace(/\.$/, '');
  const mxPriority = spfMxRecord?.priority ?? 10;

  // Salvaguarda: o SPF do Resend nunca deve aterrar na raiz do domínio. Se algo
  // correr mal na leitura da API, parar em vez de escrever no sítio errado.
  if (spfHost === '' || mxHost === '') {
    console.error('[ERRO] O SPF/MX do Resend seria escrito na RAIZ do domínio.');
    console.error('       Isto afetaria o email normal de helderlabs.eu. Abortado.');
    console.error(`       spfTxtRecord=${JSON.stringify(spfTxtRecord)} spfMxRecord=${JSON.stringify(spfMxRecord)}`);
    process.exit(1);
  }

  const existingSendSpf = records.find(
    (r) => r.fieldType === 'TXT' && r.subDomain === spfHost && r.target?.includes('v=spf1')
  );
  if (existingSendSpf) {
    console.log(`4. A atualizar SPF em "${spfHost}"...`);
    await ovh.request('PUT', `/domain/zone/helderlabs.eu/record/${existingSendSpf.id}`, {
      target: `"${spfValue}"`
    });
    console.log(`   [OK] SPF atualizado: ${spfHost} TXT "${spfValue}"`);
  } else {
    console.log(`4. A criar SPF em "${spfHost}"...`);
    await ovh.request('POST', '/domain/zone/helderlabs.eu/record', {
      fieldType: 'TXT',
      subDomain: spfHost,
      target: `"${spfValue}"`
    });
    console.log(`   [OK] SPF criado: ${spfHost} TXT "${spfValue}"`);
  }

  const existingSendMx = records.find((r) => r.fieldType === 'MX' && r.subDomain === mxHost);
  if (existingSendMx) {
    console.log(`5. A atualizar MX em "${mxHost}"...`);
    await ovh.request('PUT', `/domain/zone/helderlabs.eu/record/${existingSendMx.id}`, {
      target: `${mxPriority} ${mxValue}.`
    });
    console.log(`   [OK] MX atualizado: ${mxHost} MX ${mxPriority} ${mxValue}`);
  } else {
    console.log(`5. A criar MX em "${mxHost}"...`);
    await ovh.request('POST', '/domain/zone/helderlabs.eu/record', {
      fieldType: 'MX',
      subDomain: mxHost,
      target: `${mxPriority} ${mxValue}.`
    });
    console.log(`   [OK] MX criado: ${mxHost} MX ${mxPriority} ${mxValue}`);
  }

  // NOTA: o SPF da RAIZ não é tocado. O envio do Resend é autenticado pelo
  // subdomínio `send`, e mexer no SPF da raiz afetaria o email normal do
  // domínio (OVH ou outro fornecedor) sem necessidade nenhuma.
  const rootSpf = records.find(
    (r) => r.fieldType === 'TXT' && (!r.subDomain || r.subDomain === '') && r.target?.includes('v=spf1')
  );
  if (rootSpf) {
    console.log(`   [INFO] SPF da raiz mantido inalterado: ${rootSpf.target}`);
  }

  // 4. Configurar DMARC se não existir
  const existingDmarc = records.find(r => r.fieldType === 'TXT' && r.subDomain === '_dmarc');
  if (!existingDmarc) {
    console.log('6. A criar registo DMARC (_dmarc)...');
    await ovh.request('POST', '/domain/zone/helderlabs.eu/record', {
      fieldType: 'TXT',
      subDomain: '_dmarc',
      target: '"v=DMARC1; p=none; rua=mailto:helderguiomar@gmail.com"'
    });
    console.log('   [OK] Registo DMARC criado.');
  } else {
    console.log('6. [OK] Registo DMARC já existente.');
  }

  // 5. Aplicar e atualizar a zona DNS na OVH
  console.log('7. A solicitar refresh da zona DNS aos servidores de nomes da OVH...');
  await ovh.request('POST', '/domain/zone/helderlabs.eu/refresh');
  console.log('   [OK] Zona DNS atualizada e propagação iniciada!');

  // 6. Se tivermos RESEND_API_KEY, acionar verificação no Resend
  if (resendApiKey) {
    console.log('8. A acionar verificação no Resend...');
    try {
      const resendRes = await fetch('https://api.resend.com/domains', {
        headers: { 'Authorization': `Bearer ${resendApiKey}` }
      });
      const resendData = await resendRes.json();
      const domainObj = resendData.data?.find(d => d.name === 'helderlabs.eu') || resendData.data?.[0];
      if (domainObj) {
        await fetch(`https://api.resend.com/domains/${domainObj.id}/verify`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendApiKey}` }
        });
        console.log('   [OK] Pedido de validação enviado com sucesso ao Resend.');
      }
    } catch (e) {
      console.warn('   [AVISO] Não foi possível chamar verify no Resend:', e.message);
    }
  }

  console.log('\n============================================================');
  console.log('  CONFIGURAÇÃO AUTOMÁTICA CONCLUÍDA COM SUCESSO!');
  console.log('============================================================');
}

run().catch(err => {
  console.error('\n[FALHA NA EXECUÇÃO]', err.message || err);
  process.exit(1);
});
