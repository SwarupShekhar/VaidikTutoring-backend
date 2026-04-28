import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { CatalogService } from './catalog.service';

@Controller()
@UseInterceptors(CacheInterceptor)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('subjects')
  async getSubjects() {
    return this.catalogService.getSubjects();
  }

  @Get('curricula')
  async getCurricula() {
    return this.catalogService.getCurricula();
  }

  @Get('packages')
  async getPackages() {
    return this.catalogService.getPackages();
  }
}
