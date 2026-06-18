import { NextResponse } from 'next/server';
import { updateFindingStatus } from '@/lib/data';

export async function PATCH(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  try {
    const body = await req.json();
    const status = body?.status;
    if (!status || typeof status !== 'string') {
      return NextResponse.json({ error: 'status required' }, { status: 400 });
    }
    await updateFindingStatus(ref, status);
    return NextResponse.json({ ok: true, ref, status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'failed' }, { status: 500 });
  }
}
