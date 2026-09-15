import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import * as net from 'net';

/**
 * Portun açıq (boş) olub-olmadığını yoxlayır
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port);
  });
}

/**
 * Başlanğıc portdan başlayaraq ilk boş portu tapır
 */
async function findAvailablePort(startPort: number, maxAttempts = 50): Promise<number> {
  let port = startPort;
  for (let i = 0; i < maxAttempts; i++) {
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
    port++;
  }
  throw new Error(`${startPort} - ${startPort + maxAttempts} aralığında boş port tapılmadı`);
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // CORS aktivləşdirilməsi
  app.enableCors({
    origin: '*',
    credentials: true,
  });

  // Global Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const defaultPort = parseInt(process.env.PORT || '4000', 10);
  const port = await findAvailablePort(defaultPort);

  if (port !== defaultPort) {
    logger.warn(`Port ${defaultPort} artıq məşğuldur. Növbəti boş port seçildi: ${port}`);
  }

  await app.listen(port);
  logger.log(`=======================================================`);
  logger.log(`🚀 "Azeren Notify" serveri uğurla başladı!`);
  logger.log(`📡 Port: ${port}`);
  logger.log(`🔗 REST API URL: http://localhost:${port}`);
  logger.log(`⚡ WebSocket Namespace: ws://localhost:${port}/notify`);
  logger.log(`=======================================================`);
}

bootstrap();
