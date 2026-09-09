/**
 * Vertical profiles.
 *
 * QueueOS ships one product, not one product per industry. Everything that
 * differs between a hospital, a temple and a QSR is expressed as data here:
 * the words on screen, the stages of the customer journey, the accent palette,
 * and which optional fields the board shows.
 *
 * Rules for adding a vertical:
 *  - never branch on `vertical.id` in a component; add a field to the profile
 *  - terminology is always sentence-case singular/plural pairs
 *  - accents must clear WCAG AA against both surface colors
 */

export const VERTICAL_IDS = [
  'hospital',
  'restaurant',
  'salon',
  'temple',
  'government',
  'retail',
] as const;
export type VerticalId = (typeof VERTICAL_IDS)[number];

export interface Terminology {
  /** The person waiting. */
  customer: string;
  customerPlural: string;
  /** The person or resource delivering the service. */
  provider: string;
  providerPlural: string;
  /** The physical place service happens. */
  counter: string;
  counterPlural: string;
  /** A line of waiting people. */
  queue: string;
  queuePlural: string;
  /** The thing that holds your place. */
  token: string;
  /** Headline on the public display, e.g. "Now Serving". */
  nowServing: string;
  /** Primary CTA for joining. */
  joinCta: string;
  /** What a completed visit is called. */
  visit: string;
}

export interface JourneyStage {
  id: string;
  label: string;
  /** Lucide icon name, resolved on the client. */
  icon: string;
}

export interface VerticalTheme {
  /** Accent hex for the light theme. */
  accent: string;
  /** Accent hex for the dark theme. */
  accentDark: string;
  /** Ambient glow behind hero numbers, rgba or hex. */
  glow: string;
  /** Surface tint applied to hero cards, as an rgb triplet string. */
  tint: string;
}

export interface VerticalProfile {
  id: VerticalId;
  label: string;
  tagline: string;
  terminology: Terminology;
  /**
   * Ordered stages shown in the customer timeline.
   *
   * The order must match the token lifecycle, because the timeline paints every
   * earlier stage as already done: a counter is only attached when the token is
   * CALLED, so `almost` — which the customer reaches while still WAITING — has
   * to come before `assigned`. Reversing them tells a patient a doctor was
   * assigned while they are still sitting in the waiting room.
   */
  journey: JourneyStage[];
  theme: VerticalTheme;
  /** Default token prefix; branches may override. */
  tokenPrefix: string;
  /** Optional columns the live board renders for this vertical. */
  board: {
    showProvider: boolean;
    showCounter: boolean;
    /** Render the display as discrete pipeline stages (QSR) vs a single now-serving number. */
    pipeline: boolean;
  };
  /** Priority bands offered at check-in for this vertical. */
  priorities: readonly string[];
}

export const VERTICALS: Record<VerticalId, VerticalProfile> = {
  hospital: {
    id: 'hospital',
    label: 'Hospital Mode',
    tagline: 'Outpatient flow, triage and diagnostics',
    terminology: {
      customer: 'Patient',
      customerPlural: 'Patients',
      provider: 'Doctor',
      providerPlural: 'Doctors',
      counter: 'Counter',
      counterPlural: 'Counters',
      queue: 'Queue',
      queuePlural: 'Queues',
      token: 'Token',
      nowServing: 'Now Serving',
      joinCta: 'Join Queue',
      visit: 'Consultation',
    },
    journey: [
      { id: 'checked_in', label: 'Checked In', icon: 'ClipboardCheck' },
      { id: 'queued', label: 'Queue Joined', icon: 'Users' },
      { id: 'almost', label: 'Almost Your Turn', icon: 'BellRing' },
      { id: 'assigned', label: 'Doctor Assigned', icon: 'Stethoscope' },
      { id: 'serving', label: 'Consultation', icon: 'HeartPulse' },
      { id: 'completed', label: 'Completed', icon: 'CheckCircle2' },
    ],
    theme: {
      accent: '#2563EB',
      accentDark: '#3B82F6',
      glow: 'rgba(37, 99, 235, 0.35)',
      tint: '37 99 235',
    },
    tokenPrefix: 'A',
    board: { showProvider: true, showCounter: true, pipeline: false },
    priorities: ['NORMAL', 'PRIORITY', 'VIP', 'EMERGENCY'],
  },

  restaurant: {
    id: 'restaurant',
    label: 'Restaurant Mode',
    tagline: 'Order pipeline for QSR and food courts',
    terminology: {
      customer: 'Guest',
      customerPlural: 'Guests',
      provider: 'Station',
      providerPlural: 'Stations',
      counter: 'Pickup',
      counterPlural: 'Pickup Points',
      queue: 'Order Line',
      queuePlural: 'Order Lines',
      token: 'Order',
      nowServing: 'Ready for Pickup',
      joinCta: 'Place in Line',
      visit: 'Order',
    },
    journey: [
      { id: 'checked_in', label: 'Order Placed', icon: 'Receipt' },
      { id: 'queued', label: 'In Kitchen Queue', icon: 'ListOrdered' },
      { id: 'almost', label: 'Up Next', icon: 'Flame' },
      { id: 'assigned', label: 'Preparing', icon: 'ChefHat' },
      { id: 'serving', label: 'Ready', icon: 'ShoppingBag' },
      { id: 'completed', label: 'Collected', icon: 'CheckCircle2' },
    ],
    theme: {
      accent: '#EA580C',
      accentDark: '#FB923C',
      glow: 'rgba(234, 88, 12, 0.35)',
      tint: '234 88 12',
    },
    tokenPrefix: 'O',
    board: { showProvider: false, showCounter: true, pipeline: true },
    priorities: ['NORMAL', 'PRIORITY'],
  },

  salon: {
    id: 'salon',
    label: 'Salon Mode',
    tagline: 'Stylist availability and service slots',
    terminology: {
      customer: 'Client',
      customerPlural: 'Clients',
      provider: 'Stylist',
      providerPlural: 'Stylists',
      counter: 'Chair',
      counterPlural: 'Chairs',
      queue: 'Service Line',
      queuePlural: 'Service Lines',
      token: 'Booking',
      nowServing: 'In the Chair',
      joinCta: 'Book Next Slot',
      visit: 'Appointment',
    },
    journey: [
      { id: 'checked_in', label: 'Checked In', icon: 'ClipboardCheck' },
      { id: 'queued', label: 'Waiting', icon: 'Users' },
      { id: 'almost', label: 'Almost Your Turn', icon: 'BellRing' },
      { id: 'assigned', label: 'Stylist Assigned', icon: 'Scissors' },
      { id: 'serving', label: 'In Service', icon: 'Sparkles' },
      { id: 'completed', label: 'Completed', icon: 'CheckCircle2' },
    ],
    theme: {
      accent: '#DB2777',
      accentDark: '#F472B6',
      glow: 'rgba(219, 39, 119, 0.35)',
      tint: '219 39 119',
    },
    tokenPrefix: 'S',
    board: { showProvider: true, showCounter: true, pipeline: false },
    priorities: ['NORMAL', 'VIP'],
  },

  temple: {
    id: 'temple',
    label: 'Temple Mode',
    tagline: 'Darshan flow and crowd management',
    terminology: {
      customer: 'Devotee',
      customerPlural: 'Devotees',
      provider: 'Sevak',
      providerPlural: 'Sevaks',
      counter: 'Gate',
      counterPlural: 'Gates',
      queue: 'Darshan Line',
      queuePlural: 'Darshan Lines',
      token: 'Darshan Pass',
      nowServing: 'Now Entering',
      joinCta: 'Join Darshan',
      visit: 'Darshan',
    },
    journey: [
      { id: 'checked_in', label: 'Registered', icon: 'ClipboardCheck' },
      { id: 'queued', label: 'In Darshan Line', icon: 'Users' },
      { id: 'almost', label: 'Approach Gate', icon: 'BellRing' },
      { id: 'assigned', label: 'Gate Assigned', icon: 'DoorOpen' },
      { id: 'serving', label: 'Darshan', icon: 'Flower2' },
      { id: 'completed', label: 'Completed', icon: 'CheckCircle2' },
    ],
    theme: {
      accent: '#B45309',
      accentDark: '#F59E0B',
      glow: 'rgba(245, 158, 11, 0.35)',
      tint: '180 83 9',
    },
    tokenPrefix: 'D',
    board: { showProvider: false, showCounter: true, pipeline: false },
    priorities: ['NORMAL', 'PRIORITY', 'VIP'],
  },

  government: {
    id: 'government',
    label: 'Government Mode',
    tagline: 'Passport, RTO, Aadhaar and municipal desks',
    terminology: {
      customer: 'Applicant',
      customerPlural: 'Applicants',
      provider: 'Officer',
      providerPlural: 'Officers',
      counter: 'Window',
      counterPlural: 'Windows',
      queue: 'Service Queue',
      queuePlural: 'Service Queues',
      token: 'Token',
      nowServing: 'Now Serving',
      joinCta: 'Get Token',
      visit: 'Appointment',
    },
    journey: [
      { id: 'checked_in', label: 'Documents Verified', icon: 'ClipboardCheck' },
      { id: 'queued', label: 'Token Issued', icon: 'Users' },
      { id: 'almost', label: 'Almost Your Turn', icon: 'BellRing' },
      { id: 'assigned', label: 'Window Assigned', icon: 'Building2' },
      { id: 'serving', label: 'At Window', icon: 'FileCheck' },
      { id: 'completed', label: 'Completed', icon: 'CheckCircle2' },
    ],
    theme: {
      accent: '#0F766E',
      accentDark: '#2DD4BF',
      glow: 'rgba(15, 118, 110, 0.35)',
      tint: '15 118 110',
    },
    tokenPrefix: 'G',
    board: { showProvider: true, showCounter: true, pipeline: false },
    priorities: ['NORMAL', 'PRIORITY', 'EMERGENCY'],
  },

  retail: {
    id: 'retail',
    label: 'Retail Mode',
    tagline: 'Billing, trial rooms and service desks',
    terminology: {
      customer: 'Shopper',
      customerPlural: 'Shoppers',
      provider: 'Associate',
      providerPlural: 'Associates',
      counter: 'Desk',
      counterPlural: 'Desks',
      queue: 'Queue',
      queuePlural: 'Queues',
      token: 'Token',
      nowServing: 'Now Serving',
      joinCta: 'Join Queue',
      visit: 'Visit',
    },
    journey: [
      { id: 'checked_in', label: 'Checked In', icon: 'ClipboardCheck' },
      { id: 'queued', label: 'Queue Joined', icon: 'Users' },
      { id: 'almost', label: 'Almost Your Turn', icon: 'BellRing' },
      { id: 'assigned', label: 'Desk Assigned', icon: 'Store' },
      { id: 'serving', label: 'Being Served', icon: 'ShoppingCart' },
      { id: 'completed', label: 'Completed', icon: 'CheckCircle2' },
    ],
    theme: {
      accent: '#7C3AED',
      accentDark: '#A78BFA',
      glow: 'rgba(124, 58, 237, 0.35)',
      tint: '124 58 237',
    },
    tokenPrefix: 'R',
    board: { showProvider: false, showCounter: true, pipeline: false },
    priorities: ['NORMAL', 'PRIORITY'],
  },
};

export function isVerticalId(value: string): value is VerticalId {
  return (VERTICAL_IDS as readonly string[]).includes(value);
}

export function getVertical(id: string): VerticalProfile {
  return isVerticalId(id) ? VERTICALS[id] : VERTICALS.hospital;
}
