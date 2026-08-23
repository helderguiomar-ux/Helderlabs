import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from './database/prisma/client';

export function setupWebsocket(app: any) {
  app.ready().then(() => {
    const io = new Server(app.server, {
      cors: { origin: '*' }
    });

    // Middleware de autenticação
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) throw new Error('No token');
        const payload = jwt.verify(token, process.env.JWT_SECRET as string) as any;
        (socket as any).user = payload;
        next();
      } catch (err) {
        next(new Error('Authentication error'));
      }
    });

    io.on('connection', async (socket: any) => {
      const user = socket.user;
      
      // Marca como online
      await prisma.user.update({
        where: { id: user.sub },
        data: { isOnline: true, lastSeen: new Date() }
      });
      
      io.emit('user:online', { userId: user.sub, email: user.email });

      socket.on('monitoring:start', (data: any) => {
        if (user.role === 'SUPER_ADMIN') {
          socket.join('monitor_' + data.userId);
        }
      });
      
      socket.on('monitoring:stop', (data: any) => {
        if (user.role === 'SUPER_ADMIN') {
          socket.leave('monitor_' + data.userId);
        }
      });

      socket.on('activity:log', async (data: any) => {
        const activity = await prisma.userActivity.create({
          data: {
            userId: user.sub,
            tenantId: user.tenantId,
            type: data.type || 'ACTION',
            description: data.description,
            page: data.page,
            metadata: data.metadata || {}
          }
        });
        
        // Envia para o super admin
        io.to('monitor_' + user.sub).emit('user:activity', activity);
      });

      socket.on('disconnect', async () => {
        await prisma.user.update({
          where: { id: user.sub },
          data: { isOnline: false, lastSeen: new Date() }
        });
        io.emit('user:offline', { userId: user.sub, email: user.email });
      });
    });
  });
}
