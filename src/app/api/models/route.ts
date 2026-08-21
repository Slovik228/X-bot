// GET /api/models — list available models (registry).

import { NextResponse } from 'next/server';
import { MODELS } from '@/lib/bot/registry';

export async function GET() {
  return NextResponse.json({ models: MODELS });
}
