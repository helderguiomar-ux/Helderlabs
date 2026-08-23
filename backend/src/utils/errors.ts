export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(code: string, message: string, statusCode = 500, details?: any) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  static unauthorized(message: string = 'Acesso não autorizado', details?: any) {
    return new AppError('UNAUTHORIZED', message, 401, details);
  }
}

export const ErrorCodes = {
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  DATABASE_STARTING: 'DATABASE_STARTING',
  AUTH_SERVICE_UNAVAILABLE: 'AUTH_SERVICE_UNAVAILABLE',
  INVALID_LOGIN: 'INVALID_LOGIN',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
};
