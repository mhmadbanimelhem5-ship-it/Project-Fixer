declare module 'nodemailer' {
  export interface Transporter {
    verify(): Promise<boolean>;
    sendMail(options: {
      from: string;
      to: string;
      subject: string;
      html: string;
    }): Promise<unknown>;
  }

  export function createTransport(options: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
    pool?: boolean;
    maxConnections?: number;
    maxMessages?: number;
    connectionTimeout?: number;
    greetingTimeout?: number;
    socketTimeout?: number;
  }): Transporter;
}
