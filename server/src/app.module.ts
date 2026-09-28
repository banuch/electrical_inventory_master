import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module.js';
import { AllExceptionsFilter } from './common/http-exception.filter.js';
import { AuditService } from './audit/audit.service.js';
import { AuditController } from './audit/audit.controller.js';
import { AuthService } from './auth/auth.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { UsersService } from './users/users.service.js';
import { UsersController } from './users/users.controller.js';
import { SubstationsController } from './substations/substations.controller.js';
import { ItemsService } from './items/items.service.js';
import { ItemsController } from './items/items.controller.js';
import { InventoryService } from './inventory/inventory.service.js';
import { InventoryController } from './inventory/inventory.controller.js';
import { StockPostingService } from './stock/stock-posting.service.js';
import { StockDocumentsService } from './stock/stock-documents.service.js';
import { StockController } from './stock/stock.controller.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { AdminController } from './admin/admin.controller.js';
import { HealthController } from './health.controller.js';

// Modular monolith: feature folders stay separated; a single deployable keeps operations simple.
@Module({
  imports: [DbModule],
  controllers: [
    HealthController, AuthController, UsersController, SubstationsController, ItemsController,
    InventoryController, StockController, DashboardController, AuditController, AdminController,
  ],
  providers: [
    AuditService, AuthService, UsersService, ItemsService, InventoryService, StockPostingService, StockDocumentsService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
