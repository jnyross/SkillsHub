import { prisma } from "../index.js";
import type { AuditEvent } from "@prisma/client";

/**
 * Log an audit event (§24.3).
 * Records who did what to which entity.
 */
export async function logAuditEvent(input: {
  entityType: string;
  entityId: string;
  eventType: string;
  actorUserId?: string;
  payload?: Record<string, unknown>;
}): Promise<AuditEvent> {
  return prisma.auditEvent.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: input.eventType,
      actorUserId: input.actorUserId ?? null,
      payloadJson: input.payload ? JSON.stringify(input.payload) : "{}",
    },
  });
}

/**
 * Query audit events for an entity.
 */
export async function getAuditEvents(input: {
  entityType: string;
  entityId: string;
  limit?: number;
}): Promise<AuditEvent[]> {
  return prisma.auditEvent.findMany({
    where: {
      entityType: input.entityType,
      entityId: input.entityId,
    },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 50,
  });
}
