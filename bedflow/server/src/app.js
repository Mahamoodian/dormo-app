import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config.js';
import { tx, query } from './db/pool.js';
import { authenticate, requirePasswordChanged, requireRole, ownerScope } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';
import { ah } from './utils/http.js';
import { syncOwner } from './services/rentEngine.js';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import propertyRoutes from './routes/properties.js';
import clientRoutes from './routes/clients.js';
import assignmentRoutes from './routes/assignments.js';
import receivableRoutes, { payments as paymentRoutes } from './routes/receivables.js';
import expenseRoutes from './routes/expenses.js';
import dashboardRoutes from './routes/dashboard.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: false }));
  app.use(express.json({ limit: '200kb' }));
  if (!config.isProd && process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

  app.get('/api/health', ah(async (_req, res) => {
    await query('SELECT 1');
    res.json({ ok: true });
  }));

  app.use('/api/auth', authRoutes);

  // Super admin
  app.use('/api/admin', authenticate, requirePasswordChanged, requireRole('super_admin'), adminRoutes);

  // Business owner (tenant-scoped). Rent periods that have started are billed lazily
  // before each request, so "Overdue" is always accurate even without a scheduler.
  const owner = express.Router();
  owner.use(authenticate, requirePasswordChanged, ownerScope);
  owner.use(ah(async (req, _res, next) => {
    await tx((db) => syncOwner(db, req.ownerId));
    next();
  }));
  owner.use('/dashboard', dashboardRoutes);
  owner.use('/properties', propertyRoutes);
  owner.use('/clients', clientRoutes);
  owner.use('/assignments', assignmentRoutes);
  owner.use('/receivables', receivableRoutes);
  owner.use('/payments', paymentRoutes);
  owner.use('/expenses', expenseRoutes);
  app.use('/api', owner);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));
  app.use(errorHandler);
  return app;
}
