import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { McpController } from './mcp.controller';
import { McpServerFactory } from './mcp.server';

@Module({
  imports: [AssetsModule],
  controllers: [McpController],
  providers: [McpServerFactory],
})
export class McpModule {}
