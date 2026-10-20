import type { LibraryDocument, Payroll, Schedule, Service, Technician, WorkHours } from './types';

export const demoTechnicians: Technician[] = [
  {
    id: 'tech-leonilson',
    user_id: 'user-leonilson',
    qra: '611072',
    name: 'Leonilson dos Santos Silva',
    email: 'leonilson@empresa.local',
    commission_percentage: 25,
    base_salary: 2664.53,
    va_allowance: 249,
    vr_allowance: 783,
    status: 'active',
    created_at: '2026-04-01T08:00:00.000Z',
    updated_at: '2026-04-01T08:00:00.000Z',
  },
  {
    id: 'tech-alex-ferreira',
    user_id: 'user-alex-ferreira',
    qra: '611096',
    name: 'Alex Ferreira dos Santos',
    email: 'alex.ferreira@empresa.local',
    commission_percentage: 25,
    base_salary: 2520,
    va_allowance: 249,
    vr_allowance: 783,
    status: 'active',
    created_at: '2026-04-01T08:00:00.000Z',
    updated_at: '2026-04-01T08:00:00.000Z',
  },
  {
    id: 'tech-fabio',
    user_id: 'user-fabio',
    qra: '615183',
    name: 'Fabio Manoel Neri',
    email: 'fabio@empresa.local',
    commission_percentage: 25,
    base_salary: 2580,
    va_allowance: 249,
    vr_allowance: 783,
    status: 'active',
    created_at: '2026-04-01T08:00:00.000Z',
    updated_at: '2026-04-01T08:00:00.000Z',
  },
  {
    id: 'tech-david',
    user_id: 'user-david',
    qra: '610589',
    name: 'David Apolinario Francisco',
    email: 'david@empresa.local',
    commission_percentage: 25,
    base_salary: 2400,
    va_allowance: 249,
    vr_allowance: 783,
    status: 'active',
    created_at: '2026-04-01T08:00:00.000Z',
    updated_at: '2026-04-01T08:00:00.000Z',
  },
  {
    id: 'tech-jefferson',
    user_id: 'user-jefferson',
    qra: '429414',
    name: 'Jefferson de Lima Feitosa',
    email: 'jefferson@empresa.local',
    commission_percentage: 25,
    base_salary: 2480,
    va_allowance: 249,
    vr_allowance: 783,
    status: 'active',
    created_at: '2026-04-01T08:00:00.000Z',
    updated_at: '2026-04-01T08:00:00.000Z',
  },
  {
    id: 'tech-marcelo',
    user_id: 'user-marcelo',
    qra: '145246',
    name: 'Marcelo Gonçalves Veríssimo',
    email: 'marcelo@empresa.local',
    commission_percentage: 25,
    base_salary: 2300,
    va_allowance: 249,
    vr_allowance: 783,
    status: 'inactive',
    created_at: '2026-04-01T08:00:00.000Z',
    updated_at: '2026-04-01T08:00:00.000Z',
  },
];

const serviceTypes = [
  'Hidráulica',
  'Elétrica',
  'Kit Fixação',
  'Desentupimento',
  'Revisa/Repara Hidráulica',
  'Apoio Operacional Básico',
  'Ventilador De Teto',
  'Instalação/Ligação Elétrica',
];

const serviceValues = [52, 91, 115, 128, 144, 140, 168, 122];

const serviceCountsByTechnician: Record<string, number> = {
  'tech-leonilson': 166,
  'tech-alex-ferreira': 149,
  'tech-fabio': 159,
  'tech-david': 56,
  'tech-jefferson': 87,
  'tech-marcelo': 5,
};

export const demoServices: Service[] = demoTechnicians.flatMap((technician, technicianIndex) => {
  const count = serviceCountsByTechnician[technician.id] ?? 0;

  return Array.from({ length: count }, (_, index) => {
    const value = serviceValues[(index + technicianIndex) % serviceValues.length];
    const day = String((index % 27) + 1).padStart(2, '0');
    const competence = index < Math.ceil(count / 2) ? 'ABR.2026.1Q' : 'ABR.2026.2Q';

    return {
      id: `service-${technician.id}-${index + 1}`,
      order_code: `09/${String(2143000 + technicianIndex * 28000 + index * 17).padStart(7, '0')}-26`,
      technician_id: technician.id,
      technician_name: technician.name,
      service_type: serviceTypes[(index + technicianIndex) % serviceTypes.length],
      value,
      date_performed: `2026-04-${day}T${String(8 + (index % 10)).padStart(2, '0')}:00:00.000Z`,
      competence_month: competence,
      description: 'Importado do contexto de produção',
      created_at: '2026-04-30T18:00:00.000Z',
    };
  });
});

export const demoWorkHours: WorkHours[] = demoTechnicians
  .filter((technician) => technician.status === 'active')
  .flatMap((technician, technicianIndex) =>
    Array.from({ length: 22 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      const hoursWorked = 8 + ((index + technicianIndex) % 4) * 0.45 + (index % 5 === 0 ? 0.55 : 0);

      return {
        id: `hours-${technician.id}-${index + 1}`,
        technician_id: technician.id,
        date: `2026-04-${day}T03:00:00.000Z`,
        start_time: index % 5 === 0 ? '08:10' : '08:00',
        end_time: index % 5 === 0 ? '17:42' : '17:12',
        hours_worked: Number(hoursWorked.toFixed(2)),
        week_number: 14 + Math.floor(index / 5),
        month: 4,
        year: 2026,
        created_at: '2026-04-30T18:00:00.000Z',
      };
    }),
  );

export const demoSchedule: Schedule[] = demoTechnicians
  .filter((technician) => technician.status === 'active')
  .flatMap((technician, technicianIndex) =>
    Array.from({ length: 7 }, (_, index) => {
      const isDayOff = (index + technicianIndex) % 6 === 5;

      return {
        id: `schedule-${technician.id}-${index + 1}`,
        technician_id: technician.id,
        technician_name: technician.name,
        date: `2026-05-${String(18 + index).padStart(2, '0')}T03:00:00.000Z`,
        start_time: isDayOff ? undefined : '08:00',
        end_time: isDayOff ? undefined : '17:00',
        status: isDayOff ? 'cancelled' : index < 2 ? 'completed' : 'scheduled',
        notes: isDayOff ? 'Folga planejada' : 'Escala seguradora',
        created_at: '2026-05-18T09:00:00.000Z',
      };
    }),
  );

function calculateDemoExtraordinaryAward(serviceCount: number) {
  if (serviceCount >= 160) return 600;
  if (serviceCount >= 80) return 250;
  return 0;
}

export const demoPayroll: Payroll[] = demoTechnicians.map((technician) => {
  const services = demoServices.filter((service) => service.technician_id === technician.id);
  const totalServicesValue = services.reduce((total, service) => total + Number(service.value), 0);
  const fixedCompensation = Number(technician.base_salary) + Number(technician.va_allowance) + Number(technician.vr_allowance);
  const commission = Math.max(0, totalServicesValue - fixedCompensation);
  const extraordinaryAward = calculateDemoExtraordinaryAward(services.length);
  const advance = technician.id === 'tech-leonilson' ? 1100 : 700;
  const discounts = technician.id === 'tech-leonilson' ? 250 : 120;
  const extraHours = technician.id === 'tech-fabio' ? 310 : technician.id === 'tech-leonilson' ? 0 : 180;
  const netTotal =
    Number(technician.base_salary) +
    commission +
    extraordinaryAward +
    extraHours -
    advance -
    discounts;

  return {
    id: `payroll-${technician.id}`,
    technician_id: technician.id,
    technician_name: technician.name,
    competence_month: 'ABR.2026',
    total_services_value: Number(totalServicesValue.toFixed(2)),
    commission_value: Number(commission.toFixed(2)),
    base_salary: technician.base_salary,
    va_deduction: technician.va_allowance,
    vr_deduction: technician.vr_allowance,
    discounts_total: discounts,
    advances_total: advance,
    extra_hours_value: extraHours,
    extraordinary_award_value: extraordinaryAward,
    hour_bank_balance: technician.id === 'tech-leonilson' ? 9.5 : technician.id === 'tech-alex-ferreira' ? -3.2 : 6.4,
    net_total: Number(netTotal.toFixed(2)),
    created_at: '2026-04-30T18:00:00.000Z',
    updated_at: '2026-04-30T18:00:00.000Z',
  };
});

export const demoDocuments: LibraryDocument[] = [
  {
    id: 'doc-cobertura',
    title: 'Coberturas por seguradora',
    category: 'Cobertura',
    audience: 'Global',
    updatedAt: '2026-05-28',
    type: 'PDF',
    uploadedBy: 'operacao@empresa.local',
  },
  {
    id: 'doc-procedimento',
    title: 'Procedimento de atendimento residencial',
    category: 'Operação',
    audience: 'Global',
    updatedAt: '2026-05-27',
    type: 'PDF',
    uploadedBy: 'supervisao@empresa.local',
  },
  {
    id: 'doc-politica-horas',
    title: 'Política de banco de horas',
    category: 'RH',
    audience: 'Global',
    updatedAt: '2026-05-24',
    type: 'PDF',
    uploadedBy: 'rh@empresa.local',
  },
  {
    id: 'doc-fechamento-admin',
    title: 'Roteiro de fechamento financeiro mensal',
    category: 'Financeiro',
    audience: 'Administrativo',
    updatedAt: '2026-05-30',
    type: 'PDF',
    uploadedBy: 'financeiro@empresa.local',
  },
  {
    id: 'doc-auditoria-admin',
    title: 'Checklist de auditoria interna e conformidade',
    category: 'Compliance',
    audience: 'Administrativo',
    updatedAt: '2026-05-22',
    type: 'PDF',
    uploadedBy: 'diretoria@empresa.local',
  },
  {
    id: 'doc-kit-individual',
    title: 'Kit individual de onboarding operacional',
    category: 'Treinamento',
    audience: 'Individual',
    updatedAt: '2026-05-26',
    type: 'PDF',
    uploadedBy: 'treinamento@empresa.local',
  },
  {
    id: 'doc-termo-individual',
    title: 'Termo individual de responsabilidade por equipamentos',
    category: 'RH',
    audience: 'Individual',
    updatedAt: '2026-05-20',
    type: 'PDF',
    uploadedBy: 'rh@empresa.local',
  },
];
