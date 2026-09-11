export async function recordAudit(db: D1Database, actor: string, action: string, resourceType: string, resourceId?: string, details?: unknown) {
  await db.prepare(`INSERT INTO audit_events(id,event_type,actor,action,resource_type,resource_id,details)
    VALUES(?,'security_audit',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), actor, action, resourceType, resourceId || null, details === undefined ? null : JSON.stringify(details)).run();
}
