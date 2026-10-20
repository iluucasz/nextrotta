import { NextRequest, NextResponse } from 'next/server';
import { accountSummary, listDebts } from '@/lib/parts/account';
import { getPartsSettings, listTechnicianParts } from '@/lib/parts/catalog';
import { currentMonth } from '@/lib/parts/common';
import { getAccountStatus } from '@/lib/mercadopago/accounts';
import { partsContext, partsError } from '@/lib/parts/route-helpers';
import { listTransfers } from '@/lib/parts/stock';

export const runtime = 'nodejs';

/**
 * Everything the technician's "Minhas peças" screen opens with: their stock, the payment methods,
 * their Mercado Pago connection, what they owe this month and what still needs their confirmation.
 */
export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'technician');
  if (context instanceof NextResponse) return context;
  try {
    const { organizationId } = context;
    const technicianId = context.technicianId!;
    const month = currentMonth();
    const [parts, settings, mercadoPago, summary, transfers, debts] = await Promise.all([
      listTechnicianParts(organizationId, technicianId),
      getPartsSettings(organizationId),
      getAccountStatus(organizationId, technicianId),
      accountSummary(organizationId, month, technicianId),
      listTransfers(organizationId, technicianId),
      listDebts(organizationId, technicianId),
    ]);
    return NextResponse.json({
      month,
      parts,
      paymentMethods: settings.paymentMethods,
      settlementDay: settings.settlementDay,
      mercadoPago,
      account: summary[0] ?? null,
      pendingTransfers: transfers.filter((transfer) => !transfer.acknowledgedAt).map(({ totalCost: _cost, ...transfer }) => transfer),
      pendingDebts: debts.filter((debt) => debt.status === 'active' && !debt.acknowledgedAt),
    });
  } catch (error) {
    return partsError(error, 'technician parts');
  }
}
