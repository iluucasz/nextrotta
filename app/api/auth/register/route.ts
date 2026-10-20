import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'O cadastro e realizado apenas pelo administrador da plataforma.' },
    { status: 403 }
  );
}
