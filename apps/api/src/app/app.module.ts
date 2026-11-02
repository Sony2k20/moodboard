import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AssetsModule } from './assets/assets.module';
import { AuthModule } from './auth/auth.module';
import { BoardsModule } from './boards/boards.module';
import { DatabaseModule } from './database.module';
import { McpModule } from './mcp/mcp.module';
import { StorageModule } from './storage.module';
import { ValkeyModule } from './valkey.module';

@Module({
  imports: [
    DatabaseModule,
    ValkeyModule,
    StorageModule,
    AuthModule,
    AssetsModule,
    BoardsModule,
    McpModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
