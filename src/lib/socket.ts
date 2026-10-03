import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: SocketIOServer | null = null;

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

  io.on('connection', (socket: Socket) => {
    console.log(`🔌 [Socket.IO] New Client Connected: ${socket.id}`);

    // Join specific room (e.g. employeeId, userId, departmentId, company)
    socket.on('join_room', (data: { userId?: string; employeeId?: string; departmentId?: string }) => {
      if (data?.userId) {
        socket.join(`user:${data.userId}`);
        console.log(`👤 Socket ${socket.id} joined room user:${data.userId}`);
      }
      if (data?.employeeId) {
        socket.join(`employee:${data.employeeId}`);
        console.log(`👤 Socket ${socket.id} joined room employee:${data.employeeId}`);
      }
      if (data?.departmentId) {
        socket.join(`department:${data.departmentId}`);
        console.log(`🏢 Socket ${socket.id} joined room department:${data.departmentId}`);
      }
      socket.join('company_rosters');
    });

    socket.on('leave_room', (data: { userId?: string; employeeId?: string; departmentId?: string }) => {
      if (data?.userId) socket.leave(`user:${data.userId}`);
      if (data?.employeeId) socket.leave(`employee:${data.employeeId}`);
      if (data?.departmentId) socket.leave(`department:${data.departmentId}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`🔌 [Socket.IO] Client Disconnected: ${socket.id} (${reason})`);
    });
  });

  console.log('⚡ [Socket.IO] Real-Time Shift Broadcast Gateway initialized');
  return io;
};

export const getIo = (): SocketIOServer => {
  if (!io) {
    throw new Error('Socket.IO is not initialized! Call initSocketServer first.');
  }
  return io;
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
