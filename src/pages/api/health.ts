/**
 * PG Hunter — liveness / readiness probe.
 *
 * Intended for a Cloudflare Worker Health Check binding or an uptime monitor.
 * Deliberately returns only booleans and a timestamp: no version string, no
 * host names, no bucket names, no error text. A health endpoint is a
 * reconnaissance target, and this one should tell an attacker nothing beyond
 * "up" and "database reachable".
 */

import type { APIRoute } from 'astro';
import { getDb } from '@/lib/server/auth';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    // SELECT 1 exercises the actual D1 binding end to end, so a broken
    // database_id or a missing migration surfaces here rather than on the
    // first user request.
    await getDb().prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return Response.json(
      { status: 'ok', database: 'reachable', checkedAt: new Date().toISOString() },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return Response.json(
      { status: 'degraded', database: 'unreachable', checkedAt: new Date().toISOString() },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } }
    );
  }
};
