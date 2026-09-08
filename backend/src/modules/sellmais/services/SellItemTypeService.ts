import { z } from 'zod';

export interface FieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'number' | 'integer' | 'money' | 'date' | 'enum' | 'boolean';
  required?: boolean;
  options?: string[];
  unit?: string;
  showInPublic?: boolean;
}

export class SellItemTypeService {
  static async listTypes(db: any, tenantId: string) {
    await this.ensureDefaults(db, tenantId);
    return db.sellItemType.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' }
    });
  }

  static async getTypeById(db: any, tenantId: string, id: string) {
    const type = await db.sellItemType.findUnique({ where: { id } });
    if (!type || type.tenantId !== tenantId) throw new Error('Tipo de artigo não encontrado.');
    return type;
  }

  static async createType(db: any, tenantId: string, data: {
    key: string;
    name: string;
    icon?: string;
    fields: FieldDefinition[];
  }) {
    return db.sellItemType.create({
      data: {
        tenantId,
        key: data.key.toLowerCase().trim(),
        name: data.name.trim(),
        icon: data.icon || 'archive',
        fields: data.fields as any,
        isSystem: false
      }
    });
  }

  static async updateType(db: any, tenantId: string, id: string, data: {
    name?: string;
    icon?: string;
    fields?: FieldDefinition[];
  }) {
    return db.sellItemType.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name.trim() }),
        ...(data.icon !== undefined && { icon: data.icon }),
        ...(data.fields && { fields: data.fields as any })
      }
    });
  }

  static async deleteType(db: any, tenantId: string, id: string) {
    const existing = await db.sellItemType.findUnique({ where: { id } });
    if (existing?.isSystem) throw new Error('Não é permitido apagar tipos de sistema.');
    return db.sellItemType.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }

  /**
   * Builds a dynamic Zod validator from field definitions and validates attributes JSON.
   */
  static validateAttributes(fields: FieldDefinition[], attributes: Record<string, any>): Record<string, any> {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const f of fields) {
      let schema: z.ZodTypeAny;

      switch (f.type) {
        case 'number':
        case 'money':
          schema = z.number();
          break;
        case 'integer':
          schema = z.number().int();
          break;
        case 'boolean':
          schema = z.boolean();
          break;
        case 'date':
          schema = z.string();
          break;
        case 'enum':
          if (f.options && f.options.length > 0) {
            schema = z.enum(f.options as [string, ...string[]]);
          } else {
            schema = z.string();
          }
          break;
        case 'text':
        default:
          schema = z.string();
          break;
      }

      if (!f.required) {
        schema = schema.optional().nullable();
      }

      shape[f.key] = schema;
    }

    const dynamicZod = z.object(shape).passthrough();
    return dynamicZod.parse(attributes || {});
  }

  static async ensureDefaults(db: any, tenantId: string) {
    const count = await db.sellItemType.count({ where: { tenantId } });
    if (count > 0) return;

    const defaults = [
      {
        key: 'mobiliario',
        name: 'Mobiliário & Decoração',
        icon: 'archive',
        fields: [
          { key: 'madeira', label: 'Tipo de Madeira', type: 'text', required: false, showInPublic: true },
          { key: 'estilo', label: 'Estilo Artístico', type: 'text', required: false, showInPublic: true },
          { key: 'gavetas', label: 'Número de Gavetas', type: 'integer', required: false, showInPublic: true },
          { key: 'restaurado', label: 'Peça Restaurada', type: 'boolean', required: false, showInPublic: true }
        ]
      },
      {
        key: 'pintura',
        name: 'Pintura & Artes Plásticas',
        icon: 'image',
        fields: [
          { key: 'tecnica', label: 'Técnica / Suporte', type: 'text', required: false, showInPublic: true },
          { key: 'autor', label: 'Artista / Pintor', type: 'text', required: false, showInPublic: true },
          { key: 'assinado', label: 'Assinado pelo Autor', type: 'boolean', required: false, showInPublic: true },
          { key: 'comMoldura', label: 'Inclui Moldura', type: 'boolean', required: false, showInPublic: true }
        ]
      },
      {
        key: 'relogio',
        name: 'Relojoaria & Cronómetros',
        icon: 'clock',
        fields: [
          { key: 'marca', label: 'Marca / Fabricante', type: 'text', required: false, showInPublic: true },
          { key: 'movimento', label: 'Mecanismo', type: 'enum', options: ['Automático', 'Manual', 'Quartzo'], required: false, showInPublic: true },
          { key: 'materialCaixa', label: 'Material da Caixa', type: 'text', required: false, showInPublic: true },
          { key: 'caixaOriginal', label: 'Caixa / Documentos Originais', type: 'boolean', required: false, showInPublic: true }
        ]
      },
      {
        key: 'joia',
        name: 'Joalharia & Metais Preciosos',
        icon: 'gem',
        fields: [
          { key: 'metal', label: 'Metal Precioso', type: 'enum', options: ['Ouro 19.2k', 'Ouro 18k', 'Prata 925', 'Platina'], required: false, showInPublic: true },
          { key: 'pesoGramas', label: 'Peso (gramas)', type: 'number', required: false, showInPublic: true },
          { key: 'pedrasPreciosas', label: 'Gemas / Pedras', type: 'text', required: false, showInPublic: true },
          { key: 'contrastaria', label: 'Marca de Contrastaria Oficial', type: 'boolean', required: false, showInPublic: true }
        ]
      },
      {
        key: 'vinil',
        name: 'Discos de Vinil & Música',
        icon: 'disc',
        fields: [
          { key: 'artista', label: 'Artista / Banda', type: 'text', required: false, showInPublic: true },
          { key: 'album', label: 'Título do Álbum', type: 'text', required: false, showInPublic: true },
          { key: 'anoEdicao', label: 'Ano de Edição', type: 'integer', required: false, showInPublic: true },
          { key: 'estadoDisco', label: 'Graduação do Vinil', type: 'enum', options: ['Mint (M)', 'Near Mint (NM)', 'Very Good Plus (VG+)', 'Very Good (VG)', 'Good (G)'], required: false, showInPublic: true }
        ]
      }
    ];

    for (const d of defaults) {
      await db.sellItemType.create({
        data: {
          tenantId,
          key: d.key,
          name: d.name,
          icon: d.icon,
          fields: d.fields,
          isSystem: true
        }
      }).catch(() => {});
    }
  }
}
