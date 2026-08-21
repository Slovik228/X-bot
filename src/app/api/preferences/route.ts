// GET/POST /api/preferences — user default-model preferences.
// GET  ?handle=foo
// POST { handle, defaultModel, defaultAction? }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const handle = req.nextUrl.searchParams.get('handle');
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });
  const pref = await db.userPref.findUnique({ where: { handle } });
  return NextResponse.json({
    defaultModel: pref?.defaultModel || 'auto',
    defaultAction: pref?.defaultAction || null,
  });
}

export async function POST(req: NextRequest) {
  const { handle, defaultModel, defaultAction } = (await req.json().catch(() => ({}))) as {
    handle?: string;
    defaultModel?: string;
    defaultAction?: string | null;
  };
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });
  const pref = await db.userPref.upsert({
    where: { handle },
    update: {
      defaultModel: defaultModel || undefined,
      defaultAction: defaultAction === undefined ? undefined : defaultAction,
    },
    create: {
      handle,
      defaultModel: defaultModel || 'auto',
      defaultAction: defaultAction || null,
    },
  });
  return NextResponse.json({ ok: true, preference: pref });
}
