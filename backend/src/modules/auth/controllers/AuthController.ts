import { AuthService } from '../services/AuthService';

const authService = new AuthService();

export class AuthController {
  async sendOtp(email: string) {
    return authService.sendOtp(email);
  }

  async verifyOtp(email: string, code: string) {
    return authService.verifyOtp(email, code);
  }
}
