/** Shared vocabulary, kept in one place so badges and filters cannot drift. */

export const ROLES = Object.freeze({
  CITIZEN: 'citizen',
  CONTRACTOR: 'contractor',
  ADMIN: 'admin',
});

export const REPORT_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PUBLISHED: 'published',
});

export const PROJECT_STATUS = Object.freeze({
  OPEN: 'open',
  AWARDED: 'awarded',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
});

export const MILESTONE_STATUS = Object.freeze({
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  AI_REJECTED: 'ai_rejected',
  REJECTED: 'rejected',
  APPROVING: 'approving',
  PAID: 'paid',
});

/**
 * Status -> visual tone. One mapping drives every badge in the app, so
 * "approved" is the same green on a report, a bid and a milestone.
 */
export const STATUS_TONE = Object.freeze({
  // reports
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
  published: 'blue',
  // projects
  open: 'blue',
  awarded: 'violet',
  in_progress: 'amber',
  completed: 'green',
  // milestones
  submitted: 'amber',
  ai_rejected: 'red',
  approving: 'amber',
  paid: 'green',
  // bids
  accepted: 'green',
  withdrawn: 'slate',
  // anomaly bands
  none: 'green',
  elevated: 'amber',
  flagged: 'red',
  severe: 'red',
});

/** Human labels. `in_progress` should never reach a user as-is. */
export const STATUS_LABEL = Object.freeze({
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  published: 'Published',
  open: 'Open for bids',
  awarded: 'Awarded',
  in_progress: 'In progress',
  completed: 'Completed',
  submitted: 'Awaiting review',
  ai_rejected: 'AI could not verify',
  approving: 'Payment in progress',
  paid: 'Paid',
  accepted: 'Accepted',
  withdrawn: 'Withdrawn',
  none: 'Within assessment',
  elevated: 'Above estimate',
  flagged: 'Flagged',
  severe: 'Severely flagged',
});

export const CATEGORY_LABEL = Object.freeze({
  road_damage: 'Road damage',
  water_drainage: 'Water & drainage',
  street_lighting: 'Street lighting',
  waste_management: 'Waste management',
  public_building: 'Public building',
  footpath_or_bridge: 'Footpath or bridge',
  electrical_or_utility: 'Electrical / utility',
  traffic_infrastructure: 'Traffic infrastructure',
  other_infrastructure: 'Other infrastructure',
  not_infrastructure: 'Not infrastructure',
});

export const SEVERITY_TONE = Object.freeze({
  low: 'green',
  medium: 'amber',
  high: 'red',
  critical: 'red',
});

export const SEPOLIA_CHAIN_ID = import.meta.env.VITE_CHAIN_ID || '0xaa36a7';
export const ETHERSCAN_BASE =
  import.meta.env.VITE_ETHERSCAN_BASE_URL || 'https://sepolia.etherscan.io';
export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || '';
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
