import { NextResponse } from 'next/server';
import { raiseTicketFromFinding } from '@/lib/data';

export async function POST(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  try {
    const { ref: newRef } = await raiseTicketFromFinding(ref);
    return NextResponse.json({ ref: newRef });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'failed' }, { status: 500 });
  }
}
