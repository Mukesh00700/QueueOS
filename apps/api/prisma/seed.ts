/**
 * Seed data.
 *
 * Four organizations across four verticals, because the whole premise is that
 * one platform serves all of them. Each branch gets a day of realistic history
 * (completed services with genuine durations, a few no-shows) followed by a
 * live queue as it would look mid-morning.
 *
 * The history matters: without completed services the ETA model has no rolling
 * statistics and falls back to the baseline, so a freshly seeded database would
 * show flat, low-confidence estimates everywhere and none of the product would
 * be visible.
 */
import { PrismaClient } from '@prisma/client';
import { PRIORITY_WEIGHT, type Priority } from '@queueos/core';
import { hashPassword } from '../src/auth/password';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'queueos123';

/** Deterministic PRNG so reseeding produces a comparable dataset. */
let seedState = 42;
function rand(): number {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}
/** Service durations are right-skewed — most are near the mean, a few run long. */
function skewedDuration(mean: number): number {
  const base = mean * (0.6 + rand() * 0.6);
  const longTail = rand() < 0.12 ? mean * (0.8 + rand()) : 0;
  return Math.round((base + longTail) * 10) / 10;
}

const FIRST_NAMES = ['Rahul', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Anjali', 'Arjun', 'Kavya', 'Rohan', 'Meera', 'Karan', 'Divya', 'Sanjay', 'Neha', 'Aditya', 'Pooja', 'Manish', 'Ritu', 'Suresh', 'Ananya'];
const LAST_NAMES = ['Sharma', 'Verma', 'Mehta', 'Iyer', 'Reddy', 'Nair', 'Kapoor', 'Joshi', 'Patel', 'Singh', 'Rao', 'Gupta'];

let phoneCounter = 9000000000;
function nextPerson() {
  phoneCounter += randInt(1, 97);
  return { name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`, phone: `+91${phoneCounter}` };
}

function tokenCode(): string {
  return randomBytes(9).toString('base64url');
}

const PRIORITY_CREDIT_MS = 6 * 60_000;
function sortKeyFor(joinedAt: Date, priority: Priority): number {
  return joinedAt.getTime() - PRIORITY_WEIGHT[priority] * PRIORITY_CREDIT_MS;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

interface QueueSpec {
  name: string;
  department?: string;
  prefix: string;
  baselineServiceMinutes: number;
  counters: { name: string; providerName?: string }[];
  /** Roughly how many people are still in line right now. */
  liveWaiting: number;
  /** How many were served earlier today. */
  history: number;
}

interface OrgSpec {
  name: string;
  slug: string;
  vertical: string;
  branchName: string;
  branchCode: string;
  queues: QueueSpec[];
  staffDomain: string;
}

const ORGS: OrgSpec[] = [
  {
    name: 'Apollo Hospital',
    slug: 'apollo',
    vertical: 'hospital',
    branchName: 'Main Branch',
    branchCode: 'MAIN',
    staffDomain: 'apollo.queueos.dev',
    queues: [
      {
        name: 'Cardiology OPD',
        department: 'Cardiology',
        prefix: 'C',
        baselineServiceMinutes: 14,
        counters: [
          { name: 'Counter C1', providerName: 'Dr. Sharma' },
          { name: 'Counter C2', providerName: 'Dr. Bose' },
        ],
        liveWaiting: 14,
        history: 22,
      },
      {
        name: 'Neurology OPD',
        department: 'Neurology',
        prefix: 'N',
        baselineServiceMinutes: 16,
        counters: [{ name: 'Counter N1', providerName: 'Dr. Verma' }],
        liveWaiting: 9,
        history: 14,
      },
      {
        name: 'Orthopedics OPD',
        department: 'Orthopedics',
        prefix: 'O',
        baselineServiceMinutes: 11,
        counters: [
          { name: 'Counter O1', providerName: 'Dr. Mehta' },
          { name: 'Counter O2', providerName: 'Dr. Nair' },
        ],
        liveWaiting: 21,
        history: 28,
      },
      {
        name: 'General OPD',
        department: 'General Medicine',
        prefix: 'A',
        baselineServiceMinutes: 8,
        counters: [
          { name: 'Counter A1', providerName: 'Dr. Rao' },
          { name: 'Counter A2', providerName: 'Dr. Gupta' },
          { name: 'Counter A3', providerName: 'Dr. Joshi' },
        ],
        liveWaiting: 18,
        history: 41,
      },
      {
        name: 'Pediatrics OPD',
        department: 'Pediatrics',
        prefix: 'P',
        baselineServiceMinutes: 9,
        counters: [{ name: 'Counter P1', providerName: 'Dr. Iyer' }],
        liveWaiting: 7,
        history: 19,
      },
      {
        name: 'Dermatology OPD',
        department: 'Dermatology',
        prefix: 'D',
        baselineServiceMinutes: 22,
        counters: [{ name: 'Counter D1', providerName: 'Dr. Kapoor' }],
        liveWaiting: 11,
        history: 9,
      },
    ],
  },
  {
    name: 'Shri Balaji Temple Trust',
    slug: 'balaji',
    vertical: 'temple',
    branchName: 'Main Temple',
    branchCode: 'TEMPLE',
    staffDomain: 'balaji.queueos.dev',
    queues: [
      {
        name: 'General Darshan',
        prefix: 'D',
        baselineServiceMinutes: 2,
        counters: [
          { name: 'Gate 1' },
          { name: 'Gate 2' },
          { name: 'Gate 3' },
        ],
        liveWaiting: 46,
        history: 120,
      },
      {
        name: 'VIP Darshan',
        prefix: 'V',
        baselineServiceMinutes: 4,
        counters: [{ name: 'VIP Gate' }],
        liveWaiting: 8,
        history: 26,
      },
    ],
  },
  {
    name: 'Burger Junction',
    slug: 'burger-junction',
    vertical: 'restaurant',
    branchName: 'Connaught Place',
    branchCode: 'CP',
    staffDomain: 'burgerjunction.queueos.dev',
    queues: [
      {
        name: 'Order Pickup',
        prefix: 'O',
        baselineServiceMinutes: 5,
        counters: [{ name: 'Pickup 1' }, { name: 'Pickup 2' }],
        liveWaiting: 12,
        history: 64,
      },
    ],
  },
  {
    name: 'Glow Studio',
    slug: 'glow-studio',
    vertical: 'salon',
    branchName: 'Indiranagar',
    branchCode: 'IND',
    staffDomain: 'glowstudio.queueos.dev',
    queues: [
      {
        name: 'Hair & Styling',
        prefix: 'S',
        baselineServiceMinutes: 32,
        counters: [
          { name: 'Chair 1', providerName: 'Ritu' },
          { name: 'Chair 2', providerName: 'Karan' },
        ],
        liveWaiting: 5,
        history: 8,
      },
    ],
  },
];

async function main() {
  console.log('Resetting existing data...');
  // Order matters: children before parents, since the FKs are enforced.
  await prisma.queueEvent.deleteMany();
  await prisma.feedback.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.token.deleteMany();
  await prisma.visit.deleteMany();
  await prisma.serviceType.deleteMany();
  await prisma.counter.deleteMany();
  await prisma.queue.deleteMany();
  await prisma.staffUser.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.organization.deleteMany();

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const logins: string[] = [];

  for (const spec of ORGS) {
    console.log(`Seeding ${spec.name}...`);

    const org = await prisma.organization.create({
      data: { name: spec.name, slug: spec.slug, vertical: spec.vertical },
    });

    const branch = await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: spec.branchName,
        code: spec.branchCode,
        vertical: spec.vertical,
      },
    });

    for (const [role, label] of [
      ['OWNER', 'owner'],
      ['ADMIN', 'admin'],
      ['RECEPTION', 'reception'],
      ['COUNTER_STAFF', 'counter'],
    ] as const) {
      const email = `${label}@${spec.staffDomain}`;
      await prisma.staffUser.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          name: `${label[0].toUpperCase()}${label.slice(1)} User`,
          email,
          passwordHash,
          role,
        },
      });
      if (label === 'owner') logins.push(email);
    }

    for (const [order, qSpec] of spec.queues.entries()) {
      const queue = await prisma.queue.create({
        data: {
          branchId: branch.id,
          name: qSpec.name,
          department: qSpec.department ?? null,
          tokenPrefix: qSpec.prefix,
          baselineServiceMinutes: qSpec.baselineServiceMinutes,
          displayOrder: order,
          nextNumber: 1,
        },
      });

      const counters = [];
      for (const c of qSpec.counters) {
        counters.push(
          await prisma.counter.create({
            data: {
              branchId: branch.id,
              queueId: queue.id,
              name: c.name,
              providerName: c.providerName ?? null,
              status: 'IDLE',
            },
          }),
        );
      }

      await seedQueueActivity(org.id, branch.id, queue.id, qSpec, counters, spec.vertical);
    }
  }

  console.log('\nSeed complete.');
  console.log(`\nStaff logins (password: ${DEMO_PASSWORD}):`);
  for (const email of logins) console.log(`  ${email}`);
  console.log('  ...also admin@, reception@ and counter@ on each domain.');
  console.log('  ("owner@" = OWNER role, "admin@" = branch ADMIN role.)\n');
}

async function seedQueueActivity(
  organizationId: string,
  branchId: string,
  queueId: string,
  spec: QueueSpec,
  counters: { id: string; name: string }[],
  vertical: string,
) {
  const now = new Date();
  let number = 1;

  // --- History: services already completed today -------------------------
  //
  // Built backwards from "now" rather than forwards from opening time, so a
  // seed run at 3am produces the same shaped dataset as one at 3pm. Everything
  // is clamped inside today so the "today" counters and the rolling ETA window
  // both see it.
  const historyEnd = new Date(now.getTime() - 60_000);
  const historyStart = new Date(
    Math.max(startOfDay(now).getTime(), now.getTime() - 6 * 3_600_000),
  );
  const historySpanMs = Math.max(30 * 60_000, historyEnd.getTime() - historyStart.getTime());

  for (let i = 0; i < spec.history; i++) {
    const person = nextPerson();
    const customer = await upsertCustomer(organizationId, person);

    const completedAt = new Date(
      historyStart.getTime() + (historySpanMs * (i + 1)) / (spec.history + 1),
    );
    const serviceMinutes = skewedDuration(spec.baselineServiceMinutes);
    const calledAt = new Date(completedAt.getTime() - serviceMinutes * 60_000);
    const waitMinutes = randInt(3, Math.max(6, spec.baselineServiceMinutes * 2));
    const joinedAt = new Date(
      Math.max(startOfDay(now).getTime(), calledAt.getTime() - waitMinutes * 60_000),
    );

    // About one in fourteen never shows up — enough to make the no-show KPI
    // and the recall insight meaningful without dominating the dataset.
    const noShow = rand() < 0.07;
    const source = pick(['QR', 'KIOSK', 'RECEPTION', 'WEB', 'WHATSAPP'] as const);
    const visit = await createVisit(organizationId, branchId, customer.id, source, vertical);

    await prisma.token.create({
      data: {
        branchId,
        queueId,
        visitId: visit.id,
        customerId: customer.id,
        counterId: noShow ? null : pick(counters).id,
        code: tokenCode(),
        displayNumber: number++,
        status: noShow ? 'NO_SHOW' : 'COMPLETED',
        priority: 'NORMAL',
        source,
        sortKey: sortKeyFor(joinedAt, 'NORMAL'),
        joinedAt,
        calledAt: noShow ? null : calledAt,
        servedAt: noShow ? null : calledAt,
        completedAt: noShow ? calledAt : completedAt,
        serviceMinutes: noShow ? null : serviceMinutes,
        waitMinutes: noShow ? null : waitMinutes,
      },
    });
  }

  // --- One token in service at each counter ------------------------------
  for (const counter of counters) {
    // Leave the last counter idle so the dashboard shows a mix of states.
    if (counter === counters[counters.length - 1] && counters.length > 1) continue;

    const person = nextPerson();
    const customer = await upsertCustomer(organizationId, person);
    const servedAt = new Date(now.getTime() - randInt(1, spec.baselineServiceMinutes) * 60_000);
    const joinedAt = new Date(servedAt.getTime() - randInt(5, 25) * 60_000);
    const visit = await createVisit(organizationId, branchId, customer.id, 'QR', vertical);

    await prisma.token.create({
      data: {
        branchId,
        queueId,
        visitId: visit.id,
        customerId: customer.id,
        counterId: counter.id,
        code: tokenCode(),
        displayNumber: number++,
        status: 'SERVING',
        priority: 'NORMAL',
        source: 'QR',
        sortKey: sortKeyFor(joinedAt, 'NORMAL'),
        joinedAt,
        calledAt: servedAt,
        servedAt,
        waitMinutes: (servedAt.getTime() - joinedAt.getTime()) / 60_000,
      },
    });

    await prisma.counter.update({ where: { id: counter.id }, data: { status: 'SERVING' } });
  }

  // --- The live line -----------------------------------------------------
  for (let i = 0; i < spec.liveWaiting; i++) {
    const person = nextPerson();
    const customer = await upsertCustomer(organizationId, person);

    // Most people are NORMAL; a scattering of priority cases keeps the
    // ordering logic visible on screen.
    const roll = rand();
    const priority: Priority =
      roll > 0.96 ? 'EMERGENCY' : roll > 0.9 ? 'VIP' : roll > 0.8 ? 'PRIORITY' : 'NORMAL';

    const joinedAt = new Date(now.getTime() - (spec.liveWaiting - i) * randInt(1, 4) * 60_000);
    const source = pick(['QR', 'KIOSK', 'RECEPTION', 'WEB', 'MOBILE_APP'] as const);
    const visit = await createVisit(organizationId, branchId, customer.id, source, vertical);

    await prisma.token.create({
      data: {
        branchId,
        queueId,
        visitId: visit.id,
        customerId: customer.id,
        code: tokenCode(),
        displayNumber: number++,
        status: 'WAITING',
        priority,
        source,
        sortKey: sortKeyFor(joinedAt, priority),
        joinedAt,
      },
    });
  }

  await prisma.queue.update({ where: { id: queueId }, data: { nextNumber: number } });
}

const customerCache = new Map<string, { id: string }>();

async function upsertCustomer(organizationId: string, person: { name: string; phone: string }) {
  const key = `${organizationId}:${person.phone}`;
  const cached = customerCache.get(key);
  if (cached) return cached;

  const customer = await prisma.customer.upsert({
    where: { organizationId_phone: { organizationId, phone: person.phone } },
    create: {
      organizationId,
      name: person.name,
      phone: person.phone,
      isSeniorCitizen: rand() < 0.15,
      needsAssistance: rand() < 0.06,
    },
    update: {},
    select: { id: true },
  });

  customerCache.set(key, customer);
  return customer;
}

function createVisit(
  organizationId: string,
  branchId: string,
  customerId: string,
  source: string,
  vertical: string,
) {
  return prisma.visit.create({
    data: { organizationId, branchId, customerId, source, vertical },
    select: { id: true },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
