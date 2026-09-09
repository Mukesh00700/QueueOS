import { Global, Module } from '@nestjs/common';
import { EtaService } from './eta.service';

@Global()
@Module({
  providers: [EtaService],
  exports: [EtaService],
})
export class EtaModule {}
