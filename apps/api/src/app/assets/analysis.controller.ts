import { BadRequestException, Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  AnalysisRequestResult,
  AnalysisRequestSchema,
  AnalysisSummary,
} from '@moodboard/shared';
import { z } from 'zod';
import { User } from '../auth/auth.guard';
import type { CurrentUser } from '../auth/users.service';
import { AnalysisService } from './analysis.service';

/** Batch re-analysis (0015): the corpus summary for admins, requests for everyone. */
@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Get()
  summary(@User() user: CurrentUser): Promise<AnalysisSummary> {
    return this.analysis.summary(user);
  }

  @Post('requests')
  @HttpCode(202)
  request(@Body() body: unknown, @User() user: CurrentUser): Promise<AnalysisRequestResult> {
    const parsed = AnalysisRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(z.prettifyError(parsed.error));
    }
    return this.analysis.request(parsed.data, user);
  }
}
