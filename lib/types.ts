export type UserRole = 'platform_owner' | 'admin' | 'technician'
export type OrganizationStatus = 'provisioning' | 'active' | 'past_due' | 'suspended' | 'canceled'
export type TechnicianStatus = 'active' | 'inactive'
export type DiscountType = 'discount' | 'advance' | 'other'
export type ScheduleStatus = 'scheduled' | 'completed' | 'cancelled'
export type ServiceFortnight = 'Q1' | 'Q2'
export type FinancialEntryType = 'payable' | 'receivable'
export type FinancialEntryStatus = 'pending' | 'paid'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  technician_id?: string
  /** Null only for the platform owner. */
  organization_id: string | null
  organization_slug: string | null
}

export interface Technician {
  id: string
  user_id?: string
  qra?: string
  /** Nome (ou trecho dele) como aparece nas buscas de serviço do Porto — usado pra casar serviços
   * com o técnico quando o nome cadastrado no sistema é diferente do exibido lá. */
  porto_name_hint?: string
  name: string
  email?: string
  /** WhatsApp number for notifications. Optional — technicians without one are simply skipped. */
  phone?: string | null
  commission_percentage: number
  base_salary: number
  va_allowance: number
  vr_allowance: number
  status: TechnicianStatus
  created_at: string
  updated_at: string
}

export interface Service {
  id: string
  order_code: string
  technician_id: string
  service_type: string
  value: number
  date_performed: string
  time_performed?: string
  competence_month: string
  fortnight_period?: ServiceFortnight | null
  description?: string
  created_at: string
  technician_name?: string
}

export interface WorkHours {
  id: string
  technician_id: string
  date: string
  start_time: string
  end_time: string
  hours_worked: number
  week_number?: number
  month?: number
  year?: number
  created_at: string
}

export interface Schedule {
  id: string
  technician_id: string
  date: string
  start_time?: string
  end_time?: string
  status: ScheduleStatus
  notes?: string
  created_at: string
  technician_name?: string
}

export interface Discount {
  id: string
  technician_id: string
  type: DiscountType
  amount: number
  reason?: string
  competence_month: string
  created_at: string
  technician_name?: string
}

export interface Payroll {
  id: string
  technician_id: string
  competence_month: string
  total_services_value: number
  commission_value: number
  base_salary: number
  va_deduction: number
  vr_deduction: number
  discounts_total: number
  advances_total: number
  extra_hours_value: number
  extraordinary_award_value?: number
  hour_bank_balance: number
  net_total: number
  status?: PayrollStatus
  created_at: string
  updated_at: string
  technician_name?: string
}

export type PayrollStatus = 'draft' | 'closed'

export interface FinancialEntry {
  id: string
  type: FinancialEntryType
  description: string
  category: string
  amount: number
  due_date: string
  competence_month: string
  status: FinancialEntryStatus
  paid_amount?: number
  paid_at?: string | null
  series_id?: string | null
  installment_number?: number
  installment_total?: number
  is_recurring?: boolean
  notes?: string | null
  created_at: string
  updated_at?: string
}

export interface LibraryDocument {
  id: string
  title: string
  category: string
  audience: string
  technician_id?: string | null
  technician_name?: string | null
  updatedAt: string
  type: string
  url?: string
  uploadedBy?: string
}

export interface DashboardStats {
  totalTechnicians: number
  activeTechnicians: number
  totalServices: number
  totalServicesValue: number
  pendingSchedules: number
}

export interface TechnicianDashboardData {
  technician: Technician
  currentMonthServices: Service[]
  currentMonthPayroll: Payroll | null
  hoursWorked: WorkHours[]
  upcomingSchedule: Schedule[]
  hourBankBalance: number
}
