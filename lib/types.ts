export type UserRole =
  | "agency_owner"
  | "agency_admin"
  | "agency_manager"
  | "department_head"
  | "department_member"
  | "client";

export type TicketCategory = "seo" | "ghl" | "software" | "billing" | "general";
export type TicketStatus = "open" | "in_progress" | "escalated" | "resolved";
export type TicketSource = "web" | "phone" | "chat" | "internal";
export type Priority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "todo" | "in_progress" | "done";
export type OnboardingStatus = "not_started" | "in_progress" | "completed";
export type ClientStatus = "active" | "inactive";
export type ThreadStatus = "active" | "closed";
export type SenderType = "client" | "team";
export type MessageType = "text" | "ticket_card" | "recording" | "meet_link";

export const TEAM_ROLES: UserRole[] = [
  "agency_owner",
  "agency_admin",
  "agency_manager",
  "department_head",
  "department_member",
];

export const ROLE_LABELS: Record<UserRole, string> = {
  agency_owner: "Owner",
  agency_admin: "Admin",
  agency_manager: "Manager",
  department_head: "Dept Head",
  department_member: "Team",
  client: "Client",
};

export function isTeamRole(role: UserRole | null | undefined): boolean {
  return !!role && role !== "client";
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  role: UserRole;
  department_id: string | null;
  phone: string | null;
  ghl_contact_id: string | null;
  created_at: string;
}

export type ClientUserRole =
  | "account_owner"
  | "account_admin"
  | "office_member"
  | "contractor";

export const CLIENT_ROLE_LABELS: Record<ClientUserRole, string> = {
  account_owner: "Account Owner",
  account_admin: "Account Admin",
  office_member: "Office Member",
  contractor: "Contractor",
};

/** Full client data access + self-service team management. */
export function isClientAdminRole(
  role: ClientUserRole | null | undefined
): boolean {
  return role === "account_owner" || role === "account_admin";
}

/** Agency roles allowed to manage checklist templates. */
export function isAgencyManagerRole(
  role: UserRole | null | undefined
): boolean {
  return (
    role === "agency_owner" ||
    role === "agency_admin" ||
    role === "agency_manager"
  );
}

export interface ClientUser {
  id: string;
  client_id: string;
  user_id: string;
  role: ClientUserRole;
  created_at: string;
  // joined
  user?: Pick<UserProfile, "id" | "email" | "full_name" | "avatar_url" | "ghl_contact_id"> | null;
}

export interface ChecklistTemplate {
  id: string;
  item_name: string;
  description: string | null;
  required: boolean;
  created_by: string | null;
  created_at: string;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  head_user_id: string | null;
  created_at: string;
}

export interface Client {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  logo_url: string | null;
  brand_colors: Record<string, string> | null;
  brand_fonts: Record<string, string> | null;
  google_drive_folder_url: string | null;
  onboarding_status: OnboardingStatus;
  status: ClientStatus;
  created_at: string;
}

export interface ChecklistItem {
  id: string;
  client_id: string;
  item_name: string;
  description: string | null;
  required: boolean;
  completed: boolean;
  completed_at: string | null;
  file_url: string | null;
  created_at: string;
}

export interface Ticket {
  id: string;
  title: string;
  description: string | null;
  category: TicketCategory;
  status: TicketStatus;
  priority: Priority;
  created_by: string | null;
  assigned_to: string | null;
  department_id: string | null;
  client_id: string | null;
  source: TicketSource;
  voice_recording_url: string | null;
  transcription: string | null;
  ai_summary: string | null;
  sla_deadline: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
  // joined
  client?: Pick<Client, "id" | "company_name" | "logo_url"> | null;
  assignee?: Pick<UserProfile, "id" | "full_name" | "avatar_url"> | null;
  department?: Pick<Department, "id" | "name"> | null;
}

export interface TicketActivity {
  id: string;
  ticket_id: string;
  user_id: string | null;
  action: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  user?: Pick<UserProfile, "id" | "full_name" | "avatar_url"> | null;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  department_id: string | null;
  client_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  linked_ticket_id: string | null;
  created_at: string;
  updated_at: string;
  // joined
  client?: Pick<Client, "id" | "company_name"> | null;
  assignee?: Pick<UserProfile, "id" | "full_name" | "avatar_url"> | null;
  linked_ticket?: Pick<Ticket, "id" | "title"> | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  user_id: string | null;
  content: string;
  created_at: string;
  user?: Pick<UserProfile, "id" | "full_name" | "avatar_url"> | null;
}

export interface ChatThread {
  id: string;
  client_id: string;
  status: ThreadStatus;
  category: string | null;
  last_message_at: string | null;
  created_at: string;
  client?: Pick<Client, "id" | "company_name" | "logo_url"> | null;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_id: string | null;
  sender_type: SenderType;
  content: string | null;
  message_type: MessageType;
  metadata: Record<string, unknown> | null;
  sent_at: string;
  read_at: string | null;
  sender?: Pick<UserProfile, "id" | "full_name" | "avatar_url"> | null;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  link: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
  user?: Pick<UserProfile, "id" | "full_name" | "avatar_url"> | null;
}

export interface CannedResponse {
  id: string;
  department_id: string | null;
  title: string;
  body: string;
  created_by: string | null;
  created_at: string;
}

export interface ClientDocument {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  url: string;
  created_by: string | null;
  created_at: string;
}

export interface AppSetting {
  id: string;
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
}
