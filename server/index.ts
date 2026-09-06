import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Server } from 'socket.io';
import { setupRooms } from './rooms';

export function createGameServer() {
  const app = express();
  app.disable('x-powered-by');
  const http = createServer(app);
  const io = new Server(http, { maxHttpBufferSize: 4096, serveClient: false });
  const manager = setupRooms(io);
  app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: manager.rooms.size }));
  const staticDir = resolve('dist');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }
  return { app, http, io, manager };
}
if (process.env.NODE_ENV !== 'test') {
  const { http, io, manager } = createGameServer();
  const port = Number(process.env.PORT) || 3001;
  http.listen(port, '0.0.0.0', () =>
    console.log(`IRONCLAD server ready on http://localhost:${port}`),
  );
  const stop = () => {
    manager.close();
    io.close();
    http.close(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
