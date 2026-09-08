import { prisma } from '../../../database/prisma/client';

export class SellPublicCatalogService {
  /**
   * Generates public SSR catalog HTML page.
   */
  static async renderStorefrontHtml(tenantId?: string): Promise<string> {
    const where: any = {
      status: 'AVAILABLE',
      deletedAt: null
    };
    if (tenantId) where.tenantId = tenantId;

    const items = await prisma.sellItem.findMany({
      where,
      take: 50,
      include: {
        type: true,
        media: { where: { isCover: true, deletedAt: null }, take: 1 }
      },
      orderBy: { availableSince: 'desc' }
    });

    const itemsHtml = items.map((it: any) => {
      const coverUrl = it.media[0]?.url || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="200" fill="%23222"%3E%3Crect width="300" height="200"/%3E%3Ctext x="50%25" y="50%25" fill="%23888" text-anchor="middle"%3ESem Imagem%3C/text%3E%3C/svg%3E';
      const priceStr = it.askingPriceCents ? `${(it.askingPriceCents / 100).toFixed(2)} €` : 'Sob Consulta';

      return `
        <article style="background:#131b2e; border:1px solid #1f2d4d; border-radius:12px; overflow:hidden; display:flex; flex-direction:column;">
          <a href="/loja/artigo/${it.slug}" style="text-decoration:none; color:inherit;">
            <img src="${coverUrl}" alt="${it.title}" style="width:100%; height:220px; object-fit:cover;" loading="lazy">
            <div style="padding:16px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <span style="font-size:0.75rem; color:#8b949e; text-transform:uppercase; letter-spacing:0.05em;">${it.type?.name || 'Artigo'}</span>
                <h2 style="font-size:1.1rem; margin:6px 0 10px; color:#f0f6fc;">${it.title}</h2>
                <p style="font-size:0.85rem; color:#8b949e; margin:0 0 12px; line-height:1.4;">${it.shortDescription || ''}</p>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #1f2d4d; padding-top:12px;">
                <span style="font-size:1.2rem; font-weight:800; color:#3fb950;">${priceStr}</span>
                <span style="font-size:0.85rem; color:#58a6ff; font-weight:600;">Ver Detalhe →</span>
              </div>
            </div>
          </a>
        </article>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>2SELLMAIS · Catálogo de Antiguidades & Colecionismo</title>
  <meta name="description" content="Catálogo exclusivo de antiguidades, arte, joalharia e peças de colecção certificadas.">
  <meta property="og:title" content="2SELLMAIS · Catálogo de Antiguidades">
  <meta property="og:description" content="Peças exclusivas e antiguidades certificadas.">
  <meta property="og:type" content="website">
  <style>
    body { margin:0; padding:0; background:#090d16; color:#f0f6fc; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
    header { background:#131b2e; border-bottom:1px solid #1f2d4d; padding:20px; text-align:center; }
    .container { max-width:1100px; margin:0 auto; padding:24px 16px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:20px; }
  </style>
</head>
<body>
  <header>
    <h1 style="margin:0; font-size:1.5rem; color:#f0f6fc; letter-spacing:-0.02em;">2SELLMAIS · Galeria & Antiguidades</h1>
    <p style="margin:6px 0 0; color:#8b949e; font-size:0.9rem;">Coleções raras, mobiliário de época, pintura e joalharia histórica</p>
  </header>
  <main class="container">
    <div class="grid">${itemsHtml}</div>
  </main>
</body>
</html>`;
  }

  /**
   * Generates public SSR Item Detail page with strict whitelist and JSON-LD Product schema.
   */
  static async renderItemHtml(slug: string): Promise<{ html: string; found: boolean }> {
    const item = await prisma.sellItem.findFirst({
      where: {
        slug,
        status: 'AVAILABLE',
        deletedAt: null
      },
      include: {
        type: true,
        media: { where: { deletedAt: null }, orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }] },
        provenance: { where: { isPublic: true } }
      }
    });

    if (!item) {
      return {
        found: false,
        html: `<!DOCTYPE html><html lang="pt"><head><title>Artigo Não Encontrado</title></head><body style="background:#090d16; color:#fff; text-align:center; padding:50px;"><h1>Artigo Indisponível</h1><p>Esta peça já não se encontra disponível para venda.</p><a href="/loja" style="color:#58a6ff;">Voltar à Loja</a></body></html>`
      };
    }

    // STRICT WHITELIST: only public fields are included
    const coverUrl = item.media[0]?.url || '';
    const priceFormatted = item.askingPriceCents ? `${(item.askingPriceCents / 100).toFixed(2)} €` : 'Preço sob consulta';

    // JSON-LD Structured Data
    const jsonLd = {
      "@context": "https://schema.org/",
      "@type": "Product",
      "name": item.title,
      "image": item.media.map((m: any) => m.url),
      "description": item.description || item.shortDescription || item.title,
      "sku": item.code,
      "offers": {
        "@type": "Offer",
        "url": `/loja/artigo/${item.slug}`,
        "priceCurrency": "EUR",
        "price": item.askingPriceCents ? (item.askingPriceCents / 100).toFixed(2) : "0",
        "availability": "https://schema.org/InStock"
      }
    };

    const publicAttributesHtml = Object.entries(item.attributes as Record<string, any> || {})
      .map(([k, v]) => `<li style="margin-bottom:6px;"><strong style="color:#8b949e; text-transform:capitalize;">${k}:</strong> ${v}</li>`)
      .join('');

    const html = `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${item.title} · 2SELLMAIS</title>
  <meta name="description" content="${(item.shortDescription || item.title).replace(/"/g, '&quot;')}">
  <meta property="og:title" content="${item.title} · 2SELLMAIS">
  <meta property="og:description" content="${(item.shortDescription || item.title).replace(/"/g, '&quot;')}">
  <meta property="og:image" content="${coverUrl}">
  <meta property="og:type" content="product">
  <script type="application/ld+json">
    ${JSON.stringify(jsonLd)}
  </script>
  <style>
    body { margin:0; padding:0; background:#090d16; color:#f0f6fc; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
    header { background:#131b2e; border-bottom:1px solid #1f2d4d; padding:16px 24px; display:flex; justify-content:space-between; align-items:center; }
    .container { max-width:1000px; margin:0 auto; padding:32px 16px; display:grid; grid-template-columns:1fr 1fr; gap:32px; }
    @media(max-width:768px) { .container { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header>
    <a href="/loja" style="color:#f0f6fc; text-decoration:none; font-weight:700; font-size:1.1rem;">← 2SELLMAIS</a>
    <span style="color:#8b949e; font-size:0.85rem;">Referência: ${item.code}</span>
  </header>
  <main class="container">
    <div>
      <img src="${coverUrl}" alt="${item.title}" style="width:100%; border-radius:14px; border:1px solid #1f2d4d;" loading="eager">
    </div>
    <div>
      <span style="font-size:0.8rem; color:#8b949e; text-transform:uppercase; letter-spacing:0.05em;">${item.type?.name || ''}</span>
      <h1 style="font-size:1.8rem; margin:8px 0 16px; color:#f0f6fc;">${item.title}</h1>
      <div style="font-size:2rem; font-weight:800; color:#3fb950; margin-bottom:24px;">${priceFormatted}</div>

      <div style="margin-bottom:24px; line-height:1.6; color:#c9d1d9;">
        ${item.description || item.shortDescription || 'Sem descrição detalhada.'}
      </div>

      ${publicAttributesHtml ? `
        <div style="background:#131b2e; border:1px solid #1f2d4d; border-radius:12px; padding:16px; margin-bottom:24px;">
          <h3 style="margin:0 0 10px; font-size:0.95rem; color:#f0f6fc;">Características da Peça</h3>
          <ul style="margin:0; padding-left:18px; font-size:0.85rem; color:#f0f6fc;">
            ${publicAttributesHtml}
          </ul>
        </div>
      ` : ''}

      <div style="padding:16px; background:rgba(13,65,159,0.15); border:1px solid #1f6feb; border-radius:12px; font-size:0.85rem; color:#8b949e;">
        Para reservas, peritagem ou agendamento de visita à galeria, contacte o nosso serviço de atendimento comercial.
      </div>
    </div>
  </main>
</body>
</html>`;

    return { html, found: true };
  }
}
