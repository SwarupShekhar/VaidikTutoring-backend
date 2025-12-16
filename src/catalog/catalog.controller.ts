import { Controller, Get } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller()
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
