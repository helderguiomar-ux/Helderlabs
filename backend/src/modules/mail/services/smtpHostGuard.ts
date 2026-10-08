import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from '../../../utils/errors';

// =============================================================================
// Guarda do servidor SMTP indicado pelo tenant
//
// O host SMTP é escrito por um utilizador. Sem esta guarda, um administrador
// de tenant podia apontar o "servidor SMTP" para endereços internos da
// infraestrutura (localhost, 169.254.169.254, rede privada) e usar o botão
// "testar ligação" para sondar a rede da plataforma.
//
// Regras:
//  - só portas de submissão de email (25, 465, 587, 2525);
//  - o nome é resolvido AQUI e a ligação é feita ao IP resolvido (com o nome
//    original como servername TLS), para que um DNS que muda de resposta
//    entre a verificação e a ligação não contorne a guarda;
//  - endereços privados, loopback, link-local, multicast e reservados são
//    recusados, exceto com EMAIL_ALLOW_PRIVATE_SMTP_HOSTS=true (desenvolvimento
//    e testes com um servidor SMTP local).
// =============================================================================

export const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525];

export interface ResolvedSmtpTarget {
  hostname: string;
  address: string;
  port: number;
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inRange(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4'
];

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return BLOCKED_V4.some((cidr) => inRange(address, cidr));
  }
  if (family === 6) {
    const a = address.toLowerCase();
    if (a === '::' || a === '::1') return true;
    if (a.startsWith('::ffff:')) {
      const v4 = a.slice('::ffff:'.length);
      return isIP(v4) === 4 ? isBlockedAddress(v4) : true;
    }
    if (/^f[cd]/.test(a)) return true; // fc00::/7 — ULA (rede privada)
    if (/^fe[89ab]/.test(a)) return true; // fe80::/10 — link-local
    if (a.startsWith('ff')) return true; // multicast
    return false;
  }
  return true;
}

function privateHostsAllowed(): boolean {
  return process.env.EMAIL_ALLOW_PRIVATE_SMTP_HOSTS === 'true';
}

export async function resolveSmtpTarget(
  hostname: string,
  port: number,
  resolver: (host: string) => Promise<{ address: string }[]> = (host) => lookup(host, { all: true })
): Promise<ResolvedSmtpTarget> {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host || host.length > 253 || /[\s/\\@]/.test(host)) {
    throw new AppError('SMTP_HOST_INVALID', 'Servidor SMTP inválido.', 400);
  }
  if (!ALLOWED_SMTP_PORTS.includes(port)) {
    throw new AppError('SMTP_PORT_NOT_ALLOWED', `Porta SMTP não permitida. Use uma de: ${ALLOWED_SMTP_PORTS.join(', ')}.`, 400);
  }

  let addresses: { address: string }[];
  if (isIP(host)) {
    addresses = [{ address: host }];
  } else {
    try {
      addresses = await resolver(host);
    } catch {
      throw new AppError('SMTP_HOST_UNRESOLVED', `Não foi possível encontrar o servidor "${host}". Confirme o nome.`, 400);
    }
  }
  if (!addresses.length) {
    throw new AppError('SMTP_HOST_UNRESOLVED', `Não foi possível encontrar o servidor "${host}". Confirme o nome.`, 400);
  }

  if (!privateHostsAllowed() && addresses.some((a) => isBlockedAddress(a.address))) {
    throw new AppError('SMTP_HOST_FORBIDDEN', 'Esse servidor aponta para um endereço interno e não é permitido.', 400);
  }

  return { hostname: host, address: addresses[0].address, port };
}
