import { prisma } from './lib/prisma';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './modules/auth/auth.route';
import departmentRoutes from './modules/departments/department.route';
import designationRoutes from './modules/designations/designation.route';
import employeeRoutes from './modules/employees/employee.route';
import shiftRoutes from './modules/shifts/shift.route';
import holidayRoutes from './modules/holidays/holiday.route';
import attendanceRoutes from './modules/attendance/attendance.route';
import attendanceRequestRoutes from './modules/attendanceRequests/attendance_request.route';
import leaveRoutes from './modules/leaves/leave.route';
import payrollRoutes from './modules/payroll/payroll.route';
import recruitmentRoutes from './modules/recruitment/recruitment.route';
import documentRoutes from './modules/documents/document.route';
import adminRoutes from './modules/admin/admin.route';
import profileRoutes from './modules/profile/profile.route';
import dashboardRoutes from './modules/dashboard/dashboard.route';
import companyRoutes from './modules/company/company.route';
import announcementRoutes from './modules/announcements/announcement.route';
import publicRoutes from './modules/public/public.route';
import { errorHandler } from './middlewares/errorMiddleware';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './docs/swagger';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 6002;


import rateLimit from 'express-rate-limit';

// Global Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(helmet());
app.use(morgan('dev'));
app.use('/api', limiter);

// Basic Route
app.get('/', (req: Request, res: Response) => {
  res.send('HRMS Backend is running');
});

// Setup specialized routes
app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/designations', designationRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/attendance-requests', attendanceRequestRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/recruitment', recruitmentRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/announcements', announcementRoutes); // Active Announcement Module

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true,
  },
}));

app.use(errorHandler);

import os from 'os';

const startServer = async () => {
  try {
    await prisma.$connect();
    console.log('✅ PostgreSQL Connected');
    console.log('✅ Prisma Connected');
    
    app.listen(PORT as number, '0.0.0.0', () => {
      let localIp = 'localhost';
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
          if (iface.family === 'IPv4' && !iface.internal) {
            localIp = iface.address;
          }
        }
      }

      console.log(`✅ Server Running on http://localhost:${PORT}`);
      console.log('\n========================================================');
      console.log(`⚙️ Backend API accessible on your network via:`);
      console.log(`👉 http://${localIp}:${PORT}`);
      console.log('========================================================\n');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful Shutdown for Nodemon & typical termination signals
const gracefulShutdown = async () => {
  console.log('⏳ Disconnecting Prisma...');
  await prisma.$disconnect();
  console.log('✅ Prisma Disconnected. Exiting process.');
  process.exit(0);
};

process.on('SIGUSR2', gracefulShutdown); // Used by nodemon
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
