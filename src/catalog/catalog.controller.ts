import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { CatalogService } from './catalog.service';

@Controller()
@UseInterceptors(CacheInterceptor)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @CacheKey('catalog_subjects')
  @CacheTTL(600) // 10 minutes
  @Get('subjects')
  async getSubjects() {
    return this.catalogService.getSubjects();
  }

  @CacheKey('catalog_curricula')
  @CacheTTL(600)
  @Get('curricula')
  async getCurricula() {
    return this.catalogService.getCurricula();
  }

  @CacheKey('catalog_packages')
  @CacheTTL(600)
  @Get('packages')
  async getPackages() {
    return this.catalogService.getPackages();
  }
}
