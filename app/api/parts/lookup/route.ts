import { NextRequest, NextResponse } from 'next/server';
import { findPartByBarcode } from '@/lib/parts/catalog';
import { partsContext, partsError } from '@/lib/parts/route-helpers';
import { getStock } from '@/lib/parts/stock';

export const runtime = 'nodejs';

/** A part by barcode. A technician gets its stock with them and never the organization's cost. */
export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const barcode = request.nextUrl.searchParams.get('barcode') ?? '';
    const part = await findPartByBarcode(context.organizationId, barcode);
    if (!part) return NextResponse.json({ error: `Nenhuma peça cadastrada com o código ${barcode}.` }, { status: 404 });
    if (context.isAdmin) return NextResponse.json({ part });

    const stock = (await getStock(context.organizationId, context.technicianId, [part.id])).get(part.id) ?? 0;
    return NextResponse.json({
      part: {
        id: part.id,
        name: part.name,
        barcode: part.barcode,
        category: part.category,
        brand: part.brand,
        unit: part.unit,
        description: part.description,
        imageUrl: part.imageUrl,
        technicianPrice: part.technicianPrice,
        suggestedPrice: part.suggestedPrice,
        stock,
      },
    });
  } catch (error) {
    return partsError(error, 'lookup');
  }
}
