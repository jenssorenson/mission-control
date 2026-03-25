export interface ActivityEvent {
  id: string;
  timestamp: number;
  agentName: string;
  event: 'started' | 'completed' | 'error' | 'thinking' | 'system';
  detail?: string;
}

export interface Agent {
  id: string;
  name: string;
  runtime: 'dev' | 'pi' | 'gemini';
  status: 'active' | 'idle' | 'thinking';
  startedAt?: number;
  lastActivity?: number;
}

export interface SubAgent {
  sessionKey: string;
  taskName: string;
  runtime: string;
  status: string;
  tokenUsage?: number;
  rate?: number; // computed: tokens per minute
  startedAt?: number;
  age?: number; // session age in seconds
}

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: number;
}

export interface GatewayStatus {
  agents: Agent[];
  subAgents: SubAgent[];
  memoryUsage?: number;
  uptime?: number;
  activeSessions?: number;
  cpuUsage?: number;
}

export type SystemEventType = 'spawn' | 'kill' | 'gateway_connect' | 'gateway_disconnect';

export interface SystemEvent {
  id: string;
  timestamp: number;
  type: SystemEventType;
  agentName?: string;
  detail: string;
  runtime?: string;
}

export type NotificationPriority = 'info' | 'warning' | 'error' | 'success';
export type NotificationKind = 'error' | 'milestone' | 'gateway' | 'reminder' | 'spawn' | 'kill';

export interface Notification {
  id: string;
  timestamp: number;
  kind: NotificationKind;
  priority: NotificationPriority;
  title: string;
  detail?: string;
  read: boolean;
  sessionKey?: string;
  agentName?: string;
  runtime?: string;
  // For reminders
  reminderAt?: number;
  recurring?: boolean;
}

// ─── Pipeline / Convoy System ─────────────────────────────────────────────────

export type PipelineStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting';

export interface PipelineStage {
  id: string;
  name: string;
  prompt: string;
  runtime: 'dev' | 'pi' | 'gemini';
  timeoutMin?: number;       // Estimated timeout in minutes
  autoProgress?: boolean;    // Auto-trigger next stage when this completes
  status: StageStatus;
  sessionKey?: string;       // Linked sub-agent session
  output?: string;          // Captured output from this stage
  startedAt?: number;
  completedAt?: number;
  tokenUsage?: number;
  error?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  stages: PipelineStage[];
  status: PipelineStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  totalCostEstimate?: number;
  currentStageIndex: number;  // Index of the currently active (or next) stage
  tags?: string[];
}

export interface ConvoyTemplate {
  id: string;
  name: string;
  description: string;
  stages: Omit<PipelineStage, 'status' | 'sessionKey' | 'output' | 'startedAt' | 'completedAt' | 'tokenUsage' | 'error'>[];
  tags?: string[];
}
