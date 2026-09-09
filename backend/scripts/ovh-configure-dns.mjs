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

  if (!appKey || !appSecret || !consumerKey) {
    console.error('[ERRO] Faltam as credenciais da API da OVH!');
    console.error('Certifique-se de que definiu:');
    console.error('  - OVH_APPLICATION_KEY');
    console.error('  - OVH_APPLICATION_SECRET');
    console.error('  - OVH_CONSUMER_KEY');
    console.error('\nPode gerar estas chaves em: https://eu.api.ovh.com/createToken/?GET=/domain/zone/helderlabs.eu/*&POST=/domain/zone/helderlabs.eu/*&PUT=/domain/zone/helderlabs.eu/*&DELETE=/domain/zone/helderlabs.eu/*');
    process.exit(1);
  }

  // Se tivermos a RESEND_API_KEY, obtemos o DKIM diretamente do Resend
  if (resendApiKey && !dkimValue) {
    try {
      console.log('1. A consultar dados do domínio no Resend...');
      const resendRes = await fetch('https://api.resend.com/domains', {
        headers: { 'Authorization': `Bearer ${resendApiKey}` }
      });
      const resendData = await resendRes.json();
      const domainObj = resendData.data?.find(d => d.name === 'helderlabs.eu') || resendData.data?.[0];
      if (domainObj && domainObj.records) {
        const dkimRec = domainObj.records.find(r => r.record === 'DKIM' || r.name.includes('_domainkey'));
        if (dkimRec) dkimValue = dkimRec.value;
      }
    } catch (e) {
      console.warn('[AVISO] Não foi possível obter o DKIM via API do Resend:', e.message);
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

  // 3. Configurar SPF (incluir amazonses.com)
  const existingSpf = records.find(r => r.fieldType === 'TXT' && (!r.subDomain || r.subDomain === '') && r.target?.includes('v=spf1'));
  if (existingSpf) {
    let currentSpf = existingSpf.target.replace(/^"|"$/g, '');
    if (!currentSpf.includes('amazonses.com') && !currentSpf.includes('resend.com')) {
      console.log('4. A atualizar registo SPF para incluir Resend / Amazon SES...');
      const newSpf = currentSpf.replace('-all', 'include:amazonses.com ~all').replace('~all', 'include:amazonses.com ~all');
      await ovh.request('PUT', `/domain/zone/helderlabs.eu/record/${existingSpf.id}`, {
        target: `"${newSpf}"`
      });
      console.log(`   [OK] SPF atualizado para: ${newSpf}`);
    } else {
      console.log('4. [OK] Registo SPF já contém autorização de envio.');
    }
  } else {
    console.log('4. A criar registo SPF com OVH e Resend...');
    await ovh.request('POST', '/domain/zone/helderlabs.eu/record', {
      fieldType: 'TXT',
      subDomain: '',
      target: '"v=spf1 include:mx.ovh.com include:amazonses.com ~all"'
    });
    console.log('   [OK] Registo SPF criado.');
  }

  // 4. Configurar DMARC se não existir
  const existingDmarc = records.find(r => r.fieldType === 'TXT' && r.subDomain === '_dmarc');
  if (!existingDmarc) {
    console.log('5. A criar registo DMARC (_dmarc)...');
    await ovh.request('POST', '/domain/zone/helderlabs.eu/record', {
      fieldType: 'TXT',
      subDomain: '_dmarc',
      target: '"v=DMARC1; p=none; rua=mailto:helderguiomar@gmail.com"'
    });
    console.log('   [OK] Registo DMARC criado.');
  } else {
    console.log('5. [OK] Registo DMARC já existente.');
  }

  // 5. Aplicar e atualizar a zona DNS na OVH
  console.log('6. A solicitar refresh da zona DNS aos servidores de nomes da OVH...');
  await ovh.request('POST', '/domain/zone/helderlabs.eu/refresh');
  console.log('   [OK] Zona DNS atualizada e propagação iniciada!');

  // 6. Se tivermos RESEND_API_KEY, acionar verificação no Resend
  if (resendApiKey) {
    console.log('7. A acionar verificação no Resend...');
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
