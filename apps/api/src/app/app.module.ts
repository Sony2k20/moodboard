import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database.module';
import { ValkeyModule } from './valkey.module';

@Module({
  imports: [DatabaseModule, ValkeyModule, AuthModule],
  controllers: [AppController],
})
export class AppModule {}
