import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

const WORKFLOW_PATH = path.join(process.cwd(), 'docs', 'WORKFLOW.md');

export async function GET() {
  try {
    const content = await readFile(WORKFLOW_PATH, 'utf-8');
    return NextResponse.json({ content });
  } catch (err) {
    console.error('Workflow read error:', err);
    return NextResponse.json(
      { error: 'Could not read workflow doc' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const { content } = (await request.json()) as { content?: string };
    if (typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Body must be { content: string }' },
        { status: 400 }
      );
    }
    await writeFile(WORKFLOW_PATH, content, 'utf-8');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Workflow write error:', err);
    return NextResponse.json(
      { error: 'Could not save workflow doc' },
      { status: 500 }
    );
  }
}
