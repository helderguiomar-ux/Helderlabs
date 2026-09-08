export class HccallScopeService {
  /**
   * Resolves visibility scope for HCCALL queries.
   * Returns { ownerUserId: userId } when visibility is 'OWN' (default),
   * or {} (full tenant) when 'TEAM'.
   */
  static async getVisibilityScope(
    db: any,
    tenantId: string,
    userId: string
  ): Promise<{ ownerUserId?: string }> {
    try {
      const setting = await db.tenantSetting.findFirst({
        where: {
          tenantId,
          key: 'hccall.visibility'
        }
      });

      const mode = (setting?.value || 'OWN').toUpperCase();
      if (mode === 'TEAM') {
        return {};
      }
    } catch {
      // Default to OWN on error / missing model
    }

    return { ownerUserId: userId };
  }
}
