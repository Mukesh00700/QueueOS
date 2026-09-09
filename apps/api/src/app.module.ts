import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from './prisma/prisma.module';
import { EventsModule } from './events/events.module';
import { EtaModule } from './eta/eta.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';

import { QueueService } from './queues/queue.service';
import { QueueController } from './queues/queue.controller';
import { TokenService } from './tokens/token.service';
import { TokenController } from './tokens/token.controller';
import { TokenAdminController } from './tokens/token-admin.controller';
import { AutoAdvanceService } from './tokens/auto-advance.service';
import { CounterService } from './counters/counter.service';
import { CounterController } from './counters/counter.controller';
import { BranchController } from './branches/branch.controller';
import { StaffService } from './staff/staff.service';
import { StaffController } from './staff/staff.controller';
import { InsightsService } from './insights/insights.service';
import { RecallScheduler } from './recall/recall.scheduler';
import { RealtimeGateway } from './realtime/realtime.gateway';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    EventsModule,
    EtaModule,
    AuthModule,
  ],
  controllers: [
    QueueController,
    TokenController,
    TokenAdminController,
    CounterController,
    BranchController,
    StaffController,
  ],
  providers: [
    QueueService,
    TokenService,
    AutoAdvanceService,
    CounterService,
    StaffService,
    InsightsService,
    RecallScheduler,
    RealtimeGateway,
    // Authenticated by default; controllers opt out with @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
