import {
  PhoneCall, PhoneOff, PhoneMissed, Voicemail, Ban,
  CheckCircle2, XCircle, CalendarClock, RotateCcw,
  Instagram, MessageCircle, Globe, Users,
} from "lucide-react"

export type LeadSource = "INSTAGRAM" | "WHATSAPP" | "SITE" | "MANUAL"
export type LeadStatus = "NEW" | "CONTACTED" | "CONVERTED" | "LOST"
export type CallStatus = "ANSWERED" | "NO_ANSWER" | "BUSY" | "VOICEMAIL" | "WRONG_NUMBER"
export type CallOutcome = "SERVICE_ACCEPTED" | "SERVICE_DECLINED" | "CALLBACK_REQUESTED" | "NO_INTEREST"
export type FollowUpStatus = "PENDING" | "COMPLETED" | "CANCELLED"

export interface Agent {
  id: string
  fullName: string | null
  email: string
  roleLabel: string | null
  activeLeads: number
}

export interface LeadCall {
  id: string
  callStatus: CallStatus
  callOutcome: CallOutcome | null
  serviceReceived: boolean | null
  notes: string | null
  createdAt: string
  user?: { id: string; fullName: string | null } | null
}

export interface LeadFollowUp {
  id: string
  scheduledAt: string
  status: FollowUpStatus
  reason: string | null
  notes: string | null
  attemptNumber: number
  createdAt: string
  completedAt: string | null
  user?: { id: string; fullName: string | null } | null
}

export interface LeadAppointment {
  id: string
  reserveDate: string
  reserveTime: string
  doctorName: string
  serviceName: string | null
  notes: string | null
  createdAt: string
  user?: { id: string; fullName: string | null } | null
}

export interface Interaction {
  id: string
  type: string
  content: string
  createdAt: string
}

export interface Lead {
  id: string
  source: LeadSource
  status: LeadStatus
  fullName: string | null
  mobile: string | null
  metadata: Record<string, unknown>
  externalRef?: string
  createdAt: string
  contactedAt?: string | null
  convertedAt?: string | null
  nextFollowUpAt?: string | null
  lastCallStatus?: CallStatus | null
  lastCallOutcome?: CallOutcome | null
  serviceReceived?: boolean | null
  assignedUserId?: string | null
  assignedUser?: { id: string; fullName: string | null; email: string } | null
  interactions: Interaction[]
  calls: LeadCall[]
  followUps: LeadFollowUp[]
  appointments: LeadAppointment[]
}

export const sourceLabels: Record<LeadSource, string> = {
  INSTAGRAM: "اینستاگرام",
  WHATSAPP: "واتساپ",
  SITE: "وب‌سایت",
  MANUAL: "دستی",
}

export const sourceIcons = {
  INSTAGRAM: Instagram,
  WHATSAPP: MessageCircle,
  SITE: Globe,
  MANUAL: Users,
}

export const sourceColors: Record<LeadSource, string> = {
  INSTAGRAM: "text-rose-500",
  WHATSAPP: "text-emerald-500",
  SITE: "text-violet-500",
  MANUAL: "text-stone-500",
}

export const statusConfig: Record<LeadStatus, { label: string; className: string }> = {
  NEW: { label: "جدید", className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  CONTACTED: { label: "در پیگیری", className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  CONVERTED: { label: "نوبت‌دار", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  LOST: { label: "از دست رفته", className: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
}

export const callStatusConfig: Record<CallStatus, { label: string; icon: typeof PhoneCall; color: string }> = {
  ANSWERED: { label: "پاسخ داد", icon: PhoneCall, color: "text-emerald-600" },
  NO_ANSWER: { label: "بدون پاسخ", icon: PhoneMissed, color: "text-amber-600" },
  BUSY: { label: "مشغول", icon: PhoneOff, color: "text-orange-600" },
  VOICEMAIL: { label: "پیام صوتی", icon: Voicemail, color: "text-violet-600" },
  WRONG_NUMBER: { label: "شماره اشتباه", icon: Ban, color: "text-rose-600" },
}

export const callOutcomeConfig: Record<CallOutcome, { label: string; icon: typeof CheckCircle2; color: string }> = {
  SERVICE_ACCEPTED: { label: "خدمت پذیرفت", icon: CheckCircle2, color: "text-emerald-600" },
  SERVICE_DECLINED: { label: "خدمت نپذیرفت", icon: XCircle, color: "text-amber-600" },
  CALLBACK_REQUESTED: { label: "تماس مجدد", icon: RotateCcw, color: "text-blue-600" },
  NO_INTEREST: { label: "تمایلی ندارد", icon: Ban, color: "text-rose-600" },
}

export function toPersianNum(num: number | string) {
  return num.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!)
}

export function isFollowUpOverdue(date: string | null | undefined) {
  if (!date) return false
  return new Date(date) < new Date()
}

export function getInitials(name: string | null | undefined) {
  if (!name) return "؟"
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return parts[0]![0]! + parts[1]![0]!
  return name.slice(0, 2)
}
