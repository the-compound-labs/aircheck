import { NextResponse } from 'next/server';
import { studio } from '@/server/studio';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const s = studio(new URL(req.url).searchParams.get('day') || undefined);
  return NextResponse.json({ day: s.day, items: [...s.queue, ...s.emails] });
}
