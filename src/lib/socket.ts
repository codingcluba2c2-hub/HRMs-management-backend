import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma';
import { normalizeRole, CANONICAL_ROLES } from '../utils/roleConstants';

let io: SocketIOServer | null = null;

export interface AuthenticatedSocketUser {
  id: string;
  email: string;
  role: string;
  companyId?: string;
  companyName?: string;
  departmentId?: string;
  employeeId?: string;
}

export const initSocketServer = (httpServer: HttpServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*', // Allow connections from frontend
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Socket Authentication Middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || 
                    (socket.handshake.headers?.authorization?.startsWith('Bearer ') 
                      ? socket.handshake.headers.authorization.split(' ')[1] 
                      : null);

      if (!token) {
        // Allow unauthenticated connection for public announcements or fallback, but mark unauthenticated
        return next();
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
      if (decoded && decoded.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: decoded.id },
          include: {
            role: true,
            employee: {
              select: { id: true, departmentId: true, companyId: true }
            }
          }
        });

        if (dbUser) {
          (socket as any).user = {
            id: dbUser.id,
            email: dbUser.email,
            role: dbUser.role?.name || 'EMPLOYEES',
            companyId: dbUser.companyId || dbUser.employee?.companyId,
            companyName: dbUser.companyName,
            departmentId: dbUser.employee?.departmentId,
            employeeId: dbUser.employee?.id
          } as AuthenticatedSocketUser;
        }
      }
      next();
    } catch (err) {
      // Do not crash, proceed unauthenticated
      next();
    }
  });

  io.on('connection', (socket: Socket) => {
    const authUser = (socket as any).user as AuthenticatedSocketUser | undefined;
    console.log(`🔌 [Socket.IO] New Client Connected: ${socket.id} (${authUser ? authUser.email : 'Guest'})`);

    // Auto-join tenant and employee rooms if authenticated
    if (authUser?.companyId) {
      const normalized = normalizeRole(authUser.role);
      if (normalized === CANONICAL_ROLES.SUPER_ADMIN || normalized === CANONICAL_ROLES.HR_ADMIN) {
        socket.join(`workforce:company:${authUser.companyId}`);
        console.log(`📡 Socket ${socket.id} joined workforce:company:${authUser.companyId}`);
      }
      if (normalized === CANONICAL_ROLES.MANAGER && authUser.departmentId) {
        socket.join(`workforce:dept:${authUser.departmentId}`);
        console.log(`🏢 Socket ${socket.id} joined workforce:dept:${authUser.departmentId}`);
      }
      if (authUser.employeeId) {
        socket.join(`workforce:emp:${authUser.employeeId}`);
      }
    }

    // Join specific room with authorization checks
    socket.on('join_room', (data: { userId?: string; employeeId?: string; departmentId?: string; companyId?: string }) => {
      // Tenant Room Authorization
      if (data?.companyId) {
        if (!authUser) {
          socket.emit('error', { message: 'Unauthorized socket subscription' });
          return;
        }
        const normalized = normalizeRole(authUser.role);
        if (normalized === CANONICAL_ROLES.SUPER_ADMIN || authUser.companyId === data.companyId) {
          socket.join(`workforce:company:${data.companyId}`);
        } else {
          socket.emit('error', { message: 'Forbidden cross-tenant subscription' });
          return;
        }
      }

      if (data?.userId) {
        socket.join(`user:${data.userId}`);
      }
      if (data?.employeeId) {
        socket.join(`employee:${data.employeeId}`);
      }
      if (data?.departmentId) {
        socket.join(`department:${data.departmentId}`);
      }
      socket.join('company_rosters');
    });

    socket.on('leave_room', (data: { userId?: string; employeeId?: string; departmentId?: string; companyId?: string }) => {
      if (data?.companyId) socket.leave(`workforce:company:${data.companyId}`);
      if (data?.userId) socket.leave(`user:${data.userId}`);
      if (data?.employeeId) socket.leave(`employee:${data.employeeId}`);
      if (data?.departmentId) socket.leave(`department:${data.departmentId}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`🔌 [Socket.IO] Client Disconnected: ${socket.id} (${reason})`);
    });
  });

  console.log('⚡ [Socket.IO] Real-Time Workforce & Shift Gateway initialized');
  return io;
};

export const getIo = (): SocketIOServer => {
  if (!io) {
    throw new Error('Socket.IO is not initialized! Call initSocketServer first.');
  }
  return io;
};

/**
 * Enterprise Helper to emit workforce location updates in real-time
 */
export const emitWorkforceEvent = (
  companyId: string,
  eventName: 
    | 'employee:location-updated'
    | 'employee:entered-office'
    | 'employee:exited-office'
    | 'employee:tracking-started'
    | 'employee:tracking-stopped'
    | 'attendance:punch-in'
    | 'attendance:punch-out',
  payload: any,
  departmentId?: string
) => {
  try {
    if (!io) {
      console.warn('⚠️ [Socket.IO] Cannot emit workforce event, io not initialized');
      return;
    }

    const eventData = {
      ...payload,
      timestamp: new Date().toISOString()
    };

    // 1. Emit to tenant workforce room
    if (companyId) {
      io.to(`workforce:company:${companyId}`).emit(eventName, eventData);
    }

    // 2. Emit to department room for managers
    if (departmentId) {
      io.to(`workforce:dept:${departmentId}`).emit(eventName, eventData);
    }

    // 3. Emit to employee private room
    if (payload?.employeeId) {
      io.to(`workforce:emp:${payload.employeeId}`).emit(eventName, eventData);
    }
  } catch (err) {
    console.error('❌ Error broadcasting workforce socket event:', err);
  }
};

/**
 * Enterprise Helper to emit shift updates in real time to connected employees
 */
export const emitRosterEvent = (payload: {
  eventType: 'ROSTER_PUBLISHED' | 'ROSTER_UPDATED' | 'SHIFT_ALLOTTED' | 'ROSTER_COPIED';
  departmentId?: string;
  employeeIds?: string[];
  rosterId?: string;
  weekStart?: string;
  title: string;
  message: string;
  updatedBy?: string;
  data?: any;
}) => {
  try {
    if (!io) {
      console.warn('⚠️ [Socket.IO] Cannot emit event, io not initialized');
      return;
    }

    const eventData = {
      ...payload,
      timestamp: new Date().toISOString()
    };

    console.log(`📡 [Socket.IO] Broadcasting event ${payload.eventType}:`, payload.title);

    // 1. Broadcast to specific employee rooms if provided
    if (payload.employeeIds && payload.employeeIds.length > 0) {
      payload.employeeIds.forEach(empId => {
        io?.to(`employee:${empId}`).emit('shift:realtime_update', eventData);
      });
    }

    // 2. Broadcast to department room if provided
    if (payload.departmentId) {
      io.to(`department:${payload.departmentId}`).emit('shift:realtime_update', eventData);
    }

    // 3. Broadcast to all enterprise clients on company channel
    io.to('company_rosters').emit('shift:realtime_update', eventData);

  } catch (error) {
    console.error('❌ Error broadcasting socket event:', error);
  }
};
